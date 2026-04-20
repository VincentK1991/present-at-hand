# Worked Example: Two Iterations from Raw Text to Improved Ontology

This example shows how the loop behaves in practice.

## Scenario

Corpus contains public health passages about:

- diagnosed hypertension
- blood pressure check rates
- source systems and reporting year

Goal:

- produce ontology + rules that support reliable indicator inference and reporting queries.

## Iteration 1

## Step 1-2 outcomes (reading + interview)

User confirms:

- domain: public health indicators
- subdomain: hypertension monitoring
- preference: balanced precision/recall, but avoid noisy inferred facts

Competency questions:

1. Which indicators are measured by each source?
2. Which indicator values are tied to year-level reporting?

## Step 3 draft

Ontology v1 includes:

- `ex:HealthIndicator`
- `ex:DataSource`
- `ex:measuresIndicator` (object property)
- `ex:measureValue` (datatype property, string in v1)

Rules v1:

- `10-measures-inverse.rq`
- `20-measurevalue-typing.rq`

## Step 4-6 run

After extraction + inference + metrics:

- typed coverage: medium
- inference gain: high
- dead rules: 0
- quality flag: low domain/range coverage
- user feedback: some inferred triples semantically weak

## Decision

Main hypothesis:

- ontology is under-constrained and allows broad rule firing.

## Iteration 2

## Changes

Ontology v2:

- add domain/range for key properties
- split ambiguous class into `HealthCondition` and `HealthIndicator`
- datatype tighten `dataSourceDate` to `xsd:gYear`

Rules v2:

- add type guards in inverse rule
- narrow measure typing rule to specific classes

Example rule tightening:

Before:

```sparql
CONSTRUCT { ?x rdf:type ex:HealthDisparityMeasure }
WHERE { ?x ex:measureValue ?v }
```

After:

```sparql
PREFIX ex: <http://localhost:4321/ontology/>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

CONSTRUCT { ?x rdf:type ex:HealthDisparityMeasure }
WHERE {
  ?x ex:measureValue ?v .
  ?x rdf:type ex:HealthIndicator .
}
```

## Re-run and compare

Observed deltas:

- inference gain reduced to healthier range
- irrelevant inferred triples reduced
- typed coverage improved
- user accepts semantic quality

## Lessons

1. Tightening ontology constraints often improves rule quality more than adding more rules.
2. Type guards are the highest-leverage inference precision control.
3. User competency questions keep iteration focused on useful semantics.

## Commands used in this example

```bash
node ./scripts/extract-to-ttl.mjs \
  --text <path/to/source.txt> \
  --ontology <path/to/ontology.ttl> \
  --output <path/to/asserted.ttl> \
  --base-iri <https://example.org/resource/> \
  --mode create
```

```bash
node ./scripts/infer-to-ttl.mjs \
  --ontology <path/to/ontology.ttl> \
  --triples <path/to/asserted.ttl> \
  --rules <path/to/rules> \
  --output <path/to/inferred.ttl> \
  --strict-rule-order true \
  --write-closure <path/to/closure.ttl>
```

```bash
node ./scripts/metrics.mjs \
  --ontology <path/to/ontology.ttl> \
  --asserted <path/to/asserted.ttl> \
  --inferred <path/to/inferred.ttl> \
  --rules <path/to/rules> \
  --format md \
  --output <path/to/metrics.md>
```
