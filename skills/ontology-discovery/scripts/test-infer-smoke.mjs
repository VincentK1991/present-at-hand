#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "./extract/shell.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(SCRIPT_DIR, "..");
const FIXTURES = path.join(SKILL_ROOT, "tests", "infer-fixtures");
const SCRIPT = path.join(SCRIPT_DIR, "infer-to-ttl.mjs");

async function requireCommand(cmd) {
  try {
    await runCommand(cmd, ["--version"]);
  } catch (e) {
    throw new Error(
      `${cmd} is required for inference smoke tests.\n` +
        `Install Apache Jena CLI and ensure '${cmd}' is on PATH.\n` +
        `Original error: ${String(e.message ?? e)}`
    );
  }
}

function extractIterations(stdout) {
  const m = stdout.match(/iterations=(\d+)/);
  if (!m) throw new Error(`Could not parse iteration count from output:\n${stdout}`);
  return Number.parseInt(m[1], 10);
}

function countAncestorTriplesFromNT(ntText) {
  const lines = ntText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.filter((line) =>
    line.includes("<https://example.org/onto/ancestorOf>")
  ).length;
}

async function runInference({ strict }) {
  const temp = await mkdtemp(path.join(tmpdir(), `infer-smoke-${strict ? "strict" : "normal"}-`));
  const outPath = path.join(temp, "inferred.ttl");
  const closurePath = path.join(temp, "closure.ttl");
  const snapshots = path.join(temp, "snapshots");

  const args = [
    SCRIPT,
    "--ontology",
    path.join(FIXTURES, "ontology.ttl"),
    "--triples",
    path.join(FIXTURES, "asserted.ttl"),
    "--rules",
    path.join(FIXTURES, "rules"),
    "--output",
    outPath,
    "--output-format",
    "ttl",
    "--mode",
    "create",
    "--iterate",
    "true",
    "--max-iterations",
    "10",
    "--strict-rule-order",
    strict ? "true" : "false",
    "--write-closure",
    closurePath,
    "--snapshot-dir",
    snapshots,
  ];

  const { stdout } = await runCommand("node", args);

  const { stdout: inferredNT } = await runCommand("riot", ["--output=NT", outPath]);
  const { stdout: closureNT } = await runCommand("riot", ["--output=NT", closurePath]);

  return {
    stdout,
    iterations: extractIterations(stdout),
    ancestorCount: countAncestorTriplesFromNT(inferredNT),
    closureNT,
  };
}

async function main() {
  await requireCommand("riot");
  await requireCommand("arq");

  const normal = await runInference({ strict: false });
  const strict = await runInference({ strict: true });

  assert.equal(normal.ancestorCount, 3, "normal mode should infer 3 ancestorOf triples");
  assert.equal(strict.ancestorCount, 3, "strict mode should infer 3 ancestorOf triples");
  assert.ok(
    strict.iterations <= normal.iterations,
    `strict mode should not require more iterations (strict=${strict.iterations}, normal=${normal.iterations})`
  );
  assert.ok(
    strict.closureNT.includes("<https://example.org/onto/parentOf>"),
    "closure should contain asserted parentOf triples"
  );
  assert.ok(
    strict.closureNT.includes("<https://example.org/onto/ancestorOf>"),
    "closure should contain inferred ancestorOf triples"
  );

  console.log("Inference smoke test passed.");
  console.log(`normal iterations=${normal.iterations}, strict iterations=${strict.iterations}`);
}

main().catch((err) => {
  console.error(String(err.stack ?? err.message ?? err));
  process.exit(1);
});
