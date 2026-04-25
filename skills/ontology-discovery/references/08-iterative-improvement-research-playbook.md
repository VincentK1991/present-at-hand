# Step 7 Reference: Iterative Improvement Playbook (World-Class Research Mode)

This guide defines how to run ontology discovery as disciplined research, not ad hoc tweaking.

## Research mindset

A strong ontology researcher runs explicit hypothesis loops:

1. observe signal (metrics + errors + user feedback)
2. form hypothesis
3. apply minimal targeted change
4. rerun pipeline
5. compare deltas
6. keep/revert based on evidence

Avoid batch-changing everything at once. You lose causality.

## Loop structure per iteration

## A. Evidence collection

Collect:

- extraction warnings
- inference logs
- metrics report
- user judgment on output relevance

## B. Hypothesis formation

Examples:

- "Low typed coverage is due to missing class definitions for source indicators."
- "Dead rule count is high because inverse rules assume types that are never asserted."

## C. Minimal intervention

Apply smallest change that could falsify hypothesis:

- add one domain/range pair
- add one type propagation rule
- split one broad class
- tighten one rule WHERE clause

## D. Controlled rerun

Run full 1-6 pipeline again and compare only target metrics first.

## E. Decision

- keep if target metrics improve without harmful regressions
- revert if no clear gain

## Prioritization strategy

Use balanced quality objective:

- ontology quality and inference quality must improve together
- do not maximize inferred count at expense of semantic precision

Priority order:

1. semantic correctness
2. query usefulness (competency question coverage)
3. robustness across corpus variation
4. runtime/performance

## Improvement patterns

## Pattern 1: ontology under-specification

Symptoms:

- low domain/range coverage
- ambiguous extraction mappings

Actions:

- add missing domain/range on high-frequency properties
- add labels/comments clarifying intended semantics

## Pattern 2: over-broad rules

Symptoms:

- high inference gain but low trust
- many generic inferred edges

Actions:

- add type guards
- narrow joins to domain predicates
- stage rules into ordered files

## Pattern 3: extraction misses key entities

Symptoms:

- poor downstream inference despite good rules

Actions:

- refine ontology vocabulary (class/property naming clarity)
- tune chunking parameters conservatively
- add explicit entity-defining relations in ontology

## Pattern 4: persistent SHACL violations

Symptoms:

- repeated same-component violations across iterations

Actions:

- decide whether ontology should be stricter or data should be normalized
- avoid silently relaxing shapes unless user agrees on reduced rigor

## Tradeoff decision framework

When precision and recall conflict:

- if use case is compliance/regulatory reporting -> favor precision
- if use case is exploratory discovery -> allow controlled recall

When complexity and coverage conflict:

- if maintainability is priority -> favor simpler ontology with clear extension points
- if high semantic fidelity is required -> accept added complexity with documentation

## Iteration report format (recommended)

```markdown
## Iteration N
### Changes
- Ontology: ...
- Rules: ...

### Metrics Delta
- typed_subject_coverage_ratio: 0.62 -> 0.78
- dead_rule_count: 4 -> 1
- inference_gain: 1.9 -> 1.2

### User Validation
- Confirmed relevant: ...
- Flagged wrong: ...

### Decision
- Keep change set A
- Rework rule 30-...
```

## Stop criteria

This skill uses explicit user approval as final stop.

Recommended "ready to approve" checklist:

- competency questions are answerable
- no critical SHACL violations (or user-accepted waivers)
- no major unresolved quality flags
- user confirms semantic relevance and usefulness

## Common failure modes of advanced agents

- Optimizing metrics without checking meaning.
- Overfitting ontology to one corpus sample.
- Adding many rules to mask ontology modeling weaknesses.
- Ignoring user disagreement because metrics improved.

## External references for deeper research practice

- Ontology Development 101: https://protege.stanford.edu/publications/ontology_development/ontology101.pdf
- OBO Foundry principles (quality governance ideas):
  - https://obofoundry.org/principles/fp-000-summary.html
