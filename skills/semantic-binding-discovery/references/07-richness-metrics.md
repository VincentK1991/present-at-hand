# 07 — Richness Metrics

## Objective

Measure the semantic quality of the ontology + binding across 4 dimensions. Use deltas between cycles to decide what to improve next.

## Running richness-metrics.mjs

```bash
node ./scripts/richness-metrics.mjs \
  --ontology ontology.ttl \
  --binding binding.ttl \
  --schema-report schema-report.json \
  --format md \
  --output richness-metrics.md
```

Requires: `arq` and `robot` on PATH. `schema-report.json` is optional but enables SQL pattern coverage metrics.

## The 4 Dimensions

### Dimension 1: Semantic Concept Depth

Measures whether the ontology captures domain structure beyond a flat list of tables.

| Metric | Good | Warning |
|---|---|---|
| `class_count` | ≥ entity table count | = 0 (nothing declared) |
| `leaf_class_ratio` | < 0.9 (some hierarchy) | > 0.9 → `flat_ontology` flag |
| `max_subclass_depth` | ≥ 2 | 0 = no hierarchy |
| `properties_with_domain_ratio` | > 0.8 | < 0.5 = weak constraint signal |
| `properties_with_range_ratio` | > 0.8 | < 0.5 = weak typing |

**What to improve:**
- `flat_ontology`: add `rdfs:subClassOf` chains for domain concept splits and low-cardinality columns
- Low domain/range: add `rdfs:domain`/`rdfs:range` to all object properties and key datatype properties

### Dimension 2: Relational Expressiveness

Measures how well the binding captures the relational structure of the schema.

| Metric | Good | Warning |
|---|---|---|
| `fk_object_property_ratio` | 1.0 (all FKs → object properties) | < 0.5 → `poor_fk_modeling` flag |
| `functional_property_count` | ≥ PK column count | 0 = no PKs declared as functional |
| `fk_total` | > 0 (FKs detected) | 0 = no FKs in schema or schema-report missing |

**What to improve:**
- `poor_fk_modeling`: convert remaining FK literal predicates to object properties with `rr:refObjectMap`
- Low functional property count: declare PK-derived properties as `owl:FunctionalProperty`

### Dimension 3: Domain Vocabulary Quality

Measures whether the ontology uses domain language rather than schema identifiers.

| Metric | Good | Warning |
|---|---|---|
| `class_with_label_ratio` | 1.0 | < 0.5 → `unlabeled_ontology` flag |
| `property_with_label_ratio` | > 0.8 | < 0.5 = unlabeled properties |
| `schema_name_ratio` | < 0.1 | > 0.5 → `schema_vocabulary_leak` flag |

**Schema-name detection heuristic:** local names matching `TBL_*`, `COL_*`, `ALL_CAPS_UNDERSCORE`, or `T_*` patterns are counted as schema-like.

**What to improve:**
- `unlabeled_ontology`: add `rdfs:label` (human-readable name) and `rdfs:comment` (one sentence definition) to every class and property
- `schema_vocabulary_leak`: rename schema-named terms to domain terms; align to existing vocabulary if available

### Dimension 4: SQL Pattern Coverage

Measures how many important SQL patterns are explicitly modeled vs left as raw literals.

| Metric | Good | Warning |
|---|---|---|
| `low_cardinality_coverage_ratio` | > 0.7 | < 0.3 → `low_cardinality_uncovered` flag |
| `numeric_typed_ratio` | 1.0 | < 0.5 = numeric columns typed as strings |
| `low_cardinality_total` | > 0 | 0 = schema-report not provided |

**What to improve:**
- `low_cardinality_uncovered`: add subclass hierarchy or annotation property modeling for remaining low-cardinality columns
- Low `numeric_typed_ratio`: add `rr:datatype xsd:decimal` (or integer) to binding and `rdfs:range` to ontology

## Reading Deltas Across Cycles

Always compare against the previous cycle's metrics:

| Delta | Interpretation |
|---|---|
| ↑ `fk_object_property_ratio` | More FK-derived relationships properly modeled |
| ↑ `max_subclass_depth` | Hierarchy added (confirm it's semantically justified, not mechanical) |
| ↑ `class_with_label_ratio` | More annotated vocabulary |
| ↓ `schema_name_ratio` | More domain-term renaming done |
| ↑ `low_cardinality_coverage_ratio` | More classification axes modeled |
| ↑ `numeric_typed_ratio` | Better measure property typing |
| No change after enrichment | Enrichment didn't affect the measured dimension — check the mapping |

## OWL Metrics from ROBOT

`richness-metrics.mjs` also runs `robot metrics` which provides:
- Axiom count breakdown (SubClassOf, ObjectProperty, DatatypeProperty, AnnotationProperty axioms)
- OWL profile (OWL 2 DL, OWL 2 EL, etc.)
- Individual count

These are supplementary context for the agent, not primary quality gates.

## Quality Flags Summary

| Flag | Trigger | Priority |
|---|---|---|
| `flat_ontology` | `leaf_class_ratio > 0.9` and `class_count ≥ 5` | High — limits SPARQL expressiveness |
| `poor_fk_modeling` | `fk_object_property_ratio < 0.5` and `fk_total > 0` | High — FK joins not navigable via SPARQL |
| `unlabeled_ontology` | `class_with_label_ratio < 0.5` | Medium — impacts usability and documentation |
| `schema_vocabulary_leak` | `schema_name_ratio > 0.5` | Medium — ontology uses DB jargon |
| `low_cardinality_uncovered` | `low_cardinality_coverage_ratio < 0.3` | Medium — classification axes not queryable |

Fix blocking flags (flat_ontology, poor_fk_modeling) before working on medium flags.
