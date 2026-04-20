#!/usr/bin/env node
// LLM-based ontology-guided extraction, CLI-only.
// Pipeline:
// 1) source text -> token chunks
// 2) per chunk: entity pass, then triple pass
// 3) merge chunk outputs (global entity IDs + triple dedupe)
// 4) mint IRIs -> N-Triples -> serialize (TTL / RDF-XML / N-Quads)

import { readFile } from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { parseArgs, usage } from "./extract/cli.mjs";
import { appendOrWriteTurtle, assertReadableFile, writeNonTurtle } from "./extract/io.mjs";
import {
  buildNTriples,
  buildOntologyContextFromTurtle,
  ntToFormat,
  ntToFormatWithPrefixes,
} from "./extract/rdf.mjs";
import { runChunkedTwoStageExtraction } from "./extract/pipeline.mjs";

function formatUsage(usageObj) {
  if (!usageObj) return "in=0 out=0 cache_create=0 cache_read=0";
  return (
    `in=${usageObj.input_tokens ?? 0} out=${usageObj.output_tokens ?? 0} ` +
    `cache_create=${usageObj.cache_creation_input_tokens ?? 0} ` +
    `cache_read=${usageObj.cache_read_input_tokens ?? 0}`
  );
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

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set in the environment.");
  }

  await assertReadableFile(opts.text, "Text");
  await assertReadableFile(opts.ontology, "Ontology");

  const textAbs = path.resolve(opts.text);
  const ontologyAbs = path.resolve(opts.ontology);
  const outputAbs = path.resolve(opts.output);

  const [sourceText, ontologyContent] = await Promise.all([
    readFile(textAbs, "utf8"),
    readFile(ontologyAbs, "utf8"),
  ]);

  const { prefixMap, ontologyContext } = await buildOntologyContextFromTurtle(ontologyContent);
  const client = new Anthropic();

  console.log(`Calling Anthropic (${opts.model}) with chunked two-stage extraction...`);
  const extraction = await runChunkedTwoStageExtraction({
    client,
    sourceText,
    ontologyContext,
    model: opts.model,
    maxTokens: opts.maxTokens,
    chunkTokenLimit: opts.chunkTokenLimit,
    charsPerToken: opts.charsPerToken,
    chunkOverlapChars: opts.chunkOverlapChars,
    chunkConcurrency: opts.chunkConcurrency,
  });

  const { nt, warnings: ntWarnings, mintedCount } = buildNTriples(
    { entities: extraction.entities, triples: extraction.triples },
    prefixMap,
    opts.baseIri
  );

  const ntLineCount = nt.split("\n").filter(Boolean).length;
  console.log(
    `model=${opts.model} chunks=${extraction.chunks.length} ` +
      `entities_chunk_raw=${extraction.totalProposedEntities} ` +
      `triples_chunk_raw=${extraction.totalProposedTriples} ` +
      `entities_merged=${extraction.entities.length} triples_merged=${extraction.triples.length} ` +
      `minted=${mintedCount} nt_lines=${ntLineCount}`
  );

  console.log(`usage entity-pass: ${formatUsage(extraction.usage.entity)}`);
  console.log(`usage triple-pass: ${formatUsage(extraction.usage.triple)}`);
  console.log(`usage total:       ${formatUsage(extraction.usage.total)}`);

  for (const chunk of extraction.chunkResults) {
    console.log(
      `  chunk ${chunk.index + 1}: chars=${chunk.textLength} ` +
        `entities=${chunk.entities.length} triples=${chunk.triples.length} ` +
        (chunk.tripleSkipped ? "(triple pass skipped)" : "")
    );
  }

  if (!nt.trim()) console.warn("No triples produced; writing empty output.");

  const serialized =
    opts.outputFormat === "ttl"
      ? await ntToFormatWithPrefixes(nt, opts.outputFormat, prefixMap, opts.baseIri)
      : await ntToFormat(nt, opts.outputFormat);
  if (opts.outputFormat === "ttl") {
    await appendOrWriteTurtle(outputAbs, serialized, opts.text, opts.mode, opts.noMarker);
  } else {
    await writeNonTurtle(outputAbs, serialized);
  }

  const allWarnings = [...extraction.warnings, ...ntWarnings];
  console.log(`Wrote ${opts.outputFormat.toUpperCase()} to: ${outputAbs}`);
  if (allWarnings.length) {
    console.log("warnings:");
    for (const w of allWarnings.slice(0, 50)) console.log(`  - ${w}`);
    if (allWarnings.length > 50) console.log(`  ... (+${allWarnings.length - 50} more)`);
  }
}

main().catch((err) => {
  console.error(String(err.stack ?? err.message ?? err));
  process.exit(1);
});
