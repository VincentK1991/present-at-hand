# 09 — End-to-End Worked Example

## Scenario

A clinical data warehouse with 3 tables: `patients`, `conditions`, `claims`. Goal: virtual SPARQL endpoint answering clinical questions without materializing any triples.

**Schema:**
```sql
CREATE TABLE patients (
  patient_id   INTEGER PRIMARY KEY,
  name         VARCHAR(200),
  dob          DATE,
  status       VARCHAR(20)  -- values: Active, Discharged, Deceased
);

CREATE TABLE conditions (
  condition_id INTEGER PRIMARY KEY,
  patient_id   INTEGER REFERENCES patients(patient_id),
  code         VARCHAR(20),   -- ICD-10 code, low-cardinality by category
  description  TEXT,
  onset_date   DATE
);

CREATE TABLE claims (
  claim_id     INTEGER PRIMARY KEY,
  condition_id INTEGER REFERENCES conditions(condition_id),
  amount       DECIMAL(10,2),
  filed_date   DATE
);
```

---

## Stage 1: Read Schema

Schema inventory:
```
Entity tables: patients, conditions, claims
Lookup/junction: none
FK graph: conditions.patient_id → patients.patient_id
          claims.condition_id → conditions.condition_id
Low-cardinality candidates: patients.status (3 values)
Numeric candidates: claims.amount
Date candidates: patients.dob, conditions.onset_date, claims.filed_date
```

---

## Stage 2: Domain Interview

**Agent asks:**
> Primary entities? Which FKs matter?

**User confirms:**
- Primary entities: patients, conditions, claims
- FKs to model: patient→condition (`:hasCondition`), condition→claim (`:hasClaim`)
- Domain terms: use `Patient`, `Condition`, `Claim`
- Status column → subclass hierarchy (only 3 values)
- URI key: `patient_id`, `condition_id`, `claim_id`
- Competency questions:
  1. Which patients have an Active status?
  2. What is total claim amount per patient?
  3. Which conditions had claims filed after 2023-01-01?
- Preference: depth over breadth

---

## Stage 3: Ontop Bootstrap

```bash
ontop bootstrap -b https://example.org/clinical/ -p clinical.properties \
  -m bootstrap.obda -t bootstrap-ontology.ttl
```

**Bootstrap output** (`bootstrap-ontology.ttl`, flat):
```turtle
:patients a owl:Class .
:conditions a owl:Class .
:claims a owl:Class .
:patient_id a owl:DatatypeProperty .
:name a owl:DatatypeProperty .
:condition_id a owl:DatatypeProperty .
:patient_id_fk a owl:DatatypeProperty .  # FK as literal
...
```

**Bootstrap OBDA** (flat direct mapping):
```
mappingId  patients-class
target     :{patient_id} a :patients .
source     SELECT patient_id FROM patients

mappingId  patients-name
target     :{patient_id} :name {name}^^xsd:string .
source     SELECT patient_id, name FROM patients

mappingId  patients-status
target     :{patient_id} :status {status}^^xsd:string .
source     SELECT patient_id, status FROM patients
```

---

## Stage 4: SQL Pattern Probes

```bash
node ./scripts/explore-schema.mjs \
  --binding bootstrap.ttl --ontology bootstrap-ontology.ttl \
  --properties clinical.properties \
  --output schema-report.json --cardinality-threshold 50
```

**schema-report.json (excerpt):**
```json
{
  "fk_count": 2,
  "low_cardinality_count": 1,
  "numeric_count": 1,
  "date_count": 3,
  "predicates": [
    {"iri": "...#status", "classification": "low_cardinality", "distinct_count": 3, "total_count": 500},
    {"iri": "...#amount", "classification": "numeric", "distinct_count": 312, "total_count": 800},
    {"iri": "...#patient_id_fk", "classification": "fk", "distinct_count": null, "total_count": null}
  ]
}
```

**Richness metrics at bootstrap baseline:**
- `leaf_class_ratio`: 1.0 (all classes are leaves) → `flat_ontology` flag
- `fk_object_property_ratio`: 0.0 (FKs are literals) → `poor_fk_modeling` flag
- `class_with_label_ratio`: 0.0 → `unlabeled_ontology` flag
- `schema_name_ratio`: 1.0 → `schema_vocabulary_leak` flag
- `low_cardinality_coverage_ratio`: 0.0 → `low_cardinality_uncovered` flag

---

## Stage 5: Cycle 1 Enrichment (FK + Naming)

**Agent proposes (dominant flags: poor_fk_modeling + schema_vocabulary_leak):**

1. Rename classes: `:patients` → `:Patient`, `:conditions` → `:Condition`, `:claims` → `:Claim`
2. Add `rdfs:label` and `rdfs:comment` to all 3 classes
3. Convert FK literal predicates to object properties: `:hasCondition`, `:hasClaim`
4. Add `rdfs:domain`/`rdfs:range` to both object properties

User approves. Agent edits `binding.obda` and `ontology.ttl`.

**Ontology after cycle 1 (excerpt):**
```turtle
@prefix :  <https://example.org/clinical/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

:Patient a owl:Class ;
  rdfs:label "Patient" ;
  rdfs:comment "A person receiving clinical care." .

:Condition a owl:Class ;
  rdfs:label "Condition" ;
  rdfs:comment "A diagnosed medical condition." .

:hasCondition a owl:ObjectProperty ;
  rdfs:domain :Patient ;
  rdfs:range :Condition ;
  rdfs:label "has condition" .

:hasClaim a owl:ObjectProperty ;
  rdfs:domain :Condition ;
  rdfs:range :Claim ;
  rdfs:label "has claim" .
```

**Binding after cycle 1 (FK object properties):**
```
mappingId  patient-hasCondition
target     :{patient_id} :hasCondition :{condition_id} .
source     SELECT p.patient_id, c.condition_id
           FROM patients p JOIN conditions c ON p.patient_id = c.patient_id
```

**Metrics after cycle 1:**
- `fk_object_property_ratio`: 1.0 ✓ (poor_fk_modeling cleared)
- `class_with_label_ratio`: 1.0 ✓ (unlabeled_ontology cleared)
- `schema_name_ratio`: 0.0 ✓ (schema_vocabulary_leak cleared)
- `flat_ontology`: still flagged (no subclasses yet)
- `low_cardinality_uncovered`: still flagged

---

## Stage 5: Cycle 2 Enrichment (Subclass + Typing)

**Agent proposes (remaining flags: flat_ontology + low_cardinality_uncovered):**

1. Add subclass hierarchy for `status` column (3 values)
2. Add `xsd:decimal` typing for `amount`
3. Add `xsd:date` typing for date columns

**Ontology additions:**
```turtle
:PatientStatus a owl:Class ;
  rdfs:label "Patient Status" .
:ActivePatient rdfs:subClassOf :PatientStatus ;
  rdfs:label "Active Patient" .
:DischargedPatient rdfs:subClassOf :PatientStatus ;
  rdfs:label "Discharged Patient" .
:DeceasedPatient rdfs:subClassOf :PatientStatus ;
  rdfs:label "Deceased Patient" .

:claimAmount a owl:DatatypeProperty ;
  rdfs:domain :Claim ;
  rdfs:range xsd:decimal ;
  rdfs:label "claim amount" .
```

**OBDA additions:**
```
mappingId  patient-status-active
target     :{patient_id} a :ActivePatient .
source     SELECT patient_id FROM patients WHERE status = 'Active'

mappingId  claim-amount
target     :{claim_id} :claimAmount {amount}^^xsd:decimal .
source     SELECT claim_id, amount FROM claims
```

**Metrics after cycle 2:**
- `leaf_class_ratio`: 0.75 ✓ (3 subclasses, 3 parent entity classes → not all leaves)
- `flat_ontology`: cleared ✓
- `low_cardinality_coverage_ratio`: 1.0 ✓
- `low_cardinality_uncovered`: cleared ✓

**All 5 quality flags cleared.**

---

## Competency Question Validation

```bash
# CQ 1: Active patients
ontop query -m binding.obda -t ontology.ttl -p clinical.properties -q /dev/stdin <<'Q'
PREFIX : <https://example.org/clinical/>
SELECT ?patient WHERE { ?patient a :ActivePatient }
Q

# CQ 3: Conditions with claims after 2023
ontop query -m binding.obda -t ontology.ttl -p clinical.properties -q /dev/stdin <<'Q'
PREFIX : <https://example.org/clinical/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT ?condition WHERE {
  ?condition a :Condition .
  ?condition :hasClaim ?claim .
  ?claim :filedDate ?date .
  FILTER(?date > "2023-01-01"^^xsd:date)
}
Q
```

All 3 competency questions return results → user approves.

---

## Lessons

1. Bootstrap is always flat and schema-named — enrichment is always needed
2. FK → object property conversion is the highest-impact single change
3. Subclass hierarchy for low-cardinality columns makes SPARQL `a :ActivePatient` possible (vs FILTER on literal)
4. Naming/labeling is low effort, high usability gain
5. Two focused cycles (FK + naming, then subclass + typing) cleared all flags
