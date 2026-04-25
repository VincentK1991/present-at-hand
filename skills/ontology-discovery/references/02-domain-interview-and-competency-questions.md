# Step 2 Reference: Domain Interview and Competency Questions

This step turns raw term extraction into a domain-validated modeling contract with the user.

## Why this step matters

Ontology quality is mostly a scoping problem. Wrong scope creates either:

- flat, vague ontologies (too broad), or
- brittle overfit ontologies (too narrow)

A strong interview prevents both.

## Interview objective

Lock:

- domain and subdomain boundaries
- intended use-cases
- precision vs recall preference
- acceptable simplifications

The output is a confirmed modeling charter.

## Adaptive interview strategy

Start with a fixed core, then branch based on answers.

## Core questions (always ask)

1. What is the primary domain and subdomain?
2. What decisions should this KG support?
3. Which entities are in-scope vs out-of-scope?
4. Which relations must be inferable?
5. Which metrics matter most: precision, recall, interpretability, or coverage?

## Branch questions (ask as needed)

If user says "policy reporting":

- Ask about reporting granularity (state, county, national).
- Ask whether historical comparability is required.

If user says "clinical data":

- Ask whether encounter-level or cohort-level modeling is required.
- Ask privacy and de-identification constraints.

If user is unsure:

- Offer 2-3 scope options and tradeoffs.

## Competency questions

Competency questions are testable natural-language queries the ontology must support.

Examples:

- "Which indicators measured hypertension in 2018?"
- "What observed entities are linked to each state?"
- "Which measures were inferred but not directly asserted?"

Why they matter:

- They define success criteria.
- They drive class/property/rule design.
- They prevent vanity ontology features.

## Good vs weak question style

Weak:

- "Do you want a healthcare ontology?"

Good:

- "Should `NationalHealthInterviewSurvey` be modeled as a reusable class of source systems, or a concrete individual source in this dataset?"

Weak:

- "Do you need dates?"

Good:

- "Do you need year-level comparability (xsd:gYear), or full observation timestamps (xsd:dateTime)?"

## Interview output template

```markdown
## Confirmed Scope
- Domain: Public health indicators
- Subdomain: Hypertension-related monitoring and reporting

## In-Scope Entities
- HealthIndicator
- HealthCondition
- GeographicUnit
- DataSource

## Required Inferences
- inverse links (measuresIndicator / isMeasuredBy)
- type propagation (measureValue -> HealthDisparityMeasure)

## Competency Questions
1. ...
2. ...

## Modeling Preferences
- prioritize precision over recall
- prefer explicit typing over implicit assumptions

## Open Risks
- ...
```

## Decision tradeoffs to discuss with user

## Precision vs recall

- Precision-first:
  - pros: fewer false triples, cleaner inference
  - cons: lower coverage
- Recall-first:
  - pros: broader discovery
  - cons: more cleanup needed

## Class granularity

- coarse classes:
  - pros: faster initial build
  - cons: weaker query power, fewer constraints
- fine-grained classes:
  - pros: stronger semantics and rules
  - cons: higher maintenance complexity

## Literal typing strictness

- strict datatypes:
  - pros: stronger validation and query semantics
  - cons: extraction failures if text is messy
- permissive strings first:
  - pros: robust ingestion
  - cons: weaker downstream analytics

## Anti-patterns

- Asking generic yes/no questions only.
- Failing to restate assumptions back to user.
- Proceeding with ontology edits before user confirms scope.

## Exit criteria for Step 2

Do not proceed to ontology drafting until:

- domain/subdomain is confirmed
- 3-10 competency questions are agreed
- precision/recall preference is explicit
- major ambiguities are either resolved or documented

## Practical references

- Ontology Requirements Specification Document (ORSD) pattern:
  - https://protege.stanford.edu/publications/ontology_development/ontology101.pdf
- Competency question practice:
  - https://www.w3.org/2001/sw/BestPractices/OEP/
