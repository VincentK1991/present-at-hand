# Step 3 Reference: Rule Design with SPARQL CONSTRUCT (One Rule Per File)

This guide explains how to write high-quality inference rules for `infer-to-ttl.mjs`.

## Why one rule per file

One rule per `.rq` file provides:

- deterministic execution ordering (`NN-name.rq`)
- per-rule timing and dead-rule diagnostics
- easier review and rollback
- lower risk when tuning rule specificity

This is not just style; it is operational quality control.

## Rule classes you should prioritize

1. Inverse relation rules
2. Type propagation rules
3. Controlled transitive closure rules
4. Rule chains with explicit constraints

Start narrow. Add broad rules only after precision is measured.

## Template for a high-quality rule file

```sparql
PREFIX ex: <http://localhost:4321/ontology/>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

# Intent:
#   Derive inverse edge so source-centric and indicator-centric queries both work.
# Assumptions:
#   ex:measuresIndicator is asserted with correct domain/range.
# Expected novelty:
#   Moderate.

CONSTRUCT {
  ?indicator ex:isMeasuredBy ?source .
}
WHERE {
  ?source ex:measuresIndicator ?indicator .
  ?source rdf:type ex:DataSource .
  ?indicator rdf:type ex:HealthIndicator .
}
```

## Why type guards matter

Without type guards, rules can overfire on noisy triples.

With type guards:

- precision improves
- inference gain is more interpretable
- dead-rule diagnosis becomes meaningful

Tradeoff:

- strict guards can underfire if typing coverage is low
- fix by improving typing ontology/rules, not by removing all guards

## Common rule patterns

## 1. Inverse property

```sparql
CONSTRUCT { ?b ex:inverseOfA ?a }
WHERE     { ?a ex:relationA ?b }
```

## 2. Type from evidence relation

```sparql
CONSTRUCT { ?x rdf:type ex:HealthDisparityMeasure }
WHERE     { ?x ex:measureValue ?v }
```

## 3. Transitive closure (controlled)

```sparql
CONSTRUCT { ?a ex:ancestorOf ?c }
WHERE {
  ?a ex:ancestorOf ?b .
  ?b ex:ancestorOf ?c .
  FILTER(?a != ?c)
}
```

Note:

- Always include anti-self-loop safeguards where needed.

## Rule quality anti-patterns

- unconstrained wildcard joins (`?s ?p ?o`) in core derivation logic
- inferring types from weak signals without domain constraints
- combining multiple unrelated derivations in one file
- using transitive rules without loop control

## Rule ordering strategy

Use filename order as staged inference:

- `10-...`: foundational inverses/type guards
- `20-...`: second-order derivations
- `30-...`: transitive/aggregated derivations

Pros:

- easier debugging and snapshots
- predictable strict-rule-order behavior

## How to evaluate a rule

Use metrics from `metrics.mjs` and inference logs:

- `dead_rule_count`
- per-rule `constructed_triple_count`
- `novel_vs_input_count`
- global inference gain and quality flags

Interpretation:

- high construct + low novelty -> redundant rule
- low construct + high business value -> keep but monitor
- high novelty + noisy output -> tighten WHERE

## Example refinement cycle

Observed issue:

- high inference gain and low trust

Action:

- add class guards in WHERE
- add `FILTER NOT EXISTS` for contradictory states
- rerun inference and metrics

Expected result:

- lower inferred count
- higher precision and fewer quality warnings

## Practical references

- SPARQL 1.1 Query: https://www.w3.org/TR/sparql11-query/
- Apache Jena ARQ docs: https://jena.apache.org/documentation/query/
