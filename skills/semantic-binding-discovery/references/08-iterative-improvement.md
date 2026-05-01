# 08 — Iterative Improvement

## Objective

Use quality flags and richness metric deltas to drive controlled, hypothesis-based improvement cycles. Each cycle changes ONE primary concern.

## Research Mindset

Treat each cycle as an experiment:
1. **Observe** — which quality flags are present? which dimension has the lowest score?
2. **Hypothesize** — what is the root cause? (e.g., "FK columns are still literal predicates because bootstrap didn't use rr:refObjectMap")
3. **Intervene minimally** — propose the smallest change that targets the hypothesis
4. **Measure** — re-run `richness-metrics.mjs`; compare delta
5. **Keep or revert** — if the target metric improved without regressions, keep; otherwise revert

Never make broad changes across all dimensions simultaneously. You can't diagnose regressions if you changed everything at once.

## Decision Table

| Dominant signal | Root cause hypothesis | Cycle action |
|---|---|---|
| `flat_ontology` flag | No subclass hierarchy; bootstrap produced one class per table | Add subclasses for low-cardinality columns OR split overloaded entity classes |
| `poor_fk_modeling` flag | FK columns mapped as literals, not object properties | Convert FK predicate maps to `rr:refObjectMap` with JOIN source |
| `unlabeled_ontology` flag | No `rdfs:label`/`rdfs:comment` on classes and properties | Systematic labeling pass — add labels to all unmapped terms |
| `schema_vocabulary_leak` flag | Class/property names are schema identifiers | Renaming pass — replace with domain terms; update all mapping IRIs |
| `low_cardinality_uncovered` flag | Low-cardinality columns left as free-text literals | Add subclass conditional type assertions or annotation property |
| No flags, low `max_subclass_depth` | Hierarchy is shallow but not flagged | Deepen hierarchy where domain-justified (not mechanical) |
| No flags, low `numeric_typed_ratio` | Numeric columns typed as strings | Add `rr:datatype` to binding, `rdfs:range` to ontology |
| User reports competency question fails | Missing object property or class assertion | Trace CQ → SPARQL → binding → missing mapping; add targeted mapping |

## Sub-Playbooks

### When `flat_ontology` fires

1. Look at `schema-report.json` for `low_cardinality` predicates
2. Pick the most semantically meaningful one (e.g., `status`, `type`, `category`)
3. Sample distinct values via `ontop query`:
   ```bash
   ontop query -m binding.obda -t ontology.ttl -p db.properties -q /dev/stdin <<'Q'
   SELECT DISTINCT ?v WHERE { ?s :status ?v }
   Q
   ```
4. Propose subclass hierarchy to user
5. Add conditional type assertions with `WHERE status = '...'` in OBDA source

### When `poor_fk_modeling` fires

1. Look at `schema-report.json` for `fk` predicates
2. Identify which FK is most important (from user competency questions)
3. Find the parent table's subject map template (PK URI pattern)
4. Replace literal predicate mapping with:
   ```
   mappingId  entityA-hasEntityB
   target     :{pkA} :hasEntityB :{pkB} .
   source     SELECT a.pkA, b.pkB FROM tableA a JOIN tableB b ON a.fk = b.pkB
   ```
5. Add `owl:ObjectProperty` with `rdfs:domain`/`rdfs:range` to ontology

### When competency question fails

Given CQ: "Which patients have an Active condition?"

1. Write the expected SPARQL:
   ```sparql
   SELECT ?patient WHERE {
     ?patient a :Patient .
     ?patient :hasCondition ?condition .
     ?condition a :ActiveCondition .
   }
   ```
2. Test against live VKG via `ontop query`
3. If no results: check if `:hasCondition` mapping exists and `:ActiveCondition` type assertion exists
4. If missing: add them (FK object property + conditional type mapping)
5. Rerun CQ

## Cycle Scope Policy

Each cycle should target **one** of these:
- Ontology vocabulary (labels, renaming, hierarchy)
- Object property modeling (FK → object property)
- SQL pattern coverage (low-cardinality, numeric typing)
- Alignment fix (unknown term in binding)

Mixing concerns makes metric interpretation ambiguous.

## Stop Criteria

The improvement loop ends when:
1. All quality flags are cleared (or user explicitly accepts residual flags)
2. All confirmed competency questions return results via `ontop query`
3. User explicitly approves the current state

Do not stop on a metrics plateau alone — ask the user to confirm.

## Anti-patterns

- **Enriching for metric score, not semantics.** Adding subclasses just to lower `leaf_class_ratio` without domain justification creates a brittle ontology.
- **Bulk renaming without user confirmation.** Renaming 20 classes in one cycle is risky — one wrong rename breaks all mappings that use that IRI.
- **Fixing alignment errors by relaxing the ontology.** Don't add dummy classes just to make binding terms "align." Fix the binding IRI instead.
- **Skipping structural validation after edits.** Always run `ontop validate` and `riot --validate` before presenting results to the user.

## Cycle Output Template

```markdown
## Cycle N Summary

### Assumptions confirmed
- [any new clarifications from user this cycle]

### Ontology changes
- Added: [classes/properties]
- Renamed: [old → new]
- Removed: [terms]

### Binding changes
- Converted: [predicates → object properties]
- Added: [new mappings]
- Updated: [modified source SQL]

### Validation
- ontop validate: [PASS/FAIL]
- riot --validate ontology.ttl: [PASS/FAIL]
- riot --validate binding.ttl: [PASS/FAIL]
- Alignment gate (unknown terms): [0 unknown / N unknown]

### Richness delta
| Dimension | Prev | Now |
|---|---|---|
| leaf_class_ratio | X | Y |
| fk_object_property_ratio | X | Y |
| class_with_label_ratio | X | Y |
| low_cardinality_coverage_ratio | X | Y |

### Quality flags
- Cleared: [flag names]
- Remaining: [flag names]

### Next cycle proposal
[one focused improvement]

**Approve to close, or continue another cycle?**
```
