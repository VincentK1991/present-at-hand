# Step 3 Reference: Ontology Design and Turtle Authoring

This guide covers how to craft a high-quality ontology in `.ttl` for extraction + inference workflows.

## Design goals

A good ontology for this pipeline should be:

- semantically clear (human-readable and machine-usable)
- extraction-friendly (supports robust text mapping)
- inference-friendly (supports precise rule execution)
- evolvable (can absorb new corpora without major rewrite)

## Modeling process

1. Start from competency questions.
2. Define core classes first.
3. Define properties with domain/range.
4. Add controlled hierarchy (not flat, not over-deep).
5. Add labels and comments.
6. Validate syntax and logical sanity.

## Class design principles

## Principle 1: model stable concepts, not document phrases

Bad:

- class `AdultsWithDiagnosedHypertensionReceivedChecks`

Good:

- `ex:PopulationGroup`
- `ex:HealthCondition`
- `ex:HealthIndicator`

Why:

- stable concepts generalize across documents.
- phrase-level classes overfit corpus wording.

## Principle 2: avoid hierarchy extremes

Too flat:

- weak query specificity
- hard to attach targeted constraints

Too deep:

- complex maintenance
- brittle rule dependencies

Rule of thumb:

- make subclass edges only when they support real query/inference value.

## Property design principles

For each property, document:

- intended meaning
- expected subject class
- expected object class or datatype
- examples

Prefer explicit domain/range for high-value properties.

Example:

```turtle
@prefix ex: <http://localhost:4321/ontology/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

ex:HealthIndicator a owl:Class ;
  rdfs:label "Health Indicator" .

ex:DataSource a owl:Class ;
  rdfs:label "Data Source" .

ex:measuresIndicator a owl:ObjectProperty ;
  rdfs:domain ex:DataSource ;
  rdfs:range ex:HealthIndicator ;
  rdfs:label "measures indicator" .

ex:dataSourceDate a owl:DatatypeProperty ;
  rdfs:domain ex:DataSource ;
  rdfs:range xsd:gYear ;
  rdfs:label "data source year" .
```

## Datatype strategy

Choose strict or permissive typing intentionally.

Strict typed literals:

- pros: stronger validation and analytics
- cons: extraction failures on messy text formats

Permissive strings first:

- pros: robust ingestion
- cons: weak numeric/date querying

Recommended approach:

- type strictly when text quality is high and format is stable.
- otherwise ingest as string and add normalization rules later.

## Naming and style conventions

Recommended:

- classes: `PascalCase`
- properties: `camelCase`
- prefix: short and stable (`ex:` or domain-specific)
- labels: sentence case, explicit

Avoid:

- cryptic abbreviations
- plural class names without reason
- property names that embed direction ambiguity (`relatedTo`)

## Ontology anti-patterns

- class-per-row patterns (should be individuals or literals)
- unlabeled classes/properties
- properties without domain/range on important relations
- semantic duplication (`hasValue`, `measureValue`, `value` with overlapping intent)
- mixing schema and instance assertions in one uncontrolled file

## Validation checklist

Before extraction:

```bash
riot --validate ontology.ttl
```

Also verify:

- every core property has domain/range or documented reason not to
- class labels and property labels have high coverage
- competency questions map to explicit ontology paths

## Decision table: class vs individual

Model as class when:

- term is a reusable category
- many instances may belong to it

Model as individual when:

- term denotes one concrete named source/entity in this dataset

Example:

- `NationalHealthInterviewSurvey`
  - class if representing source-system type
  - individual if this dataset references one concrete source instance

## Practical references

- RDF 1.1 Concepts: https://www.w3.org/TR/rdf11-concepts/
- OWL 2 Primer: https://www.w3.org/TR/owl2-primer/
- SKOS reference (if controlled vocab needed): https://www.w3.org/TR/skos-reference/
