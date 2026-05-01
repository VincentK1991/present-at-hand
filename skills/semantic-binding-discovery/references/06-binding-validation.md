# 06 — Binding Validation

## Objective

Validate that the enriched binding is structurally correct (Ontop + DB), syntactically valid (Jena), and semantically aligned (all binding terms exist in the ontology). All three gates must pass before measuring richness metrics.

## Gate 1: Structural Validation (Ontop CLI)

```bash
ontop validate \
  -m binding.obda \
  -t ontology.ttl \
  -p db.properties
```

What it checks:
- OBDA mapping syntax
- Column names in `source` SQL exist in the actual DB schema
- Class and predicate IRIs in `target` triples are defined in `ontology.ttl`
- `rr:parentTriplesMap` references are resolvable (FK join targets exist)

**This requires a live DB.** Skip (and document) if testing offline. Fix before proceeding if it fails.

## Gate 2: Syntax Validation (Jena/riot)

```bash
riot --validate ontology.ttl
riot --validate binding.ttl
```

Must produce zero errors. Warnings (e.g., undefined prefixes) should also be resolved.

## Gate 3: Semantic Alignment (arq)

All terms referenced in `binding.ttl` (R2RML `rr:class` and `rr:predicate` values) must be declared in `ontology.ttl`.

```bash
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
  FILTER(!STRSTARTS(STR(?term), "http://schema.org/"))
}
Q
```

**Gate passes:** zero rows returned (no unknown terms).  
**Gate fails:** one or more terms appear — add them to `ontology.ttl` or fix the binding IRI.

## Annotation Vocabulary Whitelist

These terms are always allowed in bindings without ontology declaration:
- `rdf:type`, `rdfs:label`, `rdfs:comment`, `rdfs:seeAlso`, `rdfs:isDefinedBy`
- `owl:sameAs`, `owl:differentFrom`
- Any `http://www.w3.org/` or `http://purl.org/dc/` IRI

The alignment query above already excludes W3C and DC namespaces.

## Interpreting Failures

### `ontop validate` fails with "column not found"
The binding SQL references a column that doesn't exist. Check if:
- You renamed a column in the OBDA but the DB still has the old name
- The schema changed since bootstrap
- There's a case-sensitivity issue (Trino is usually case-insensitive; some DBs are not)

### `ontop validate` fails with "undefined class/property"
The binding uses a term not in ontology.ttl. Add the term to the ontology or fix the IRI.

### `arq` alignment query returns rows
The binding references terms that exist in the binding but not in the ontology. For each unknown term:
1. If it's a real ontology concept you forgot to declare → add it to `ontology.ttl`
2. If it's a typo or stale reference → fix the binding IRI

### `riot --validate` fails
Turtle syntax error. Common causes:
- Missing prefix declaration
- Unescaped special character in IRI
- Unclosed triple

## Optional: Probe Live VKG

After validation passes, run a quick probe to confirm the VKG returns results:
```bash
ontop query \
  -m binding.obda \
  -t ontology.ttl \
  -p db.properties \
  -q /dev/stdin <<'Q'
PREFIX : <https://example.org/data/>
SELECT ?s WHERE { ?s a :Patient } LIMIT 5
Q
```

Zero results from a populated DB indicates a mapping or DB connectivity issue, not a validation error.
