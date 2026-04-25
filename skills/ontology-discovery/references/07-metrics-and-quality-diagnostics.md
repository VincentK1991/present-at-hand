# Step 6 Reference: Metrics and Quality Diagnostics with `metrics.mjs`

This guide explains how to interpret ontology, data, inference, and rule metrics as research signals.

## Why metrics matter

Without metrics, ontology iteration is anecdotal. Metrics turn revision into evidence-driven engineering.

`metrics.mjs` groups measurements into:

- ontology
- data
- inference
- rules
- SHACL (optional)
- quality flags

## Run pattern

```bash
node ./scripts/metrics.mjs \
  --ontology <path/to/ontology.ttl> \
  --asserted <path/to/asserted.ttl> \
  --inferred <path/to/inferred.ttl> \
  --rules <path/to/rules> \
  --format md \
  --output <path/to/metrics.md>
```

Use `--closure` if available for richer instance-level diagnostics.

## How to read each metric group

## Ontology metrics

Key signals:

- `class_count`, `property_count`
- `leaf_class_ratio`
- `max_superclass_count`
- `properties_with_domain_ratio`, `properties_with_range_ratio`
- `tbox_density`

Interpretation:

- very high leaf ratio can indicate flat taxonomy.
- high max superclass count can indicate over-complex hierarchy.
- low domain/range coverage weakens extraction and inference precision.

## Data metrics

Key signals:

- `typed_subject_coverage_ratio`
- `untyped_subject_count`
- `avg_properties_per_subject`
- top predicates distribution

Interpretation:

- low typed coverage suggests weak ontology mapping or missing typing rules.
- skewed top-predicate distribution may indicate over-generic modeling.

## Inference metrics

Key signals:

- `inference_gain`
- `closure_ratio`
- `inferred_new_predicate_count`
- top inferred predicates

Interpretation:

- moderate gain is healthy when derivations are meaningful.
- very high gain can signal rule over-generation.
- no new predicate diversity may indicate narrow rule impact.

## Rule metrics

Key signals:

- `dead_rule_count`
- per-rule constructed and novel counts
- runtime per rule

Interpretation:

- dead rules are often maintenance debt or missing preconditions.
- expensive low-novelty rules should be redesigned or removed.

## SHACL metrics (if shapes provided)

Key signals:

- `conforms`
- violation count
- severity breakdown
- top failing constraint components

Interpretation:

- repeated violations on same component indicate schema/data mismatch.

## Quality flags: use as hypotheses, not truth

Flags (e.g. `flat_hierarchy`, `low_domain_coverage`) are heuristics.
Treat each as a prompt for targeted review, not automatic rewrite.

## Metric-driven decision examples

## Case A: flat hierarchy + low rule novelty

Likely issue:

- ontology lacks discriminative structure.

Actions:

- introduce meaningful subclasses.
- tighten rule predicates with class guards.

## Case B: high inference gain + noisy review

Likely issue:

- broad rule conditions.

Actions:

- add explicit typing constraints in WHERE.
- add anti-loop and exclusion filters.

## Case C: low typed coverage + many dead rules

Likely issue:

- prerequisite typing not derived/asserted.

Actions:

- add foundational type propagation rules first.
- ensure extraction includes key type assertions.

## Recommended quality dashboard per cycle

Record these in each iteration:

- typed subject coverage
- domain/range coverage
- inference gain
- dead rule count
- SHACL violation count
- one paragraph qualitative assessment from user

## Practical references

- SHACL Recommendation: https://www.w3.org/TR/shacl/
- RDF Data Cube patterns (for statistical data): https://www.w3.org/TR/vocab-data-cube/
