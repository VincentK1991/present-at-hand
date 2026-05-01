# 02 — Domain Interview and Competency Questions

## Objective

Lock domain scope and ontology expectations before touching OBDA or ontology files. The interview prevents the most common failure mode: enriching the ontology in directions the user doesn't care about.

**This is a hard gate. Do not modify `binding.obda` or `ontology.ttl` until the user confirms Stage 2 assumptions.**

## Why the Interview Matters

`ontop bootstrap` produces a flat direct mapping — every table becomes a class, every column becomes a datatype property. The agent can propose dozens of enrichments from that baseline. Without user input:
- You might enrich FK columns the user considers implementation details
- You might rename classes to domain terms the user doesn't recognize
- You might create subclass hierarchies for status values that the user wants to keep flat
- You miss which SPARQL queries actually need to be answerable

## Core Questions to Ask

Ask adaptively — not all questions need to be asked every time.

### 1. Primary vs secondary tables
> "Which tables represent the core domain concepts you want to query about?"  
> "Which tables are lookup tables, junction tables, or implementation details you don't want as first-class ontology classes?"

### 2. Target vocabulary
> "Should class names use domain terms (e.g., `Patient`, `Encounter`) or is the schema naming fine as-is?"  
> "Are there existing ontologies you want to align to? (e.g., SNOMED, FHIR, schema.org, a custom domain ontology)"

### 3. Critical relationships
> "Which foreign key relationships are semantically important to you? (e.g., 'a Patient *has* Conditions' vs 'order_id → orders table' which is just plumbing)"  
> "Are there columns that act as shared identifiers across tables that should become the join axis for object properties?"

### 4. Identity columns
> "Which columns carry the domain identity of an entity (not just a DB surrogate key)? These become URI templates."  
> "Should the SPARQL endpoint expose entities by their domain ID or by a DB-internal ID?"

### 5. Cardinality threshold
> "What counts as a 'low-cardinality' column for you — one that should become a class hierarchy or classification property rather than a free-text literal?"  
> Default: ≤ 50 distinct values. Adjust if the user has a specific domain expectation.

### 6. Competency questions (CQs)
> "What are 3–5 questions you want the SPARQL endpoint to be able to answer?"  
> "I'll use these as success criteria for each iteration."

**Good CQs:** Specific, answerable with SPARQL, tied to domain concepts.
- "Which patients have a Condition with status 'Active' and were seen after 2022?"
- "What is the total claim amount for each patient, grouped by condition code?"
- "Which providers performed more than 10 encounters last year?"

**Weak CQs:** Too broad, vague, or just restating schema column names.
- "Give me all patients" (no enrichment needed for this)
- "Show me the data" (not a query)

### 7. Precision vs coverage
> "Would you rather have a smaller set of deeply enriched properties, or broad coverage of all columns?"

## Confirming Assumptions

Before ending Stage 2, summarize back to the user:

```
Confirmed assumptions:
- Primary entity tables: Patient, Condition, Claim
- Lookup tables: condition_code (will not become a class)
- FKs to model as object properties: patient_id → Patient, condition_id → Condition
- URI key column: patient_id (for Patient), condition_id (for Condition)
- Low-cardinality threshold: 50 distinct values
- Competency questions:
  1. Which patients have an Active condition?
  2. Total claim amount per patient?
  3. Which conditions have claims filed in 2024?
- Preference: semantic depth over broad coverage

Is this correct? Anything to adjust before I proceed?
```

Do not proceed until the user explicitly confirms.

## Adaptive Branching

| User answer | Implication |
|---|---|
| "Align to FHIR" | Use FHIR resource IRIs as superclasses; label properties with FHIR element names |
| "No hierarchy, keep it flat" | Skip subclass creation for low-cardinality columns; use annotation properties instead |
| "Schema names are fine" | Skip domain-term renaming; focus on domain/range and object properties |
| "Coverage over depth" | Map all columns; skip deep subclass work |
| "We have a domain glossary" | Ask for it before proceeding; use it to drive vocabulary choices |

## Stop Criteria for Stage 2

Stage 2 is complete when:
1. Primary entity tables are identified
2. FK relationships to promote to object properties are agreed
3. At least 3 competency questions are confirmed
4. User has approved the assumption summary
