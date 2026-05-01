# 04 — SQL Pattern Discovery

## Objective

Run `explore-schema.mjs` to classify each mapped predicate by SQL pattern. This drives the enrichment proposals in Stage 5.

## What explore-schema.mjs Does

1. Parses `binding.ttl` (R2RML) via `arq` to extract predicate IRIs and FK join conditions
2. Reads range types from `ontology.ttl` to detect numeric/date columns
3. Runs per-predicate SPARQL probes via `ontop query` (DISTINCT COUNT) to measure cardinality
4. Classifies each predicate: `fk` | `low_cardinality` | `numeric` | `date` | `pk` | `free_text`
5. Outputs `schema-report.json`

## Running the Script

With live DB:
```bash
node ./scripts/explore-schema.mjs \
  --binding binding.ttl \
  --ontology ontology.ttl \
  --properties db.properties \
  --output schema-report.json \
  --cardinality-threshold 50
```

Without live DB (fixture testing):
```bash
node ./scripts/explore-schema.mjs \
  --binding binding.ttl \
  --ontology ontology.ttl \
  --skip-probes \
  --output schema-report.json
```

## Classification Rules

| Classification | Condition |
|---|---|
| `fk` | Predicate map has `rr:parentTriplesMap` (join condition) in binding.ttl |
| `low_cardinality` | `distinct_count ≤ threshold` OR `distinct_count / total_count < 0.05` |
| `numeric` | Ontology `rdfs:range` is `xsd:integer`, `xsd:decimal`, `xsd:double`, `xsd:float`, `xsd:long` |
| `date` | Ontology `rdfs:range` is `xsd:date`, `xsd:dateTime`, `xsd:gYear`, `xsd:gYearMonth` |
| `pk` | Subject map uses `rr:template` (not `rr:column`) |
| `free_text` | Everything else |

## Schema Report Format

```json
{
  "generated": "2025-01-01T00:00:00Z",
  "cardinality_threshold": 50,
  "skip_probes": false,
  "predicates": [
    {"iri": "https://example.org/data/patientName", "classification": "free_text", "distinct_count": 980, "total_count": 1000},
    {"iri": "https://example.org/data/status", "classification": "low_cardinality", "distinct_count": 3, "total_count": 1000},
    {"iri": "https://example.org/data/hasCondition", "classification": "fk", "distinct_count": null, "total_count": null},
    {"iri": "https://example.org/data/claimAmount", "classification": "numeric", "distinct_count": null, "total_count": null}
  ],
  "subject_templates": [
    {"type": "subject_template", "template": "https://example.org/data/{patient_id}", "classification": "pk"}
  ],
  "fk_count": 1,
  "low_cardinality_count": 1,
  "numeric_count": 1,
  "date_count": 0,
  "free_text_count": 1,
  "pk_count": 1
}
```

## Enrichment Signals from Schema Report

After reviewing the schema report, the agent should:

### FK predicates → object property candidates
Every `fk` predicate is a candidate for `owl:ObjectProperty` with `rr:refObjectMap`. Confirm with user (Stage 2) which FKs are semantically important before converting.

### Low-cardinality predicates → classification hierarchy candidates
Cardinality ≤ 10: consider subclass hierarchy (one subclass per value)  
Cardinality 11–50: consider `owl:AnnotationProperty` with enumerated values in `rdfs:comment`  
Cardinality > 50 but below threshold: may still be meaningful classification; ask user

### Numeric predicates → typed measure properties
Add `rdfs:range xsd:decimal` (or appropriate type) and `rr:datatype` in binding.
If numeric column is used for aggregation in user competency questions, prioritize it.

### Free-text predicates → rdfs:label or low-priority
Schema-named free-text predicates are enrichment candidates for naming/labeling only.
High-cardinality free-text columns (names, descriptions) can stay as `xsd:string` literals.

## Cardinality Threshold Guidance

Default threshold: 50 distinct values.

| Column type | Typical cardinality | Recommended action |
|---|---|---|
| Boolean flags | 2 | Subclass or annotation |
| Status/state | 3–10 | Subclass hierarchy |
| Category/type | 10–50 | Annotation property |
| Code with description | 50–200 | Object property → lookup table |
| Free identifiers | > 1000 | Keep as literal |

Ask the user to confirm threshold during Stage 2 if the domain has unusual distributions.
