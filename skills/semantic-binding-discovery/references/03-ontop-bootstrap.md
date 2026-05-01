# 03 — Ontop Bootstrap

## Objective

Use `ontop bootstrap` to generate an initial direct mapping OBDA + seed ontology from the live database schema. This is the baseline for all subsequent enrichment.

## What Bootstrap Produces

`ontop bootstrap` introspects the DB schema and generates:
1. **`bootstrap.obda`** — one mapping per table, one predicate per column, direct literal mappings for all columns, `rr:joinCondition` for FK columns
2. **`bootstrap-ontology.ttl`** — one `owl:Class` per table, one `owl:DatatypeProperty` per column, flat (no hierarchy, no domain/range, no labels)

This is a direct mapping — it represents the schema structure, not domain semantics.

## Bootstrap Command

```bash
ontop bootstrap \
  -b https://example.org/data/ \
  -p <db.properties> \
  -m bootstrap.obda \
  -t bootstrap-ontology.ttl
```

Options:
- `-b` — base IRI for all generated resource URIs and ontology terms
- `-p` — JDBC properties file (see below)
- `-m` — output OBDA mapping file
- `-t` — output seed ontology TTL

For Trino (multi-catalog federation):
```bash
ontop bootstrap \
  -b https://example.org/data/ \
  -p trino.properties \
  -m bootstrap.obda \
  -t bootstrap-ontology.ttl
```
Trino uses fully qualified `catalog.schema.table` names in SQL queries. The bootstrap OBDA will have `SELECT ... FROM catalog.schema.table` statements.

## DB Properties File Format

```properties
jdbc.url=jdbc:trino://localhost:8080/catalog
jdbc.user=user
jdbc.password=
jdbc.driver=io.trino.jdbc.TrinoDriver
```

For PostgreSQL:
```properties
jdbc.url=jdbc:postgresql://localhost:5432/mydb
jdbc.user=postgres
jdbc.password=
jdbc.driver=org.postgresql.Driver
```

JDBC driver JARs must be on Ontop's classpath (in `$ONTOP_HOME/jdbc/` or via `-cp`).

## Converting to R2RML

Convert for downstream validation and arq analysis:
```bash
ontop mapping to-r2rml -i bootstrap.obda -o binding.ttl
riot --validate binding.ttl
```

Always edit the `.obda` file (Ontop's authoring format), then re-run this conversion. Never hand-edit `binding.ttl` directly — it is derived.

## Structural Validation

```bash
ontop validate \
  -m binding.obda \
  -t ontology.ttl \
  -p db.properties
```

Checks: OBDA syntax, mapping-to-schema consistency (column names exist), ontology vocabulary consistency. Passes = safe to query.

## Limitations of Direct Mapping to Enrich Past

| Bootstrap limitation | Enrichment target |
|---|---|
| FK columns are modeled as literals (column value, not joined entity IRI) | Convert FK predicate maps to `rr:refObjectMap` with `rr:parentTriplesMap` |
| All classes named after table names | Rename to domain terms + add `rdfs:label` |
| No class hierarchy | Add `rdfs:subClassOf` for domain concept splits and low-cardinality axes |
| No `rdfs:domain`/`rdfs:range` | Add to all object properties and important datatype properties |
| No `owl:FunctionalProperty` | Declare for PK-derived subject maps |
| No `rdfs:label`/`rdfs:comment` | Add to all classes and object properties |
| All columns mapped as `xsd:string` literals | Add explicit `rr:datatype` for numeric/date columns |

## OBDA File Format Reference

Ontop OBDA format (not W3C standard):
```
[PrefixDeclaration]
:		https://example.org/data/
owl:		http://www.w3.org/2002/07/owl#
rdf:		http://www.w3.org/1999/02/22-rdf-syntax-ns#
xsd:		http://www.w3.org/2001/XMLSchema#

[MappingDeclaration] @collection [[
mappingId	patient-class
target		:{patient_id} a :Patient .
source		SELECT patient_id FROM patients

mappingId	patient-name
target		:{patient_id} :patientName {name}^^xsd:string .
source		SELECT patient_id, name FROM patients

mappingId	patient-condition
target		:{patient_id} :hasCondition :{condition_id} .
source		SELECT p.patient_id, c.condition_id
            FROM patients p JOIN conditions c ON p.patient_id = c.patient_id
]]
```

- `mappingId` — human-readable identifier (no spaces)
- `target` — SPARQL-like triple pattern using `{}` for column interpolation
- `source` — SQL SELECT that provides the columns referenced in target
- For FKs: source SELECT must JOIN both tables; target uses IRI pattern for both subject and object
