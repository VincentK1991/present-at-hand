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

## Required: multi-source extraction per cycle

**Always extract from at least two source documents per cycle — single-source extraction is insufficient.**

### Why

One document rarely exercises the whole ontology. A clean single-source run hides:

- classes/properties the document never touches (false sense of coverage)
- dead rules that would actually fire on a different source
- divergent vocabulary across the corpus (synonym clusters, overloaded terms)
- fragile extraction prompts that only work on one writing style

The metrics computed from a single source describe that source's shape, not the ontology's fitness for the corpus.

### How to pick sources

Choose sources that intentionally stress *different* parts of the ontology:

- different subclasses of the main entity type (e.g. two different report series)
- different indicator / measure families
- different population-stratification patterns
- one "central" document and one "edge case" document

Two sources is the floor; three is preferred when subclasses are many.

### How to run

Run the extraction command once per source, writing one asserted file per source:

```bash
# source A
node ./scripts/extract-to-ttl.mjs \
  --text <corpus/sourceA.txt> \
  --ontology <ontology.ttl> \
  --output <asserted-sourceA.ttl> \
  --base-iri <https://example.org/resource/> \
  --mode create \
  --output-format ttl

# source B
node ./scripts/extract-to-ttl.mjs \
  --text <corpus/sourceB.txt> \
  --ontology <ontology.ttl> \
  --output <asserted-sourceB.ttl> \
  --base-iri <https://example.org/resource/> \
  --mode create \
  --output-format ttl
```

Keep the `--base-iri` identical across runs so IRIs mint deterministically and entities that appear in both sources coalesce.

Validate each asserted file:

```bash
riot --validate <asserted-sourceA.ttl>
riot --validate <asserted-sourceB.ttl>
```

### Feeding multi-source output to downstream steps

Both `infer-to-ttl.mjs` and `metrics.mjs` accept only a *single* triples/asserted path. To run them over all sources in one shot, merge the per-source asserted files into a union file:

```bash
# Merge all per-source asserted files into one canonical Turtle document.
# Piping through riot re-serializes and deduplicates triples.
cat asserted-sourceA.ttl asserted-sourceB.ttl \
  | riot --syntax=ttl --output=ttl - > asserted-union.ttl

riot --validate asserted-union.ttl
riot --count asserted-union.ttl
```

Because the per-source runs used the same `--base-iri`, IRIs for entities that appear in more than one source collapse automatically when the files are concatenated.

Pass `asserted-union.ttl` to `infer-to-ttl.mjs --triples` and `metrics.mjs --asserted`.

Reporting back to the user, present per-source counts *and* union counts. Divergence between sources is the signal you want: if rule X fires on source B but is dead on source A, that tells you something about both the ontology and source A's vocabulary.

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
