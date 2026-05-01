#!/usr/bin/env node
/**
 * explore-schema.mjs
 *
 * Analyzes a bootstrap R2RML binding (binding.ttl) and an ontology to produce
 * a schema-report.json classifying each mapped predicate by SQL pattern:
 *   fk | low_cardinality | numeric | date | pk | free_text
 *
 * Cardinality data is obtained by running `ontop query` SPARQL probes against
 * a live DB. Use --skip-probes to skip live DB access (fixture testing).
 *
 * Usage:
 *   node explore-schema.mjs \
 *     --binding binding.ttl \
 *     --ontology ontology.ttl \
 *     --properties db.properties \
 *     --output schema-report.json \
 *     [--cardinality-threshold 50] \
 *     [--skip-probes]
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { z } from 'zod';

// --- CLI arg parsing ---

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : null;
}
function boolFlag(name) {
  return args.includes(name);
}

const binding = flag('--binding');
const ontology = flag('--ontology');
const properties = flag('--properties');
const output = flag('--output');
const cardinalityThreshold = parseInt(flag('--cardinality-threshold') ?? '50', 10);
const skipProbes = boolFlag('--skip-probes');

if (!binding || !ontology || !output) {
  console.error('Usage: explore-schema.mjs --binding <binding.ttl> --ontology <ontology.ttl> --properties <db.properties> --output <schema-report.json> [--cardinality-threshold 50] [--skip-probes]');
  process.exit(1);
}
if (!skipProbes && !properties) {
  console.error('--properties <db.properties> is required unless --skip-probes is set');
  process.exit(1);
}
for (const f of [binding, ontology]) {
  if (!existsSync(f)) { console.error(`File not found: ${f}`); process.exit(1); }
}

// --- ARQ helper ---

const _tmpDir = mkdtempSync(join(tmpdir(), 'explore-schema-'));
let _qCount = 0;

function arqQuery(query, ...dataFiles) {
  const qFile = join(_tmpDir, `q${_qCount++}.rq`);
  writeFileSync(qFile, query);
  const dataArgs = dataFiles.map(f => `--data "${f}"`).join(' ');
  const cmd = `arq ${dataArgs} --query "${qFile}" --results JSON`;
  try {
    const result = execSync(cmd, { encoding: 'utf8' });
    return JSON.parse(result);
  } catch {
    return { results: { bindings: [] } };
  }
}

process.on('exit', () => { try { rmSync(_tmpDir, { recursive: true }); } catch {} });

function bindings(arqResult) {
  return arqResult?.results?.bindings ?? [];
}

function val(binding, varName) {
  return binding[varName]?.value ?? null;
}

// --- Step 1: Extract predicate IRIs from binding.ttl via ARQ ---

console.log('Extracting mapped predicates from binding.ttl...');

const predicateQuery = `
PREFIX rr: <http://www.w3.org/ns/r2rml#>
SELECT DISTINCT ?predicate ?subjectTemplate ?joinCondition WHERE {
  ?tm rr:predicateObjectMap ?pom .
  ?pom rr:predicate ?predicate .
  ?tm rr:subjectMap ?sm .
  OPTIONAL { ?sm rr:template ?subjectTemplate }
  OPTIONAL {
    ?pom rr:objectMap ?om .
    ?om rr:joinCondition ?jc .
    ?jc rr:child ?joinCondition .
  }
}
`;

const predicateRows = bindings(arqQuery(predicateQuery, binding));

// Also extract rr:class entries for subject maps
const classQuery = `
PREFIX rr: <http://www.w3.org/ns/r2rml#>
SELECT DISTINCT ?class ?subjectTemplate WHERE {
  ?tm rr:subjectMap ?sm .
  ?sm rr:class ?class .
  OPTIONAL { ?sm rr:template ?subjectTemplate }
}
`;
const classRows = bindings(arqQuery(classQuery, binding));

// --- Step 2: Determine range types from ontology ---

console.log('Reading range types from ontology.ttl...');

const rangeQuery = `
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT ?predicate ?range WHERE {
  ?predicate rdfs:range ?range .
}
`;
const rangeRows = bindings(arqQuery(rangeQuery, ontology));
const rangeMap = {};
for (const row of rangeRows) {
  rangeMap[val(row, 'predicate')] = val(row, 'range');
}

// FK detection: predicates with a joinCondition in binding.ttl
const fkPredicates = new Set(
  predicateRows.filter(r => val(r, 'joinCondition')).map(r => val(r, 'predicate'))
);

// PK detection: subject maps with rr:template
const pkTemplates = new Set(
  [...predicateRows, ...classRows]
    .filter(r => val(r, 'subjectTemplate'))
    .map(r => val(r, 'subjectTemplate'))
);

// Numeric XSD types
const NUMERIC_TYPES = new Set([
  'http://www.w3.org/2001/XMLSchema#integer',
  'http://www.w3.org/2001/XMLSchema#int',
  'http://www.w3.org/2001/XMLSchema#decimal',
  'http://www.w3.org/2001/XMLSchema#double',
  'http://www.w3.org/2001/XMLSchema#float',
  'http://www.w3.org/2001/XMLSchema#long',
]);

const DATE_TYPES = new Set([
  'http://www.w3.org/2001/XMLSchema#date',
  'http://www.w3.org/2001/XMLSchema#dateTime',
  'http://www.w3.org/2001/XMLSchema#gYear',
  'http://www.w3.org/2001/XMLSchema#gYearMonth',
]);

// --- Step 3: Cardinality probes via ontop query ---

const ontopCli = process.env.ONTOP_CLI ?? 'ontop';
const probeResults = {};

function classifyFromRange(range) {
  if (!range) return null;
  if (NUMERIC_TYPES.has(range)) return 'numeric';
  if (DATE_TYPES.has(range)) return 'date';
  return null;
}

if (!skipProbes) {
  const allPredicates = [...new Set(predicateRows.map(r => val(r, 'predicate')).filter(Boolean))];
  const nonFkPredicates = allPredicates.filter(p => !fkPredicates.has(p));

  console.log(`Running cardinality probes for ${nonFkPredicates.length} non-FK predicates...`);

  for (const predIri of nonFkPredicates) {
    const sparql = `SELECT (COUNT(DISTINCT ?v) AS ?distinct) (COUNT(?v) AS ?total) WHERE { ?s <${predIri}> ?v }`;
    const tmpQuery = `/tmp/probe-${Date.now()}.rq`;
    writeFileSync(tmpQuery, sparql);
    try {
      const cmd = `${ontopCli} query -m "${binding.replace('.ttl', '.obda')}" -t "${ontology}" -p "${properties}" -q "${tmpQuery}" 2>/dev/null`;
      const out = execSync(cmd, { encoding: 'utf8', timeout: 30000 });
      // Parse TSV result
      const lines = out.trim().split('\n').filter(l => l.trim());
      if (lines.length >= 2) {
        const [distinctStr, totalStr] = lines[1].split('\t');
        const distinct = parseInt(distinctStr?.trim(), 10);
        const total = parseInt(totalStr?.trim(), 10);
        if (!isNaN(distinct) && !isNaN(total)) {
          probeResults[predIri] = { distinct_count: distinct, total_count: total };
        }
      }
    } catch {
      // probe failed — no cardinality data for this predicate
    }
  }
} else {
  console.log('Skipping live DB probes (--skip-probes).');
}

// --- Step 4: Classify each predicate ---

function classifyPredicate(predIri) {
  if (fkPredicates.has(predIri)) return 'fk';
  const rangeType = classifyFromRange(rangeMap[predIri]);
  if (rangeType) return rangeType;
  if (probeResults[predIri]) {
    const { distinct_count, total_count } = probeResults[predIri];
    if (total_count > 0) {
      const ratio = distinct_count / total_count;
      if (distinct_count <= cardinalityThreshold || ratio < 0.05) return 'low_cardinality';
    }
  }
  return 'free_text';
}

const predicateEntries = [...new Set(predicateRows.map(r => val(r, 'predicate')).filter(Boolean))];

const columns = predicateEntries.map(iri => {
  const probe = probeResults[iri] ?? {};
  return {
    iri,
    classification: classifyPredicate(iri),
    distinct_count: probe.distinct_count ?? null,
    total_count: probe.total_count ?? null,
  };
});

// Also record subject template PKs
const pkEntries = [...pkTemplates].map(template => ({
  type: 'subject_template',
  template,
  classification: 'pk',
}));

const report = {
  generated: new Date().toISOString(),
  cardinality_threshold: cardinalityThreshold,
  skip_probes: skipProbes,
  predicates: columns,
  subject_templates: pkEntries,
  fk_count: columns.filter(c => c.classification === 'fk').length,
  low_cardinality_count: columns.filter(c => c.classification === 'low_cardinality').length,
  numeric_count: columns.filter(c => c.classification === 'numeric').length,
  date_count: columns.filter(c => c.classification === 'date').length,
  free_text_count: columns.filter(c => c.classification === 'free_text').length,
  pk_count: pkEntries.length,
};

writeFileSync(output, JSON.stringify(report, null, 2));
console.log(`schema-report.json written to ${output}`);
console.log(`  predicates: ${columns.length} (fk=${report.fk_count}, low_cardinality=${report.low_cardinality_count}, numeric=${report.numeric_count}, date=${report.date_count}, free_text=${report.free_text_count})`);
console.log(`  subject templates (PK): ${report.pk_count}`);
