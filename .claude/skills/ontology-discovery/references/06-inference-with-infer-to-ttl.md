# Step 5 Reference: Inference Quality with `infer-to-ttl.mjs`

This guide explains how to run fixpoint inference and interpret whether rule behavior is healthy.

## What inference script computes

`infer-to-ttl.mjs`:

- loads ontology + asserted triples
- runs `.rq` rules iteratively
- computes inferred-only triples
- supports strict ordering, snapshots, and closure output

This is forward chaining via repeated `CONSTRUCT` over the working set.

## Core command

```bash
node ./scripts/infer-to-ttl.mjs \
  --ontology <path/to/ontology.ttl> \
  --triples <path/to/asserted.ttl> \
  --rules <path/to/rules> \
  --output <path/to/inferred.ttl> \
  --output-format ttl \
  --iterate true \
  --max-iterations 10
```

## Debug command (recommended during tuning)

```bash
node ./scripts/infer-to-ttl.mjs \
  --ontology <path/to/ontology.ttl> \
  --triples <path/to/asserted.ttl> \
  --rules <path/to/rules> \
  --output <path/to/inferred.ttl> \
  --strict-rule-order true \
  --write-closure <path/to/closure.ttl> \
  --snapshot-dir /tmp/onto-infer-snapshots
```

## Key options and decisions

## `--iterate true|false`

- `true`:
  - required for multi-hop derivations
  - may increase runtime
- `false`:
  - useful for quick sanity checks
  - misses chained inference

## `--strict-rule-order true|false`

- `true`:
  - newly inferred triples become available earlier inside same iteration
  - more sensitive to rule order
- `false`:
  - rule effects are grouped per iteration
  - often easier to reason about globally

Use `true` when debugging ordering-dependent logic.

## `--write-closure`

Write full graph (ontology + asserted + inferred) to inspect integrated output and run downstream validation.

## `--snapshot-dir`

Stores iteration snapshots for forensic debugging:

- identify when noise first appears
- identify rules causing explosive growth

## Inference health signals

Healthy:

- inferred triples add clear semantic value
- per-rule contributions are non-trivial and explainable
- no sudden unbounded growth

Unhealthy:

- very high inferred volume with weak semantic relevance
- many dead rules
- derivations dominated by one broad rule

## Validation after inference

```bash
riot --validate <path/to/inferred.ttl>
```

If using closure:

```bash
riot --validate <path/to/closure.ttl>
```

## Common problems and fixes

## Problem: dead rules

Symptoms:

- rule constructs triples but novelty is zero
- dead-rule count is high

Fixes:

- remove redundant rules
- tighten or reorder rules
- ensure prerequisite typing/inverse rules run first

## Problem: inference explosion

Symptoms:

- inferred count grows rapidly each iteration
- many low-value generic triples

Fixes:

- add class constraints in WHERE
- add anti-loop filters
- split broad rules into staged specific rules

## Problem: missing expected derivations

Symptoms:

- competency question still fails after inference

Fixes:

- verify asserted prerequisite triples exist
- verify rule join variables align with actual graph pattern
- test with strict ordering and snapshots

## Rule runtime interpretation

Per-rule metrics include:

- `derived`
- `runs`
- `total_ms`
- `avg_ms`
- `max_ms`

Use them to identify:

- expensive low-value rules (optimize or remove)
- high-value rules worth preserving
