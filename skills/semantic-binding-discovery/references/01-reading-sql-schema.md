# 01 — Reading the SQL Schema

## Objective

Before running `ontop bootstrap`, build a structural inventory of the database. This shapes the domain interview in Stage 2 and prevents blind spots in the enrichment loop.

## What to Read

### DDL files (if available)
- `CREATE TABLE` statements: table names, column names, types, NOT NULL, DEFAULT
- `PRIMARY KEY` and `UNIQUE` constraints (identity columns)
- `FOREIGN KEY` constraints (explicit join graph)
- `CHECK` constraints (hidden enum/cardinality signals)
- `INDEX` definitions (frequently queried columns = enrichment candidates)

### Live DB metadata (if DDL is unavailable)
For PostgreSQL/Trino:
```sql
-- Tables
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' ORDER BY table_name;

-- Columns + types
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' ORDER BY table_name, ordinal_position;

-- FK constraints
SELECT tc.table_name, kcu.column_name,
       ccu.table_name AS foreign_table_name,
       ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY';
```

## What to Inventory

Organize your findings into three groups:

### Group 1: Core Entity Tables
Tables that represent primary domain concepts (not just junctions or lookups). Signs:
- Has a synthetic PK (`id`, `patient_id`, `uuid`)
- Referenced by FK from multiple other tables
- Has multiple non-FK columns (attributes)

### Group 2: Lookup / Reference Tables
Low-row-count tables with a `code` + `description` pattern. These drive low-cardinality classification in Stage 4.

### Group 3: Junction / Association Tables
Two or more FK columns, no or minimal attributes. These become `owl:ObjectProperty` assertions (not classes).

## Bridge Candidate Columns

Flag columns that are semantically significant for the ontology:
- FK columns → candidate `owl:ObjectProperty` connections
- Columns appearing in multiple tables with matching names → shared identifier (cross-table join axis)
- Status/type/category columns with limited values → subclass hierarchy candidates
- Date columns → temporal dimension
- Numeric columns used in SUM/AVG/COUNT → measure properties

## Output: Schema Inventory (before Stage 2)

Produce a short markdown summary:
```
Entity tables: [list]
Lookup tables: [list]
Junction tables: [list]
FK graph: TableA.colX → TableB.pk, ...
Low-cardinality candidates: status (3 values), type (5 values), ...
Numeric candidates: amount, quantity, score, ...
```

## Anti-patterns to Avoid

- Do not model every table as a class (junction tables → properties, not classes)
- Do not assume column names are good ontology terms (they often aren't)
- Do not ignore FK constraints — they define the semantic join graph
- Do not skip lookup tables — they often define the most important classification axes
