# 05 — Ontology Enrichment

## Objective

Apply auto-classify heuristics from `schema-report.json` to produce a richer OBDA binding and ontology. All proposals must be presented to the user as a diff before editing any files.

## Enrichment Principles

1. **One change per cycle** — don't attempt all enrichments at once. Focus on the dominant quality flag first.
2. **Evidence-grounded** — every change must be justified by `schema-report.json` data, user competency questions, or explicit user instruction.
3. **Authoring discipline** — always edit `binding.obda` (Ontop native), then regenerate `binding.ttl` via `ontop mapping to-r2rml`. Never hand-edit `binding.ttl`.
4. **Present diff first** — describe what you will change in ontology + OBDA before writing. Get user approval.

## Enrichment Patterns

### Pattern 1: FK → Object Property

**Trigger:** `schema-report.json` shows `classification: "fk"` for a predicate.  
**Condition:** User confirmed this FK is semantically important (Stage 2).

**Ontology change:**
```turtle
:hasCondition a owl:ObjectProperty ;
  rdfs:domain :Patient ;
  rdfs:range :Condition ;
  rdfs:label "has condition" ;
  rdfs:comment "Links a patient to their diagnosed conditions." .
```

**OBDA change** (replace literal mapping with join):
```
mappingId	patient-hasCondition
target		:{patient_id} :hasCondition :{condition_id} .
source		SELECT p.patient_id, c.condition_id
            FROM patients p JOIN conditions c ON p.patient_id = c.patient_id
```

**Before:** `{patient_id} :condition_id {condition_id}^^xsd:integer` (literal, schema-named)  
**After:** `:{patient_id} :hasCondition :{condition_id}` (object property, IRI-based)

### Pattern 2: Low-Cardinality → Subclass Hierarchy

**Trigger:** `classification: "low_cardinality"` and `distinct_count ≤ 10`.  
**Condition:** User agreed to subclass modeling for this column (or default behavior).

**Ontology change** (for a `status` column with values Active, Inactive, Pending):
```turtle
:ConditionStatus a owl:Class ;
  rdfs:label "Condition Status" .
:ActiveCondition rdfs:subClassOf :ConditionStatus ;
  rdfs:label "Active Condition" .
:InactiveCondition rdfs:subClassOf :ConditionStatus ;
  rdfs:label "Inactive Condition" .
:PendingCondition rdfs:subClassOf :ConditionStatus ;
  rdfs:label "Pending Condition" .
```

**OBDA change** (conditional type assertion per value):
```
mappingId	condition-status-active
target		:{condition_id} a :ActiveCondition .
source		SELECT condition_id FROM conditions WHERE status = 'Active'

mappingId	condition-status-inactive
target		:{condition_id} a :InactiveCondition .
source		SELECT condition_id FROM conditions WHERE status = 'Inactive'
```

**Alternative for 11–50 distinct values:** Use `owl:AnnotationProperty` with literal values:
```turtle
:hasStatus a owl:AnnotationProperty ;
  rdfs:label "status" ;
  rdfs:comment "Condition lifecycle status: Active, Inactive, Pending, ..." .
```

### Pattern 3: Numeric → Typed Datatype Property

**Trigger:** `classification: "numeric"`.

**Ontology change:**
```turtle
:claimAmount a owl:DatatypeProperty ;
  rdfs:domain :Claim ;
  rdfs:range xsd:decimal ;
  rdfs:label "claim amount" .
```

**OBDA change** (add `^^xsd:decimal`):
```
mappingId	claim-amount
target		:{claim_id} :claimAmount {amount}^^xsd:decimal .
source		SELECT claim_id, amount FROM claims
```

For integer quantities: `^^xsd:integer`. For scientific measures: `^^xsd:double`.

### Pattern 4: PK → URI Template + Functional Property

**Trigger:** Subject map uses `rr:column` instead of `rr:template` for the identity column.

**Ontology change:**
```turtle
:patientId a owl:DatatypeProperty, owl:FunctionalProperty ;
  rdfs:domain :Patient ;
  rdfs:range xsd:integer ;
  rdfs:label "patient identifier" .
```

**OBDA change** (already uses `{}` interpolation in template syntax — ensure the target triple uses IRI pattern):
```
mappingId	patient-class
target		:{patient_id} a :Patient ; :patientId {patient_id}^^xsd:integer .
source		SELECT patient_id FROM patients
```

### Pattern 5: Schema Names → Domain Vocabulary

**Trigger:** `schema_vocabulary_leak` quality flag — class/property IRIs have table-like names.

**Ontology change:**
```turtle
# Before:
:TBL_PATIENT a owl:Class .
:COL_DIAG_CODE a owl:DatatypeProperty .

# After:
:Patient a owl:Class ;
  rdfs:label "Patient" ;
  rdfs:comment "A person receiving medical care." .
:hasDiagnosisCode a owl:DatatypeProperty ;
  rdfs:domain :Patient ;
  rdfs:range xsd:string ;
  rdfs:label "diagnosis code" .
```

**OBDA change:** Update all class and predicate IRIs in target triples to match the renamed ontology terms.

## Presenting the Diff

Before editing files, show the user a summary like:

```
Proposed enrichments for this cycle (focused on poor_fk_modeling flag):

1. patient_id → condition_id FK: convert to :hasCondition object property
   - Ontology: add :hasCondition owl:ObjectProperty (domain: Patient, range: Condition)
   - OBDA: replace literal mapping with JOIN-based object property mapping
   - Expected: fk_object_property_ratio 0.0 → 0.5

2. status column (3 distinct values): add subclass hierarchy under :ConditionStatus
   - Ontology: add :ActiveCondition, :InactiveCondition, :PendingCondition subclasses
   - OBDA: add 3 conditional type assertions with WHERE filters
   - Expected: flat_ontology flag clears; leaf_class_ratio improves

Approve to proceed?
```

## After Editing

```bash
# Regenerate R2RML from OBDA
ontop mapping to-r2rml -i binding.obda -o binding.ttl

# Validate syntax
riot --validate ontology.ttl
riot --validate binding.ttl

# Structural validation (requires live DB)
ontop validate -m binding.obda -t ontology.ttl -p db.properties
```

If `ontop validate` fails: fix binding.obda and re-run before presenting to user.
