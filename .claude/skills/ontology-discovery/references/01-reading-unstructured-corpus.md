# Step 1 Reference: Reading Unstructured Content Like an Ontology Researcher

This guide explains how to read source text to extract ontology signal, not just summarize prose.

## Why this step matters

If you skip careful corpus reading, the ontology will encode accidental wording instead of stable domain semantics. That leads to:

- brittle class/property names
- noisy extraction
- low-quality rules that overfit examples

Good ontology work starts with lexical and conceptual evidence from text.

## Core objective

Build a candidate semantic inventory:

- domain entities
- relation candidates
- attributes and units
- temporal and spatial dimensions
- uncertainty/negation markers

Output of this step should be a structured draft inventory, not final ontology.

## Reading protocol

1. Do a fast pass for topic framing.
2. Do a slow pass for concept harvesting.
3. Build normalized term clusters (synonyms, variants).
4. Separate "thing types" from "measurements" from "events".
5. Capture relation phrases with directionality.
6. Record ambiguity and open questions for user interview.

## What to extract and how

## 1. Entity candidates

Look for nouns and noun phrases that appear repeatedly in stable contexts.

Example text:

> "Adults with diagnosed hypertension received blood pressure checks in 2018."

Candidate entities:

- `Person` or `PopulationGroup` (depends on scope)
- `HealthCondition` (`DiagnosedHypertension`)
- `HealthIndicator` (`BloodPressureCheck`)

Decision point:

- If term denotes a category/type, model as class.
- If term denotes one concrete source item, model as individual.

Pros and cons:

- Class-heavy early model:
  - pros: reusable schema
  - cons: may miss concrete identifiers
- Individual-heavy early model:
  - pros: easier extraction grounding
  - cons: can become instance soup without reusable structure

## 2. Relation candidates

Capture verbs and relational phrases with subject/object roles.

Examples:

- "measures indicator"
- "for state"
- "reported in year"

For each relation candidate record:

- canonical relation name
- observed textual variants
- expected domain/range classes
- whether relation is directional

## 3. Attribute candidates

Detect literal-bearing fields:

- percentages
- counts
- dates/years
- identifiers/codes

Example:

- `"84.6%"` -> `measureValue` (string, decimal, or quantity model decision)
- `"2018"` -> `dataSourceDate` (`xsd:gYear`)

Decision:

- keep simple literal (`xsd:string`) early for robustness
- or strongly type now (`xsd:decimal`, `xsd:gYear`) for stronger validation

## 4. Context dimensions

Extract dimensions that frequently scope facts:

- geography
- time window
- demographic strata
- source dataset provenance

These often become key classes/properties and rule anchors.

## 5. Negation and uncertainty

Mark patterns like:

- "not reported"
- "unknown"
- "estimated"

Why:

- prevents invalid positive assertions
- helps define exclusion or evidence quality policies

## Output template (recommended)

Produce this artifact before Step 2:

```markdown
## Candidate Entity Types
- HealthIndicator: "blood pressure check", "public health plan coverage"
- HealthCondition: "diagnosed hypertension"

## Candidate Relations
- measuresIndicator (subject: HealthIndicator, object: IndicatorSource)
- forState (subject: Observation, object: State)

## Candidate Attributes
- measureValue (literal)
- dataSourceDate (xsd:gYear)

## Ambiguities / Questions
- Is "National Health Interview Survey" a class of source or an individual source?
- Should percentages be typed decimal or kept as string with percent suffix?
```

## Anti-patterns

- Modeling every noun as a class.
- Treating every document phrase as ontology vocabulary.
- Ignoring units and time.
- Finalizing class hierarchy before user confirms scope.

## Quality checks before moving to Step 2

- At least 10-20 high-confidence candidate terms (for medium corpus).
- Synonym mapping created for major terms.
- Ambiguities explicitly listed for user interview.

## Practical references

- RDF 1.1 Concepts: https://www.w3.org/TR/rdf11-concepts/
- OWL 2 Primer: https://www.w3.org/TR/owl2-primer/
