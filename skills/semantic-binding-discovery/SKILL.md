---
name: semantic-binding-discovery
description: Use this skill to iteratively discover, enrich, and validate an OWL ontology + Ontop OBDA semantic binding over virtualized SQL data (no materialization, no ETL). Uses ontop bootstrap as a starting point, then applies agentic SQL pattern discovery and 4-dimension richness metrics with a user-in-the-loop workflow.
license: MIT
---

# semantic-binding-discovery

Agent-oriented loop for discovering and iteratively enriching an ontology + semantic binding (Ontop OBDA / R2RML) over **virtualized SQL data**. No materialization. No ETL. No text extraction.

Starting point: `ontop bootstrap` (direct mapping from live schema). Improvement is driven by agentic SQL pattern discovery, user-in-the-loop domain interview, and measurable richness metrics.

## When to Use

Use when the user asks to:
- Turn a raw SQL schema into a semantically rich OWL ontology + Ontop OBDA binding
- Iteratively enrich a direct mapping (FK → object property, low-cardinality → subclass, schema names → domain vocabulary)
- Validate a virtual knowledge graph binding against an ontology without materializing triples
- Measure and improve semantic binding richness (4 dimensions: concept depth, relational expressiveness, vocabulary quality, SQL pattern coverage)

**Do NOT use when:**
- You also have text sources to fuse with SQL → use `ontology-semantic-binding-discovery` instead
- You only want a one-shot SQL → RDF dump with no ontology → use `ontop bootstrap` directly
- The user wants a materialized triple store → this skill stays virtual

## Deep Reference Library

| Stage | Reference |
|---|---|
| Stage 1: Read SQL schema | [01-reading-sql-schema.md](./references/01-reading-sql-schema.md) |
| Stage 2: Domain interview | [02-domain-interview.md](./references/02-domain-interview.md) |
| Stage 3: Ontop bootstrap | [03-ontop-bootstrap.md](./references/03-ontop-bootstrap.md) |
| Stage 4: SQL pattern probes | [04-sql-pattern-discovery.md](./references/04-sql-pattern-discovery.md) |
| Stage 5: Ontology enrichment | [05-ontology-enrichment.md](./references/05-ontology-enrichment.md) |
| Stage 6: Binding validation | [06-binding-validation.md](./references/06-binding-validation.md) |
| Stage 7: Richness metrics | [07-richness-metrics.md](./references/07-richness-metrics.md) |
| Stage 8: Iterative improvement | [08-iterative-improvement.md](./references/08-iterative-improvement.md) |
| End-to-end example | [09-end-to-end-example.md](./references/09-end-to-end-example.md) |

## Prerequisites

- `ontop` CLI on PATH (`ontop --version`)
- Apache Jena CLI: `riot`, `arq` on PATH
- ROBOT CLI: `robot --version`
- Node.js ≥ 20
- JDBC-reachable database (Trino, PostgreSQL, MySQL, etc.)
- DB connection `.properties` file with `jdbc.url`, `jdbc.user`, `jdbc.password`, `jdbc.driver`

Quick check:
```bash
riot --version && arq --version && robot --version && ontop --version
node --version
npm install   # from skill root
```

## Canonical 8-Stage Discovery Loop

### Stage 1: Read SQL Schema

Objective: build a structural inventory before touching the ontology.

Deep dive: [01-reading-sql-schema.md](./references/01-reading-sql-schema.md)

Actions:
- Read DDL files (if provided): tables, columns, PKs, FKs, nullable flags, column types
- Identify FK relationships (join graph)
- Flag low-cardinality candidate columns (enum/status/type columns)
- Identify numeric columns (aggregation candidates) and date columns
- Produce a short schema inventory summary

### Stage 2: Domain Interview (User in the Loop)

Objective: lock domain scope and ontology expectations before writing any OBDA.

Deep dive: [02-domain-interview.md](./references/02-domain-interview.md)

**This is a hard gate — do not modify OBDA or ontology until Stage 2 is confirmed.**

Ask adaptive questions covering:
- Primary entity tables vs lookup/junction tables
- Target class vocabulary (domain terms vs schema identifiers)
- Existing ontologies to align to (SNOMED, schema.org, FHIR, custom)
- Semantically critical FK relationships (must become object properties)
- URI template key columns (domain identity columns)
- Cardinality threshold for "low cardinality" (default ≤ 50 distinct values)
- 3–5 competency questions (natural-language SPARQL endpoint queries)
- Precision vs coverage preference

Summarize confirmed assumptions. Do not proceed until user confirms.

### Stage 3: Ontop Bootstrap → Initial Direct Mapping

Deep dive: [03-ontop-bootstrap.md](./references/03-ontop-bootstrap.md)

```bash
ontop bootstrap \
  -b https://example.org/data/ \
  -p <db.properties> \
  -m bootstrap.obda \
  -t bootstrap-ontology.ttl
```

Then convert to R2RML for downstream validation:
```bash
ontop mapping to-r2rml -i bootstrap.obda -o binding.ttl
riot --validate binding.ttl
riot --validate bootstrap-ontology.ttl
```

Baseline `binding.obda` = flat direct mapping. Agent will progressively enrich it.

### Stage 4: SQL Pattern Probes (`explore-schema.mjs`)

Deep dive: [04-sql-pattern-discovery.md](./references/04-sql-pattern-discovery.md)

```bash
node ./scripts/explore-schema.mjs \
  --binding binding.ttl \
  --ontology bootstrap-ontology.ttl \
  --properties db.properties \
  --output schema-report.json \
  --cardinality-threshold 50
```

Outputs `schema-report.json`:
- Per-predicate: `{iri, classification, distinct_count, total_count}`
- Classifications: `fk` | `low_cardinality` | `numeric` | `date` | `pk` | `free_text`

If no live DB: pass `--skip-probes` and provide a hand-edited `schema-report.json` using the fixture format in `tests/fixtures/schema-report.json`.

### Stage 5: Propose and Apply Ontology Enrichment

Deep dive: [05-ontology-enrichment.md](./references/05-ontology-enrichment.md)

Agent applies auto-classify heuristics from `schema-report.json`, then presents proposals as a diff for user approval. **Do not edit files until user approves the diff.**

| Column pattern | Ontology change | Binding change |
|---|---|---|
| `fk` | Add `owl:ObjectProperty` with `rdfs:domain`/`rdfs:range` | Replace predicate map with `rr:refObjectMap` |
| `low_cardinality` | Add subclasses (if ≤ 10 values) or `owl:AnnotationProperty` | Add typed predicate with literal values |
| `numeric` | Add `rdfs:range xsd:decimal` (or integer/double) | Add `rr:datatype` to predicate map |
| `pk` | Declare `owl:FunctionalProperty` | Change `rr:column` to `rr:template` for URI minting |
| Schema-named class | Rename to domain term + add `rdfs:label`/`rdfs:comment` | Update class IRI in all subject maps |

After edits:
```bash
ontop mapping to-r2rml -i binding.obda -o binding.ttl
riot --validate binding.ttl && riot --validate ontology.ttl
```

### Stage 6: Validate Binding Alignment

Deep dive: [06-binding-validation.md](./references/06-binding-validation.md)

```bash
# Structural gate
ontop validate -m binding.obda -t ontology.ttl -p db.properties

# Syntax gates
riot --validate binding.ttl
riot --validate ontology.ttl

# Semantic alignment: all binding terms must exist in ontology
arq --data binding.ttl --data ontology.ttl --query - <<'Q'
PREFIX rr: <http://www.w3.org/ns/r2rml#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT ?term WHERE {
  { ?m rr:class ?term } UNION { ?m rr:predicate ?term }
  FILTER NOT EXISTS {
    ?term a ?t .
    FILTER(?t IN (owl:Class, owl:ObjectProperty, owl:DatatypeProperty,
                  owl:AnnotationProperty, rdf:Property))
  }
  FILTER(!STRSTARTS(STR(?term), "http://www.w3.org/"))
  FILTER(!STRSTARTS(STR(?term), "http://purl.org/dc/"))
}
Q
```

Gate: zero unknown terms before advancing.

### Stage 7: Measure Richness (`richness-metrics.mjs`)

Deep dive: [07-richness-metrics.md](./references/07-richness-metrics.md)

```bash
node ./scripts/richness-metrics.mjs \
  --ontology ontology.ttl \
  --binding binding.ttl \
  --schema-report schema-report.json \
  --format md \
  --output richness-metrics.md
```

Reports 4 richness dimensions + quality flags. Compare delta vs previous cycle.

### Stage 8: Improve and Repeat

Deep dive: [08-iterative-improvement.md](./references/08-iterative-improvement.md)

Prioritization: resolve blocking quality flags first, then improve weakest richness dimension.

Stop criterion: loop ends only after **explicit user approval**.

## Cycle Output Contract

At the end of each cycle, report:
1. Domain/schema assumptions confirmed with user
2. Ontology changes (classes added/renamed/split, properties added)
3. Binding changes (predicates upgraded to object properties, typed predicates, URI templates)
4. Probe results summary (column classifications from `schema-report.json`)
5. Alignment gate status (zero unknown terms? `ontop validate` passed?)
6. Richness metrics delta (all 4 dimensions, quality flags cleared vs new)
7. Concrete next improvements for next cycle
8. Explicit ask: **approve or continue another refinement loop?**

## Quality Flags Decision Table

| Flag | Trigger | Fix |
|---|---|---|
| `flat_ontology` | `leaf_class_ratio > 0.9` and `class_count ≥ 5` | Add subclass hierarchy for low-cardinality columns or domain concept splits |
| `poor_fk_modeling` | `fk_object_property_ratio < 0.5` and `fk_total > 0` | Convert FK columns to object properties with `rr:refObjectMap` |
| `unlabeled_ontology` | `class_with_label_ratio < 0.5` | Add `rdfs:label` and `rdfs:comment` to all classes and object properties |
| `schema_vocabulary_leak` | `schema_name_ratio > 0.5` | Rename classes/properties from schema identifiers to domain terms |
| `low_cardinality_uncovered` | `low_cardinality_coverage_ratio < 0.3` | Model low-cardinality columns as subclasses or annotation properties |

## Tool Summary

- `scripts/explore-schema.mjs` — cardinality/FK/join probes via `ontop query`; outputs `schema-report.json`
- `scripts/richness-metrics.mjs` — 4-dimension richness scoring via `arq` + `robot metrics`
- Pure CLI tools: `ontop bootstrap`, `ontop validate`, `ontop mapping to-r2rml`, `riot --validate`, `arq`, `robot metrics`

## Limitations

- No text extraction or cross-source bridge rules — SQL-only domain
- No materialized triples — all SPARQL runs live against virtual KG via `ontop endpoint`
- `explore-schema.mjs` cardinality probes require a live DB; skip with `--skip-probes` for fixture testing
- Ontology enrichment authored by the calling agent (LLM); scripts are deterministic helpers only
