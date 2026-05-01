#!/usr/bin/env node
/**
 * richness-metrics.mjs
 *
 * Computes 4-dimension semantic binding richness scores from ontology.ttl,
 * binding.ttl (R2RML), and schema-report.json (from explore-schema.mjs).
 *
 * Dimensions:
 *   1. Semantic concept depth    — class hierarchy, domain/range coverage
 *   2. Relational expressiveness — FK→object property ratio, functional properties
 *   3. Domain vocabulary quality — rdfs:label coverage, schema-name leak
 *   4. SQL pattern coverage      — low-cardinality modeled, numeric typed
 *
 * Shells out to: arq (ontology/binding SPARQL), robot metrics (OWL axiom counts)
 *
 * Usage:
 *   node richness-metrics.mjs \
 *     --ontology ontology.ttl \
 *     --binding binding.ttl \
 *     --schema-report schema-report.json \
 *     [--format json|md] \
 *     [--output richness-metrics.md]
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// --- CLI ---

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : null;
}

const ontology = flag('--ontology');
const binding = flag('--binding');
const schemaReport = flag('--schema-report');
const format = flag('--format') ?? 'json';
const output = flag('--output');

if (!ontology || !binding) {
  console.error('Usage: richness-metrics.mjs --ontology <ontology.ttl> --binding <binding.ttl> [--schema-report <schema-report.json>] [--format json|md] [--output <path>]');
  process.exit(1);
}
for (const f of [ontology, binding].filter(Boolean)) {
  if (!existsSync(f)) { console.error(`File not found: ${f}`); process.exit(1); }
}

// --- ARQ helper ---

const _tmpDir = mkdtempSync(join(tmpdir(), 'richness-metrics-'));
let _qCount = 0;

function arqQuery(query, ...dataFiles) {
  const qFile = join(_tmpDir, `q${_qCount++}.rq`);
  writeFileSync(qFile, query);
  const dataArgs = dataFiles.filter(Boolean).map(f => `--data "${f}"`).join(' ');
  const cmd = `arq ${dataArgs} --query "${qFile}" --results JSON`;
  try {
    const result = execSync(cmd, { encoding: 'utf8' });
    return JSON.parse(result);
  } catch {
    return { results: { bindings: [] } };
  }
}

process.on('exit', () => { try { rmSync(_tmpDir, { recursive: true }); } catch {} });

function bindings(arqResult) { return arqResult?.results?.bindings ?? []; }
function val(b, v) { return b[v]?.value ?? null; }
function intVal(b, v) { return parseInt(val(b, v) ?? '0', 10); }

// --- Ontology metrics via ARQ ---

console.log('Computing ontology structure metrics...');

function countQuery(sparql, varName, ...files) {
  const rows = bindings(arqQuery(sparql, ...files));
  return rows.length > 0 ? intVal(rows[0], varName) : 0;
}

const classCount = countQuery(
  'PREFIX owl: <http://www.w3.org/2002/07/owl#>\nSELECT (COUNT(DISTINCT ?c) AS ?n) WHERE { ?c a owl:Class . FILTER(isIRI(?c)) }',
  'n', ontology
);

const subclassCount = countQuery(
  'PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\nSELECT (COUNT(DISTINCT ?c) AS ?n) WHERE { ?c rdfs:subClassOf ?p . FILTER(isIRI(?c)) FILTER(isIRI(?p)) }',
  'n', ontology
);

const leafClassCount = countQuery(
  'PREFIX owl: <http://www.w3.org/2002/07/owl#>\nPREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\nSELECT (COUNT(DISTINCT ?c) AS ?n) WHERE { ?c a owl:Class . FILTER(isIRI(?c)) FILTER NOT EXISTS { ?child rdfs:subClassOf ?c . FILTER(isIRI(?child)) } }',
  'n', ontology
);

const maxSubclassDepthRows = bindings(arqQuery(
  `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
SELECT (MAX(?depth) AS ?maxDepth) WHERE {
  SELECT ?c (COUNT(?ancestor) AS ?depth) WHERE {
    ?c a owl:Class . FILTER(isIRI(?c))
    OPTIONAL { ?c rdfs:subClassOf+ ?ancestor . FILTER(isIRI(?ancestor)) }
  } GROUP BY ?c
}`, ontology
));
const maxSubclassDepth = maxSubclassDepthRows.length > 0 ? intVal(maxSubclassDepthRows[0], 'maxDepth') : 0;

const objPropCount = countQuery(
  'PREFIX owl: <http://www.w3.org/2002/07/owl#>\nSELECT (COUNT(DISTINCT ?p) AS ?n) WHERE { ?p a owl:ObjectProperty . FILTER(isIRI(?p)) }',
  'n', ontology
);

const datatypePropCount = countQuery(
  'PREFIX owl: <http://www.w3.org/2002/07/owl#>\nSELECT (COUNT(DISTINCT ?p) AS ?n) WHERE { ?p a owl:DatatypeProperty . FILTER(isIRI(?p)) }',
  'n', ontology
);

const propsWithDomain = countQuery(
  'PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\nSELECT (COUNT(DISTINCT ?p) AS ?n) WHERE { ?p rdfs:domain ?d . FILTER(isIRI(?p)) }',
  'n', ontology
);

const propsWithRange = countQuery(
  'PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\nSELECT (COUNT(DISTINCT ?p) AS ?n) WHERE { ?p rdfs:range ?r . FILTER(isIRI(?p)) }',
  'n', ontology
);

const totalProps = objPropCount + datatypePropCount;
const leafClassRatio = classCount > 0 ? +(leafClassCount / classCount).toFixed(3) : 1;
const propsDomainRatio = totalProps > 0 ? +(propsWithDomain / totalProps).toFixed(3) : 0;
const propsRangeRatio = totalProps > 0 ? +(propsWithRange / totalProps).toFixed(3) : 0;

// --- Relational expressiveness via ARQ on binding.ttl ---

console.log('Computing relational expressiveness metrics...');

const fkObjectPropCount = countQuery(
  'PREFIX rr: <http://www.w3.org/ns/r2rml#>\nSELECT (COUNT(DISTINCT ?pom) AS ?n) WHERE { ?pom rr:objectMap ?om . ?om rr:parentTriplesMap ?ptm }',
  'n', binding
);

const functionalPropCount = countQuery(
  'PREFIX owl: <http://www.w3.org/2002/07/owl#>\nSELECT (COUNT(DISTINCT ?p) AS ?n) WHERE { ?p a owl:FunctionalProperty . FILTER(isIRI(?p)) }',
  'n', ontology
);

// --- Domain vocabulary quality ---

console.log('Computing domain vocabulary quality metrics...');

const classesWithLabel = countQuery(
  'PREFIX owl: <http://www.w3.org/2002/07/owl#>\nPREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\nSELECT (COUNT(DISTINCT ?c) AS ?n) WHERE { ?c a owl:Class . FILTER(isIRI(?c)) ?c rdfs:label ?l }',
  'n', ontology
);

const propsWithLabel = countQuery(
  'PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\nPREFIX owl: <http://www.w3.org/2002/07/owl#>\nSELECT (COUNT(DISTINCT ?p) AS ?n) WHERE { { ?p a owl:ObjectProperty } UNION { ?p a owl:DatatypeProperty } . ?p rdfs:label ?l . FILTER(isIRI(?p)) }',
  'n', ontology
);

// Schema-name leak heuristic: classes/properties whose local name looks like a DB identifier
// (all uppercase, underscores, starts with tbl_/col_/t_/f_, etc.)
const allClassNamesRows = bindings(arqQuery(
  'PREFIX owl: <http://www.w3.org/2002/07/owl#>\nSELECT ?c WHERE { ?c a owl:Class . FILTER(isIRI(?c)) }',
  ontology
));
const allPropNamesRows = bindings(arqQuery(
  'PREFIX owl: <http://www.w3.org/2002/07/owl#>\nSELECT ?p WHERE { { ?p a owl:ObjectProperty } UNION { ?p a owl:DatatypeProperty } . FILTER(isIRI(?p)) }',
  ontology
));

function localName(iri) {
  const m = iri.match(/[#/]([^#/]+)$/);
  return m ? m[1] : iri;
}

const SCHEMA_PATTERNS = /^(tbl_|col_|t_|f_|v_|T_|TBL_|COL_)|[A-Z]{2,}_[A-Z]{2,}|^[A-Z][A-Z0-9_]+$/;

function isSchemaLike(iri) {
  const name = localName(iri);
  return SCHEMA_PATTERNS.test(name);
}

const allTerms = [
  ...allClassNamesRows.map(r => val(r, 'c')),
  ...allPropNamesRows.map(r => val(r, 'p')),
].filter(Boolean);
const schemaLikeCount = allTerms.filter(isSchemaLike).length;
const schemaNameRatio = allTerms.length > 0 ? +(schemaLikeCount / allTerms.length).toFixed(3) : 0;

const classLabelRatio = classCount > 0 ? +(classesWithLabel / classCount).toFixed(3) : 0;
const propLabelRatio = totalProps > 0 ? +(propsWithLabel / totalProps).toFixed(3) : 0;

// --- SQL pattern coverage from schema-report.json ---

console.log('Computing SQL pattern coverage metrics...');

let lowCardinalityTotal = 0;
let numericTotal = 0;
let lowCardinalityModeled = 0;
let numericTyped = 0;
let fkTotal = 0;

if (schemaReport && existsSync(schemaReport)) {
  const report = JSON.parse(readFileSync(schemaReport, 'utf8'));
  const preds = report.predicates ?? [];
  lowCardinalityTotal = preds.filter(p => p.classification === 'low_cardinality').length;
  numericTotal = preds.filter(p => p.classification === 'numeric').length;
  fkTotal = report.fk_count ?? preds.filter(p => p.classification === 'fk').length;

  // Check how many low-cardinality predicates have subclasses or annotation property type in ontology
  const lowCardIris = preds.filter(p => p.classification === 'low_cardinality').map(p => p.iri);
  for (const iri of lowCardIris) {
    const modeled = countQuery(
      `PREFIX owl: <http://www.w3.org/2002/07/owl#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT (COUNT(*) AS ?n) WHERE {
  { <${iri}> a owl:AnnotationProperty }
  UNION { <${iri}> a owl:ObjectProperty ; rdfs:range ?r . ?sub rdfs:subClassOf ?r }
}`, 'n', ontology
    );
    if (modeled > 0) lowCardinalityModeled++;
  }

  // Check numeric typed: numeric predicates that have an xsd: range in ontology
  const NUMERIC_XSD_PATTERN = 'http://www.w3.org/2001/XMLSchema#';
  const numericIris = preds.filter(p => p.classification === 'numeric').map(p => p.iri);
  for (const iri of numericIris) {
    const typed = countQuery(
      `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT (COUNT(*) AS ?n) WHERE {
  <${iri}> rdfs:range ?r .
  FILTER(STRSTARTS(STR(?r), "http://www.w3.org/2001/XMLSchema#"))
}`, 'n', ontology
    );
    if (typed > 0) numericTyped++;
  }
} else {
  console.warn('No schema-report.json provided; SQL pattern coverage metrics will be 0.');
}

const lowCardCoverageRatio = lowCardinalityTotal > 0 ? +(lowCardinalityModeled / lowCardinalityTotal).toFixed(3) : null;
const numericTypedRatio = numericTotal > 0 ? +(numericTyped / numericTotal).toFixed(3) : null;
const fkObjectPropRatio = fkTotal > 0 ? +(fkObjectPropCount / fkTotal).toFixed(3) : null;

// --- Quality flags ---

const flags = [];
if (classCount >= 5 && leafClassRatio > 0.9) flags.push('flat_ontology');
if (fkTotal > 0 && (fkObjectPropRatio ?? 0) < 0.5) flags.push('poor_fk_modeling');
if (classLabelRatio < 0.5) flags.push('unlabeled_ontology');
if (schemaNameRatio > 0.5) flags.push('schema_vocabulary_leak');
if (lowCardinalityTotal > 0 && (lowCardCoverageRatio ?? 0) < 0.3) flags.push('low_cardinality_uncovered');

// --- robot metrics (OWL axiom counts) ---

let robotMetrics = null;
try {
  const robotOut = execSync(`robot metrics --input "${ontology}" --metrics extended --format json 2>/dev/null`, { encoding: 'utf8' });
  robotMetrics = JSON.parse(robotOut);
} catch {
  console.warn('robot metrics unavailable or failed — OWL axiom counts omitted.');
}

// --- Assemble result ---

const metrics = {
  generated: new Date().toISOString(),
  quality_flags: flags,
  dimensions: {
    semantic_concept_depth: {
      class_count: classCount,
      leaf_class_ratio: leafClassRatio,
      max_subclass_depth: maxSubclassDepth,
      subclass_count: subclassCount,
      object_property_count: objPropCount,
      datatype_property_count: datatypePropCount,
      properties_with_domain_ratio: propsDomainRatio,
      properties_with_range_ratio: propsRangeRatio,
    },
    relational_expressiveness: {
      fk_total: fkTotal,
      fk_as_object_property_count: fkObjectPropCount,
      fk_object_property_ratio: fkObjectPropRatio,
      functional_property_count: functionalPropCount,
    },
    domain_vocabulary_quality: {
      class_with_label_ratio: classLabelRatio,
      property_with_label_ratio: propLabelRatio,
      schema_name_ratio: schemaNameRatio,
      schema_like_term_count: schemaLikeCount,
      total_term_count: allTerms.length,
    },
    sql_pattern_coverage: {
      low_cardinality_total: lowCardinalityTotal,
      low_cardinality_modeled_count: lowCardinalityModeled,
      low_cardinality_coverage_ratio: lowCardCoverageRatio,
      numeric_total: numericTotal,
      numeric_typed_count: numericTyped,
      numeric_typed_ratio: numericTypedRatio,
    },
  },
  owl_metrics: robotMetrics ?? 'unavailable',
};

// --- Output ---

let text;
if (format === 'md') {
  const d = metrics.dimensions;
  const flagsStr = flags.length > 0 ? flags.map(f => `- \`${f}\``).join('\n') : '- None';
  text = `# Semantic Binding Richness Metrics

Generated: ${metrics.generated}

## Quality Flags
${flagsStr}

## Dimension 1: Semantic Concept Depth
| Metric | Value |
|---|---|
| class_count | ${d.semantic_concept_depth.class_count} |
| leaf_class_ratio | ${d.semantic_concept_depth.leaf_class_ratio} |
| max_subclass_depth | ${d.semantic_concept_depth.max_subclass_depth} |
| subclass_count | ${d.semantic_concept_depth.subclass_count} |
| object_property_count | ${d.semantic_concept_depth.object_property_count} |
| datatype_property_count | ${d.semantic_concept_depth.datatype_property_count} |
| properties_with_domain_ratio | ${d.semantic_concept_depth.properties_with_domain_ratio} |
| properties_with_range_ratio | ${d.semantic_concept_depth.properties_with_range_ratio} |

## Dimension 2: Relational Expressiveness
| Metric | Value |
|---|---|
| fk_total | ${d.relational_expressiveness.fk_total} |
| fk_as_object_property_count | ${d.relational_expressiveness.fk_as_object_property_count} |
| fk_object_property_ratio | ${d.relational_expressiveness.fk_object_property_ratio ?? 'n/a'} |
| functional_property_count | ${d.relational_expressiveness.functional_property_count} |

## Dimension 3: Domain Vocabulary Quality
| Metric | Value |
|---|---|
| class_with_label_ratio | ${d.domain_vocabulary_quality.class_with_label_ratio} |
| property_with_label_ratio | ${d.domain_vocabulary_quality.property_with_label_ratio} |
| schema_name_ratio | ${d.domain_vocabulary_quality.schema_name_ratio} |
| schema_like_term_count | ${d.domain_vocabulary_quality.schema_like_term_count} |

## Dimension 4: SQL Pattern Coverage
| Metric | Value |
|---|---|
| low_cardinality_total | ${d.sql_pattern_coverage.low_cardinality_total} |
| low_cardinality_modeled_count | ${d.sql_pattern_coverage.low_cardinality_modeled_count} |
| low_cardinality_coverage_ratio | ${d.sql_pattern_coverage.low_cardinality_coverage_ratio ?? 'n/a'} |
| numeric_total | ${d.sql_pattern_coverage.numeric_total} |
| numeric_typed_count | ${d.sql_pattern_coverage.numeric_typed_count} |
| numeric_typed_ratio | ${d.sql_pattern_coverage.numeric_typed_ratio ?? 'n/a'} |
`;
} else {
  text = JSON.stringify(metrics, null, 2);
}

if (output) {
  writeFileSync(output, text);
  console.log(`Richness metrics written to ${output}`);
} else {
  process.stdout.write(text + '\n');
}

if (flags.length > 0) {
  console.log(`\nQuality flags: ${flags.join(', ')}`);
} else {
  console.log('\nNo quality flags.');
}
