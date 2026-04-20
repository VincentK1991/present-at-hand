---
name: ontology-discovery
description: Use this skill to teach an LLM how to discover, validate, and iteratively improve an ontology and SPARQL inference rules from unstructured text using a user-in-the-loop workflow and measurable quality gates.
---

# ontology-discovery

Agent-oriented ontology discovery loop:

1. Read unstructured content.
2. Ask domain/subdomain questions with user in the loop.
3. Draft ontology `.ttl` and rule set (`rules/`, one `.rq` file per rule).
4. Run ontology-guided extraction.
5. Run forward-chaining inference.
6. Run quality metrics.
7. Improve ontology/rules and repeat until user approval.

This skill is decision-oriented and iterative: the goal is not just to run scripts, but to produce a high-quality ontology and inference rules that satisfy the user.

## Deep Reference Library (Table of Contents)

Use these references for detailed decision-making, examples, tradeoffs, and design rationale.

| Loop Step | Deep Reference |
| --- | --- |
| Step 1: Read unstructured content | [01-reading-unstructured-corpus.md](./references/01-reading-unstructured-corpus.md) |
| Step 2: User-in-the-loop domain interview | [02-domain-interview-and-competency-questions.md](./references/02-domain-interview-and-competency-questions.md) |
| Step 3: Ontology design and TTL authoring | [03-ontology-design-and-ttl-authoring.md](./references/03-ontology-design-and-ttl-authoring.md) |
| Step 3: Rule design (one file per rule) | [04-rule-design-and-sparql-construct.md](./references/04-rule-design-and-sparql-construct.md) |
| Step 4: Extraction execution and diagnostics | [05-extraction-with-extract-to-ttl.md](./references/05-extraction-with-extract-to-ttl.md) |
| Step 5: Inference execution and diagnostics | [06-inference-with-infer-to-ttl.md](./references/06-inference-with-infer-to-ttl.md) |
| Step 6: Metrics interpretation and quality diagnostics | [07-metrics-and-quality-diagnostics.md](./references/07-metrics-and-quality-diagnostics.md) |
| Step 7: Iterative optimization playbook | [08-iterative-improvement-research-playbook.md](./references/08-iterative-improvement-research-playbook.md) |
| End-to-end example | [09-end-to-end-worked-example.md](./references/09-end-to-end-worked-example.md) |

## Research-Rigor Expectations

The agent should behave like an ontology researcher, not a script runner:

- justify modeling decisions with evidence from corpus + user intent
- make tradeoffs explicit (precision vs recall, simplicity vs expressivity)
- run controlled iterations and compare metric deltas
- avoid broad changes without a clear hypothesis
- present assumptions, risks, and alternatives before finalizing ontology/rules

## When to Use

Use when the user asks to:

- discover or design an ontology from text
- build rule-based inference for KG enrichment
- validate ontology/rule quality with repeatable metrics
- iteratively improve ontology + inference performance

Do not use when the user only wants one-off extraction without ontology/rule refinement.

## Prerequisites

- Apache Jena CLI available (`riot`, `arq`, `shacl`)
- Node dependencies installed (`npm install` from skill root)
- `ANTHROPIC_API_KEY` set for extraction

## Portable Packaging and Use

This skill is portable as a standalone folder.

From the skill root:

```bash
npm install
cp .env.example .env
```

Run commands from the skill root using `./scripts/...`.

Quick checks:

```bash
riot --version
arq --version
shacl --version
npm run test:infer:smoke
```

## Required Artifacts and Conventions

- Ontology file: `*.ttl`
- Rules directory: `rules/`
- Rule format: one SPARQL `CONSTRUCT` rule per file, `.rq` extension
- Rule naming: `NN-name.rq` for deterministic order (`10-...`, `20-...`)
- Extraction output: asserted triples `.ttl`
- Inference output: inferred-only `.ttl` (optional closure `.ttl`)
- Metrics output: `json` or `md` report from `metrics.mjs`

Rule file contract:

- exactly one `CONSTRUCT { ... } WHERE { ... }` per `.rq` file
- include required prefixes at top
- keep rule intent narrow and testable

## Canonical Discovery Loop (Agent Protocol)

Run these steps in order for every cycle.

### Step 1: Read and Segment Unstructured Content

Objective: build a candidate concept/relation inventory before writing ontology terms.

Deep dive: [01-reading-unstructured-corpus.md](./references/01-reading-unstructured-corpus.md)

Actions:

- read input corpus/document(s)
- identify recurring entities, relations, attributes, units, temporal markers
- detect ambiguity, synonym clusters, and overloaded terms
- produce a short candidate vocabulary draft for user review

### Step 2: Domain/Subdomain Interview (User in the Loop)

Objective: lock scope and modeling intent before drafting ontology.

Deep dive: [02-domain-interview-and-competency-questions.md](./references/02-domain-interview-and-competency-questions.md)

Ask adaptive questions covering:

- primary domain and subdomain
- core entities and boundaries (in-scope vs out-of-scope)
- critical relations (what must be inferable)
- key literal attributes and expected datatypes
- temporal/granularity expectations
- competency questions (what queries should be answerable)
- precision vs recall preference for extraction/inference

Agent rules:

- summarize assumptions back to user
- do not proceed to ontology rewrite until assumptions are confirmed
- if conflicts appear, ask follow-up questions immediately

### Step 3: Draft / Revise Ontology and Rules

Objective: produce ontology + rules aligned to confirmed domain intent.

Deep dives:

- Ontology: [03-ontology-design-and-ttl-authoring.md](./references/03-ontology-design-and-ttl-authoring.md)
- Rules: [04-rule-design-and-sparql-construct.md](./references/04-rule-design-and-sparql-construct.md)

Ontology drafting rules:

- keep class hierarchy meaningful (not flat, not arbitrarily deep)
- define `rdfs:domain` / `rdfs:range` for high-value properties
- use explicit labels and clear names
- avoid catch-all classes/properties when a specific type exists

Rule drafting rules:

- one rule per file in `rules/`
- start with high-precision rules before broad/general rules
- encode inverses, type propagation, and transitive logic only when domain-justified
- avoid broad patterns that create noisy triples

### Step 4: Run Ontology-Guided Extraction

Deep dive: [05-extraction-with-extract-to-ttl.md](./references/05-extraction-with-extract-to-ttl.md)

Use:

```bash
node ./scripts/extract-to-ttl.mjs \
  --text <path/to/source.txt> \
  --ontology <path/to/ontology.ttl> \
  --output <path/to/asserted.ttl> \
  --base-iri <https://example.org/resource/> \
  --mode create \
  --output-format ttl
```

Validation gate:

```bash
riot --validate <path/to/asserted.ttl>
```

### Step 5: Run Inference

Deep dive: [06-inference-with-infer-to-ttl.md](./references/06-inference-with-infer-to-ttl.md)

Use:

```bash
node ./scripts/infer-to-ttl.mjs \
  --ontology <path/to/ontology.ttl> \
  --triples <path/to/asserted.ttl> \
  --rules <path/to/rules> \
  --output <path/to/inferred.ttl> \
  --output-format ttl \
  --iterate true \
  --max-iterations 10
```

Debug mode (recommended when quality is low):

```bash
node ./scripts/infer-to-ttl.mjs \
  --ontology <path/to/ontology.ttl> \
  --triples <path/to/asserted.ttl> \
  --rules <path/to/rules> \
  --output <path/to/inferred.ttl> \
  --strict-rule-order true \
  --write-closure <path/to/closure.ttl> \
  --snapshot-dir /tmp/onto-infer-snapshots
```

Validation gate:

```bash
riot --validate <path/to/inferred.ttl>
```

### Step 6: Measure Quality with Metrics

Deep dive: [07-metrics-and-quality-diagnostics.md](./references/07-metrics-and-quality-diagnostics.md)

Use:

```bash
node ./scripts/metrics.mjs \
  --ontology <path/to/ontology.ttl> \
  --asserted <path/to/asserted.ttl> \
  --inferred <path/to/inferred.ttl> \
  --rules <path/to/rules> \
  --format md \
  --output <path/to/metrics.md>
```

Or:

```bash
npm run metrics -- --ontology <path/to/ontology.ttl> --format json
```

### Step 7: Improve and Repeat

Objective: use metrics + user feedback to revise ontology/rules and re-run steps 1-6.

Deep dive: [08-iterative-improvement-research-playbook.md](./references/08-iterative-improvement-research-playbook.md)

Prioritization policy: balance ontology structure quality and inference quality together.

Stop criterion: loop ends only after explicit user approval.

Worked end-to-end example: [09-end-to-end-worked-example.md](./references/09-end-to-end-worked-example.md)

## Quality Interpretation Guide (How to Improve)

Use this decision table each cycle.

- `flat_hierarchy` or very high leaf ratio:
  - add meaningful subclass structure
  - split overloaded classes
- low domain/range coverage:
  - add `rdfs:domain` / `rdfs:range` for frequent properties
- low typed-subject coverage:
  - improve class definitions and typing rules
  - tighten extraction prompts through ontology vocabulary clarity
- high dead-rule count:
  - remove, merge, or rewrite rules whose WHERE conditions never activate
- high inference gain with low precision:
  - tighten WHERE patterns and add type constraints
  - move broad rules later or remove them
- SHACL violations present:
  - align ontology constraints with actual data and rule outputs

## Cycle Output Contract (What the Agent Must Report Each Iteration)

At the end of each cycle, report:

1. domain/subdomain assumptions confirmed with user
2. ontology changes summary
3. rule changes summary (added/updated/removed `.rq`)
4. extraction command and result summary
5. inference command and result summary
6. metrics highlights and quality flags
7. concrete next improvements for next cycle
8. explicit question: approve or continue another refinement loop

## Validation and Safety Gates

Must pass each cycle:

```bash
riot --validate <ontology.ttl>
riot --validate <asserted.ttl>
riot --validate <inferred.ttl>
```

Recommended checks:

```bash
riot --count <asserted.ttl>
riot --count <inferred.ttl>
npm run test:infer:smoke
```

If any gate fails, fix ontology/rules and re-run before presenting results.

## Tool Summary

- `scripts/extract-to-ttl.mjs`: ontology-guided structured extraction
- `scripts/infer-to-ttl.mjs`: SPARQL CONSTRUCT fixpoint inference
- `scripts/metrics.mjs`: grouped quality metrics and flags
- `scripts/test-infer-smoke.mjs`: deterministic inference regression smoke test

## Limitations

- No named graph semantics in current pipeline output.
- No automatic semantic conflict resolution between competing ontology designs.
- Rule quality is only as good as rule specificity and validated user intent.
