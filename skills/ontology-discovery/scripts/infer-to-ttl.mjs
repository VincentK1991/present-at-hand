#!/usr/bin/env node
// SPARQL CONSTRUCT-based inference, CLI-only (no Java backend).
// Pipeline: ontology + asserted + rules (.rq files)
//           --arq CONSTRUCT per rule, iterate to fixpoint--> inferred-only N-Triples
//           --riot--> TTL / RDF-XML / N-Quads

import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { appendOrWriteTurtle, assertReadableFile, writeNonTurtle } from "./extract/io.mjs";
import { ntToFormat, ntToFormatWithPrefixes, parsePrefixMap } from "./extract/rdf.mjs";
import { runCommand } from "./extract/shell.mjs";

function usage() {
  console.log(`Usage:
  infer-to-ttl.mjs --ontology <ont.ttl> --triples <asserted.ttl> --rules <dir-or-file> --output <out> [options]

Required:
  --ontology <path>            Ontology .ttl
  --triples <path>             Asserted triples .ttl
  --rules <path>               Directory of .rq rule files, OR a single .rq file
  --output <path>              Output file (TTL / RDF-XML / N-Quads) with INFERRED-ONLY triples

Options:
  --mode <append|create>       Write mode (default: create; must be 'create' for non-TTL)
  --output-format <fmt>        ttl | rdf | nq (default: ttl)
  --iterate <true|false>       Iterate rules to fixpoint (default: true)
  --max-iterations <n>         Cap the fixpoint loop (default: 10)
  --strict-rule-order <bool>   Apply newly inferred triples immediately per rule (default: false)
  --snapshot-dir <path>        Optional directory for per-iteration .nt snapshots
  --write-closure <path>       Optional output path for full closure graph (ontology + asserted + inferred)
  --no-marker                  Skip the "# ---- inferred from ... ----" marker
  --help                       Show this help`);
}

function parseBoolean(value, flagName) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${flagName} must be 'true' or 'false'`);
}

function parseArgs(argv) {
  const opts = {
    ontology: "",
    triples: "",
    rules: "",
    output: "",
    mode: "create",
    outputFormat: "ttl",
    iterate: true,
    maxIterations: 10,
    strictRuleOrder: false,
    snapshotDir: "",
    writeClosure: "",
    noMarker: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const n = argv[i + 1];
    switch (a) {
      case "--ontology":
        opts.ontology = n ?? "";
        i++;
        break;
      case "--triples":
        opts.triples = n ?? "";
        i++;
        break;
      case "--rules":
        opts.rules = n ?? "";
        i++;
        break;
      case "--output":
        opts.output = n ?? "";
        i++;
        break;
      case "--mode":
        opts.mode = n ?? "";
        i++;
        break;
      case "--output-format":
        opts.outputFormat = (n ?? "").toLowerCase();
        i++;
        break;
      case "--iterate":
        if (!n) throw new Error("--iterate requires a value");
        opts.iterate = parseBoolean(n, "--iterate");
        i++;
        break;
      case "--max-iterations":
        if (!n) throw new Error("--max-iterations requires a value");
        opts.maxIterations = Number.parseInt(n, 10);
        if (!Number.isFinite(opts.maxIterations) || opts.maxIterations <= 0) {
          throw new Error("--max-iterations must be a positive integer");
        }
        i++;
        break;
      case "--strict-rule-order":
        if (!n) throw new Error("--strict-rule-order requires a value");
        opts.strictRuleOrder = parseBoolean(n, "--strict-rule-order");
        i++;
        break;
      case "--snapshot-dir":
        opts.snapshotDir = n ?? "";
        i++;
        break;
      case "--write-closure":
        opts.writeClosure = n ?? "";
        i++;
        break;
      case "--no-marker":
        opts.noMarker = true;
        break;
      case "--help":
      case "-h":
        usage();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${a}`);
    }
  }

  if (!opts.ontology || !opts.triples || !opts.rules || !opts.output) {
    throw new Error("--ontology, --triples, --rules, and --output are required.");
  }
  if (opts.mode !== "append" && opts.mode !== "create") {
    throw new Error("--mode must be 'append' or 'create'.");
  }
  if (!["ttl", "rdf", "nq"].includes(opts.outputFormat)) {
    throw new Error("--output-format must be ttl, rdf, or nq");
  }
  if (opts.outputFormat !== "ttl" && opts.mode === "append") {
    throw new Error("--mode append is only supported with --output-format ttl");
  }

  return opts;
}

function ntLines(nt) {
  return nt
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

function nowNs() {
  return process.hrtime.bigint();
}

function elapsedMs(startNs) {
  return Number(nowNs() - startNs) / 1_000_000;
}

function makeRuleStats(rules) {
  return Object.fromEntries(
    rules.map((rulePath) => [
      path.basename(rulePath),
      { derived: 0, runs: 0, totalMs: 0, maxMs: 0 },
    ])
  );
}

function mergePrefixMaps(...maps) {
  const merged = new Map();
  for (const map of maps) {
    for (const [k, v] of map.entries()) {
      if (!merged.has(k)) merged.set(k, v);
    }
  }
  return merged;
}

async function resolveRules(rulesPath) {
  const st = await stat(rulesPath);
  if (st.isFile()) {
    if (!rulesPath.endsWith(".rq")) {
      throw new Error(`--rules file must have .rq extension: ${rulesPath}`);
    }
    return [rulesPath];
  }
  if (st.isDirectory()) {
    const entries = await readdir(rulesPath);
    const rqs = entries.filter((e) => e.endsWith(".rq")).sort();
    if (rqs.length === 0) throw new Error(`No .rq files in ${rulesPath}`);
    return rqs.map((e) => path.join(rulesPath, e));
  }
  throw new Error(`--rules path is neither a file nor a directory: ${rulesPath}`);
}

async function riotToNT(inputPath) {
  const { stdout } = await runCommand("riot", ["--output=NT", inputPath]);
  return stdout;
}

async function arqConstructToNT(dataFiles, queryFile) {
  const args = [...dataFiles.map((f) => `--data=${f}`), `--query=${queryFile}`];
  const { stdout: arqOut } = await runCommand("arq", args);
  if (!arqOut.trim()) return "";
  const { stdout: ntOut } = await runCommand("riot", ["--syntax=TTL", "--output=NT", "-"], arqOut);
  return ntOut;
}

async function writeWorkingSetAsNT(filePath, baseLines, inferred) {
  const workingText = [...baseLines, ...inferred].join("\n") + "\n";
  await writeFile(filePath, workingText, "utf8");
}

async function maybeWriteSnapshots(snapshotDir, iter, baseLines, inferred) {
  if (!snapshotDir) return;
  await mkdir(snapshotDir, { recursive: true });
  const iterLabel = String(iter).padStart(2, "0");
  const workingPath = path.join(snapshotDir, `iter-${iterLabel}-working.nt`);
  const inferredPath = path.join(snapshotDir, `iter-${iterLabel}-inferred-only.nt`);
  const workingText = [...baseLines, ...inferred].join("\n") + "\n";
  const inferredText = [...inferred].join("\n") + (inferred.size ? "\n" : "");
  await writeFile(workingPath, workingText, "utf8");
  await writeFile(inferredPath, inferredText, "utf8");
}

async function serializeNT(nt, format, prefixMap) {
  if (format === "ttl") {
    return ntToFormatWithPrefixes(nt, format, prefixMap, null);
  }
  return ntToFormat(nt, format);
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(String(e.message ?? e));
    usage();
    process.exit(1);
  }

  await assertReadableFile(opts.ontology, "Ontology");
  await assertReadableFile(opts.triples, "Triples");
  await assertReadableFile(opts.rules, "Rules");

  const ontologyAbs = path.resolve(opts.ontology);
  const triplesAbs = path.resolve(opts.triples);
  const rulesAbs = path.resolve(opts.rules);
  const outputAbs = path.resolve(opts.output);
  const snapshotAbs = opts.snapshotDir ? path.resolve(opts.snapshotDir) : "";
  const closureAbs = opts.writeClosure ? path.resolve(opts.writeClosure) : "";

  const rules = await resolveRules(rulesAbs);
  console.log(`Rules: ${rules.length} (${rules.map((r) => path.basename(r)).join(", ")})`);
  console.log(`strict_rule_order=${opts.strictRuleOrder} iterate=${opts.iterate}`);

  const [ontologyTTL, assertedTTL] = await Promise.all([
    readFile(ontologyAbs, "utf8"),
    readFile(triplesAbs, "utf8"),
  ]);
  const mergedPrefixMap = mergePrefixMaps(parsePrefixMap(ontologyTTL), parsePrefixMap(assertedTTL));

  const [ontologyNT, assertedNT] = await Promise.all([riotToNT(ontologyAbs), riotToNT(triplesAbs)]);
  const baseLines = new Set([...ntLines(ontologyNT), ...ntLines(assertedNT)]);
  const assertedLines = new Set(ntLines(assertedNT));

  const inferred = new Set();
  const ruleStats = makeRuleStats(rules);

  const tmp = await mkdtemp(path.join(tmpdir(), "infer-"));
  let iter = 0;
  const maxIter = opts.iterate ? opts.maxIterations : 1;

  while (iter < maxIter) {
    iter++;
    let addedThisIter = 0;

    const workingPath = path.join(tmp, `working-${iter}.nt`);
    if (!opts.strictRuleOrder) {
      await writeWorkingSetAsNT(workingPath, baseLines, inferred);
    }

    for (const rule of rules) {
      const name = path.basename(rule);
      const stats = ruleStats[name];
      stats.runs += 1;

      if (opts.strictRuleOrder) {
        await writeWorkingSetAsNT(workingPath, baseLines, inferred);
      }

      const t0 = nowNs();
      const ruleOutNT = await arqConstructToNT([workingPath], rule);
      const ruleMs = elapsedMs(t0);

      stats.totalMs += ruleMs;
      if (ruleMs > stats.maxMs) stats.maxMs = ruleMs;

      let addedByRule = 0;
      for (const line of ntLines(ruleOutNT)) {
        if (!baseLines.has(line) && !inferred.has(line)) {
          inferred.add(line);
          addedByRule++;
        }
      }
      stats.derived += addedByRule;
      addedThisIter += addedByRule;
    }

    await maybeWriteSnapshots(snapshotAbs, iter, baseLines, inferred);
    console.log(`  iter ${iter}: +${addedThisIter} inferred (total=${inferred.size})`);
    if (addedThisIter === 0) break;
  }

  const inferredOnly = [...inferred].filter((l) => !assertedLines.has(l));
  const inferredNT = inferredOnly.join("\n") + (inferredOnly.length ? "\n" : "");
  const serialized = await serializeNT(inferredNT, opts.outputFormat, mergedPrefixMap);

  if (opts.outputFormat === "ttl") {
    const marker = `${path.basename(opts.triples)} + ${path.basename(opts.rules)}`;
    await appendOrWriteTurtle(outputAbs, serialized, marker, opts.mode, opts.noMarker, "inferred");
  } else {
    await writeNonTurtle(outputAbs, serialized);
  }

  if (closureAbs) {
    const closureNT = [...baseLines, ...inferred].join("\n") + "\n";
    const closureSerialized = await serializeNT(closureNT, opts.outputFormat, mergedPrefixMap);
    await writeNonTurtle(closureAbs, closureSerialized);
    console.log(`Wrote closure ${opts.outputFormat.toUpperCase()} to: ${closureAbs}`);
  }

  console.log(`Wrote ${opts.outputFormat.toUpperCase()} to: ${outputAbs}`);
  console.log(
    `asserted=${assertedLines.size} inferred=${inferredOnly.length} ` +
      `total=${assertedLines.size + inferredOnly.length} iterations=${iter}`
  );
  console.log("per-rule stats:");
  for (const rulePath of rules) {
    const name = path.basename(rulePath);
    const stats = ruleStats[name];
    const avgMs = stats.runs > 0 ? stats.totalMs / stats.runs : 0;
    console.log(
      `  - ${name}: derived=${stats.derived} runs=${stats.runs} ` +
        `total_ms=${stats.totalMs.toFixed(1)} avg_ms=${avgMs.toFixed(1)} max_ms=${stats.maxMs.toFixed(1)}`
    );
  }
  if (snapshotAbs) {
    console.log(`Snapshots written to: ${snapshotAbs}`);
  }
}

main().catch((err) => {
  console.error(String(err.stack ?? err.message ?? err));
  process.exit(1);
});
