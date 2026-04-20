# Step 4 Reference: Ontology-Guided Extraction with `extract-to-ttl.mjs`

This guide explains how to run extraction well and how to diagnose quality failures.

## What the extractor does

`extract-to-ttl.mjs` runs a two-stage structured extraction per chunk:

1. entity pass
2. triple pass conditioned on extracted entities

Then it merges chunks, mints IRIs deterministically, and serializes RDF.

## Why this design is strong

Two-stage extraction improves consistency:

- entity normalization happens before relation extraction
- triple extraction has a bounded entity universe per chunk

Chunking improves coverage on long documents without token overload.

## Required command pattern

```bash
node ./scripts/extract-to-ttl.mjs \
  --text <path/to/source.txt> \
  --ontology <path/to/ontology.ttl> \
  --output <path/to/asserted.ttl> \
  --base-iri <https://example.org/resource/> \
  --mode create \
  --output-format ttl
```

## Key tuning flags and tradeoffs

## `--chunk-token-limit`

- lower:
  - pros: fewer schema failures, cleaner local grounding
  - cons: more chunk boundary fragmentation
- higher:
  - pros: more context per pass
  - cons: higher LLM complexity and potential drift

## `--chunk-overlap-chars`

- 0 overlap:
  - pros: simpler dedupe
  - cons: cross-boundary misses
- moderate overlap:
  - pros: better continuity
  - cons: more duplicate candidates to merge

## `--chunk-concurrency`

- lower:
  - pros: stable rate limit behavior
  - cons: slower throughput
- higher:
  - pros: faster runtime
  - cons: potential API throttling and harder debugging

## `--max-tokens`

- too low -> truncated structured output risk
- too high -> slower and more expensive

## Best-practice run pattern

1. First run conservative settings.
2. Validate output syntax.
3. Inspect warnings and counts.
4. Tune one flag at a time.

Conservative baseline:

- `--chunk-token-limit 4096`
- `--chunk-overlap-chars 0`
- `--chunk-concurrency 1`

## Post-extraction validation

```bash
riot --validate <path/to/asserted.ttl>
riot --count <path/to/asserted.ttl>
```

Also inspect:

- unresolved subject/object warnings
- unexpectedly low typed coverage later in metrics

## Failure diagnosis

## Symptom: too few triples

Possible causes:

- ontology too sparse (missing properties/classes)
- extraction prompt constraints too strict
- chunk size too small for relation context

Actions:

- enrich ontology vocabulary
- increase chunk token limit moderately
- verify core properties have clear labels/comments

## Symptom: noisy triples

Possible causes:

- ambiguous class/property names
- weak ontology constraints
- overly permissive modeling assumptions

Actions:

- tighten ontology terms and domain/range
- reduce overlap if duplicates are excessive
- rely more on downstream typed inference guards

## Symptom: schema parse or structure failures

Actions:

- reduce `--chunk-token-limit`
- reduce `--chunk-concurrency`
- rerun on smaller corpus slice to isolate issue

## Extraction output quality checklist

- high-value entities present with stable labels
- critical relations from competency questions appear
- literals are usable (not all opaque strings)
- syntax validation passes

If this checklist fails, revise ontology and rerun; do not proceed blindly to inference.
