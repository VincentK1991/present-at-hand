#!/usr/bin/env node

import { mkdtemp, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertReadableFile } from "./extract/io.mjs";
import { runCommand } from "./extract/shell.mjs";

const PREFIXES = `
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
PREFIX sh: <http://www.w3.org/ns/shacl#>
`;

function usage() {
  console.log(`Usage:
  metrics.mjs --ontology <ontology.ttl> [options]

Required:
  --ontology <path>            Ontology TTL

Optional:
  --asserted <path>            Asserted triples TTL
  --inferred <path>            Inferred triples TTL
  --closure <path>             Closure triples TTL (preferred for data/validation metrics)
  --rules <path>               Rule file (.rq) or directory of .rq files (for rule coverage metrics)
  --shapes <path>              SHACL shapes file (optional validation metrics)
  --top-n <n>                  Top-N predicates/components to report (default: 10)
  --format <json|md>           Output format (default: json)
  --output <path>              Optional output file path
  --help                       Show this help

Example:
  node ./scripts/metrics.mjs \\
    --ontology <path/to/ontology.ttl> \\
    --asserted <path/to/asserted.ttl> \\
    --inferred <path/to/inferred.ttl> \\
    --rules <path/to/rules> \\
    --format md`);
}

function parseArgs(argv) {
  const opts = {
    ontology: "",
    asserted: "",
    inferred: "",
    closure: "",
    rules: "",
    shapes: "",
    topN: 10,
    format: "json",
    output: "",
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const n = argv[i + 1];
    switch (a) {
      case "--ontology":
        opts.ontology = n ?? "";
        i++;
        break;
      case "--asserted":
        opts.asserted = n ?? "";
        i++;
        break;
      case "--inferred":
        opts.inferred = n ?? "";
        i++;
        break;
      case "--closure":
        opts.closure = n ?? "";
        i++;
        break;
      case "--rules":
        opts.rules = n ?? "";
        i++;
        break;
      case "--shapes":
        opts.shapes = n ?? "";
        i++;
        break;
      case "--top-n":
        if (!n) throw new Error("--top-n requires a value");
        opts.topN = Number.parseInt(n, 10);
        if (!Number.isFinite(opts.topN) || opts.topN <= 0) {
          throw new Error("--top-n must be a positive integer");
        }
        i++;
        break;
      case "--format":
        opts.format = (n ?? "").toLowerCase();
        i++;
        break;
      case "--output":
        opts.output = n ?? "";
        i++;
        break;
      case "--help":
      case "-h":
        usage();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${a}`);
    }
  }

  if (!opts.ontology) throw new Error("--ontology is required");
  if (!["json", "md"].includes(opts.format)) throw new Error("--format must be 'json' or 'md'");
  return opts;
}

function nowIso() {
  return new Date().toISOString();
}

function round3(value) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 1000) / 1000;
}

function safeDiv(num, den) {
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  return num / den;
}

function valueFromBinding(binding) {
  if (!binding) return null;
  const v = binding.value;
  if (binding.datatype?.endsWith("#integer") || binding.datatype?.endsWith("#decimal") ||
      binding.datatype?.endsWith("#double") || binding.datatype?.endsWith("#float")) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (binding.datatype?.endsWith("#boolean")) return v === "true";
  return v;
}

function ntLines(nt) {
  return nt
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

async function riotCount(filePath) {
  const { stdout, stderr } = await runCommand("riot", ["--count", filePath]);
  const combined = `${stdout}\n${stderr}`.trim();
  const m = combined.match(/(?:Triples|Quads)\s*=\s*(\d+)/);
  if (!m) throw new Error(`Failed to parse riot --count output for ${filePath}: ${combined}`);
  return Number.parseInt(m[1], 10);
}

async function riotToNT(filePath) {
  const { stdout } = await runCommand("riot", ["--output=NT", filePath]);
  return stdout;
}

async function resolveRules(rulesPath) {
  const st = await stat(rulesPath);
  if (st.isFile()) {
    if (!rulesPath.endsWith(".rq")) throw new Error(`--rules file must be .rq: ${rulesPath}`);
    return [rulesPath];
  }
  if (st.isDirectory()) {
    const entries = await readdir(rulesPath);
    const rules = entries.filter((e) => e.endsWith(".rq")).sort();
    if (!rules.length) throw new Error(`No .rq files in ${rulesPath}`);
    return rules.map((e) => path.join(rulesPath, e));
  }
  throw new Error(`--rules path is neither file nor directory: ${rulesPath}`);
}

async function runSelectJSON(tmpDir, dataFiles, queryText) {
  const queryPath = path.join(tmpDir, `q-${Math.random().toString(36).slice(2)}.rq`);
  await writeFile(queryPath, queryText, "utf8");
  const args = [...dataFiles.map((f) => `--data=${f}`), `--query=${queryPath}`, "--results=JSON"];
  const { stdout } = await runCommand("arq", args);
  return JSON.parse(stdout);
}

async function scalar(tmpDir, dataFiles, queryText, varName = "value") {
  const result = await runSelectJSON(tmpDir, dataFiles, queryText);
  const row = result?.results?.bindings?.[0];
  if (!row || !row[varName]) return null;
  return valueFromBinding(row[varName]);
}

async function rows(tmpDir, dataFiles, queryText) {
  const result = await runSelectJSON(tmpDir, dataFiles, queryText);
  return result?.results?.bindings ?? [];
}

function pickDataFilesForInstanceMetrics(opts) {
  if (opts.closure) return [opts.closure];
  if (opts.asserted && opts.inferred) return [opts.asserted, opts.inferred];
  if (opts.asserted) return [opts.asserted];
  if (opts.inferred) return [opts.inferred];
  return [];
}

async function ontologyMetrics(tmpDir, ontologyFile) {
  const data = [ontologyFile];

  const classCount = await scalar(
    tmpDir,
    data,
    `${PREFIXES}
SELECT (COUNT(DISTINCT ?c) AS ?value) WHERE {
  { ?c a owl:Class } UNION { ?c a rdfs:Class }
}`
  );
  const objectPropertyCount = await scalar(
    tmpDir,
    data,
    `${PREFIXES}
SELECT (COUNT(DISTINCT ?p) AS ?value) WHERE { ?p a owl:ObjectProperty }`
  );
  const datatypePropertyCount = await scalar(
    tmpDir,
    data,
    `${PREFIXES}
SELECT (COUNT(DISTINCT ?p) AS ?value) WHERE { ?p a owl:DatatypeProperty }`
  );
  const annotationPropertyCount = await scalar(
    tmpDir,
    data,
    `${PREFIXES}
SELECT (COUNT(DISTINCT ?p) AS ?value) WHERE { ?p a owl:AnnotationProperty }`
  );
  const propertyCount = await scalar(
    tmpDir,
    data,
    `${PREFIXES}
SELECT (COUNT(DISTINCT ?p) AS ?value) WHERE {
  { ?p a rdf:Property }
  UNION { ?p a owl:ObjectProperty }
  UNION { ?p a owl:DatatypeProperty }
  UNION { ?p a owl:AnnotationProperty }
}`
  );
  const individualCount = await scalar(
    tmpDir,
    data,
    `${PREFIXES}
SELECT (COUNT(DISTINCT ?i) AS ?value) WHERE {
  ?i a ?t .
  FILTER(?t NOT IN (
    owl:Class, rdfs:Class, rdf:Property,
    owl:ObjectProperty, owl:DatatypeProperty, owl:AnnotationProperty, owl:Ontology
  ))
}`
  );
  const subclassAxiomCount = await scalar(
    tmpDir,
    data,
    `${PREFIXES} SELECT (COUNT(*) AS ?value) WHERE { ?c rdfs:subClassOf ?s }`
  );
  const subpropertyAxiomCount = await scalar(
    tmpDir,
    data,
    `${PREFIXES} SELECT (COUNT(*) AS ?value) WHERE { ?p rdfs:subPropertyOf ?q }`
  );
  const equivalentClassAxiomCount = await scalar(
    tmpDir,
    data,
    `${PREFIXES} SELECT (COUNT(*) AS ?value) WHERE { ?c owl:equivalentClass ?d }`
  );
  const disjointClassAxiomCount = await scalar(
    tmpDir,
    data,
    `${PREFIXES} SELECT (COUNT(*) AS ?value) WHERE { ?c owl:disjointWith ?d }`
  );
  const domainAxiomCount = await scalar(
    tmpDir,
    data,
    `${PREFIXES} SELECT (COUNT(*) AS ?value) WHERE { ?p rdfs:domain ?d }`
  );
  const rangeAxiomCount = await scalar(
    tmpDir,
    data,
    `${PREFIXES} SELECT (COUNT(*) AS ?value) WHERE { ?p rdfs:range ?r }`
  );
  const classWithLabelCount = await scalar(
    tmpDir,
    data,
    `${PREFIXES}
SELECT (COUNT(DISTINCT ?c) AS ?value) WHERE {
  { ?c a owl:Class } UNION { ?c a rdfs:Class } .
  ?c rdfs:label ?label
}`
  );
  const propertyWithLabelCount = await scalar(
    tmpDir,
    data,
    `${PREFIXES}
SELECT (COUNT(DISTINCT ?p) AS ?value) WHERE {
  {
    { ?p a rdf:Property }
    UNION { ?p a owl:ObjectProperty }
    UNION { ?p a owl:DatatypeProperty }
    UNION { ?p a owl:AnnotationProperty }
  }
  ?p rdfs:label ?label
}`
  );
  const leafClassCount = await scalar(
    tmpDir,
    data,
    `${PREFIXES}
SELECT (COUNT(DISTINCT ?c) AS ?value) WHERE {
  { ?c a owl:Class } UNION { ?c a rdfs:Class } .
  FILTER NOT EXISTS {
    ?child rdfs:subClassOf ?c .
    FILTER (?child != ?c)
  }
}`
  );
  const rootClassCount = await scalar(
    tmpDir,
    data,
    `${PREFIXES}
SELECT (COUNT(DISTINCT ?c) AS ?value) WHERE {
  { ?c a owl:Class } UNION { ?c a rdfs:Class } .
  FILTER NOT EXISTS {
    ?c rdfs:subClassOf ?sup .
    FILTER (?sup != owl:Thing && ?sup != ?c)
  }
}`
  );
  const ancestorStatsRows = await rows(
    tmpDir,
    data,
    `${PREFIXES}
SELECT (MAX(?ancestorCount) AS ?max_ancestors) (AVG(?ancestorCount) AS ?avg_ancestors) WHERE {
  {
    SELECT ?c (COUNT(DISTINCT ?sup) AS ?ancestorCount) WHERE {
      { ?c a owl:Class } UNION { ?c a rdfs:Class } .
      OPTIONAL { ?c rdfs:subClassOf+ ?sup . FILTER(?sup != ?c) }
    } GROUP BY ?c
  }
}`
  );
  const ancestorStats = ancestorStatsRows[0] ?? {};
  const maxAncestors = valueFromBinding(ancestorStats.max_ancestors) ?? 0;
  const avgAncestors = valueFromBinding(ancestorStats.avg_ancestors) ?? 0;

  const tripleCount = await riotCount(ontologyFile);
  const propertiesWithDomainRatio = round3(safeDiv(domainAxiomCount ?? 0, propertyCount ?? 0));
  const propertiesWithRangeRatio = round3(safeDiv(rangeAxiomCount ?? 0, propertyCount ?? 0));
  const classLabelCoverageRatio = round3(safeDiv(classWithLabelCount ?? 0, classCount ?? 0));
  const propertyLabelCoverageRatio = round3(safeDiv(propertyWithLabelCount ?? 0, propertyCount ?? 0));
  const leafClassRatio = round3(safeDiv(leafClassCount ?? 0, classCount ?? 0));
  const rootClassRatio = round3(safeDiv(rootClassCount ?? 0, classCount ?? 0));
  const tboxDensity = round3(
    safeDiv(
      (subclassAxiomCount ?? 0) + (subpropertyAxiomCount ?? 0) +
        (equivalentClassAxiomCount ?? 0) + (disjointClassAxiomCount ?? 0) +
        (domainAxiomCount ?? 0) + (rangeAxiomCount ?? 0),
      (classCount ?? 0) + (propertyCount ?? 0)
    )
  );

  return {
    triple_count: tripleCount,
    class_count: classCount ?? 0,
    property_count: propertyCount ?? 0,
    object_property_count: objectPropertyCount ?? 0,
    datatype_property_count: datatypePropertyCount ?? 0,
    annotation_property_count: annotationPropertyCount ?? 0,
    individual_count: individualCount ?? 0,
    subclass_axiom_count: subclassAxiomCount ?? 0,
    subproperty_axiom_count: subpropertyAxiomCount ?? 0,
    equivalent_class_axiom_count: equivalentClassAxiomCount ?? 0,
    disjoint_class_axiom_count: disjointClassAxiomCount ?? 0,
    domain_axiom_count: domainAxiomCount ?? 0,
    range_axiom_count: rangeAxiomCount ?? 0,
    class_with_label_count: classWithLabelCount ?? 0,
    property_with_label_count: propertyWithLabelCount ?? 0,
    class_label_coverage_ratio: classLabelCoverageRatio,
    property_label_coverage_ratio: propertyLabelCoverageRatio,
    properties_with_domain_ratio: propertiesWithDomainRatio,
    properties_with_range_ratio: propertiesWithRangeRatio,
    leaf_class_count: leafClassCount ?? 0,
    root_class_count: rootClassCount ?? 0,
    leaf_class_ratio: leafClassRatio,
    root_class_ratio: rootClassRatio,
    max_superclass_count: maxAncestors,
    avg_superclass_count: round3(avgAncestors),
    tbox_density: tboxDensity,
  };
}

async function dataMetrics(tmpDir, dataFiles, topN) {
  if (!dataFiles.length) return null;

  const tripleCount = await scalar(
    tmpDir,
    dataFiles,
    `${PREFIXES} SELECT (COUNT(*) AS ?value) WHERE { ?s ?p ?o }`
  );
  const subjectCount = await scalar(
    tmpDir,
    dataFiles,
    `${PREFIXES} SELECT (COUNT(DISTINCT ?s) AS ?value) WHERE { ?s ?p ?o }`
  );
  const predicateCount = await scalar(
    tmpDir,
    dataFiles,
    `${PREFIXES} SELECT (COUNT(DISTINCT ?p) AS ?value) WHERE { ?s ?p ?o }`
  );
  const literalObjectCount = await scalar(
    tmpDir,
    dataFiles,
    `${PREFIXES} SELECT (COUNT(*) AS ?value) WHERE { ?s ?p ?o . FILTER(isLiteral(?o)) }`
  );
  const iriOrBNodeObjectCount = await scalar(
    tmpDir,
    dataFiles,
    `${PREFIXES} SELECT (COUNT(*) AS ?value) WHERE { ?s ?p ?o . FILTER(isIRI(?o) || isBlank(?o)) }`
  );
  const typeAssertionCount = await scalar(
    tmpDir,
    dataFiles,
    `${PREFIXES} SELECT (COUNT(*) AS ?value) WHERE { ?s rdf:type ?t }`
  );
  const typedInstanceCount = await scalar(
    tmpDir,
    dataFiles,
    `${PREFIXES}
SELECT (COUNT(DISTINCT ?s) AS ?value) WHERE {
  ?s rdf:type ?t .
  FILTER(?t NOT IN (
    owl:Class, rdfs:Class, rdf:Property,
    owl:ObjectProperty, owl:DatatypeProperty, owl:AnnotationProperty, owl:Ontology
  ))
}`
  );
  const untypedSubjectCount = await scalar(
    tmpDir,
    dataFiles,
    `${PREFIXES}
SELECT (COUNT(DISTINCT ?s) AS ?value) WHERE {
  ?s ?p ?o .
  FILTER(?p != rdf:type)
  FILTER NOT EXISTS { ?s rdf:type ?t }
}`
  );
  const avgPropertiesRows = await rows(
    tmpDir,
    dataFiles,
    `${PREFIXES}
SELECT (AVG(?pc) AS ?value) WHERE {
  { SELECT ?s (COUNT(DISTINCT ?p) AS ?pc) WHERE { ?s ?p ?o } GROUP BY ?s }
}`
  );
  const avgPropertiesPerSubject = valueFromBinding(avgPropertiesRows[0]?.value) ?? null;

  const topPredicateRows = await rows(
    tmpDir,
    dataFiles,
    `${PREFIXES}
SELECT ?p (COUNT(*) AS ?count) WHERE {
  ?s ?p ?o
}
GROUP BY ?p
ORDER BY DESC(?count)
LIMIT ${topN}`
  );

  return {
    triple_count: tripleCount ?? 0,
    subject_count: subjectCount ?? 0,
    predicate_count: predicateCount ?? 0,
    literal_object_count: literalObjectCount ?? 0,
    iri_or_bnode_object_count: iriOrBNodeObjectCount ?? 0,
    type_assertion_count: typeAssertionCount ?? 0,
    typed_instance_count: typedInstanceCount ?? 0,
    untyped_subject_count: untypedSubjectCount ?? 0,
    typed_subject_coverage_ratio: round3(safeDiv(typedInstanceCount ?? 0, subjectCount ?? 0)),
    avg_types_per_typed_instance: round3(safeDiv(typeAssertionCount ?? 0, typedInstanceCount ?? 0)),
    avg_triples_per_subject: round3(safeDiv(tripleCount ?? 0, subjectCount ?? 0)),
    avg_properties_per_subject: round3(avgPropertiesPerSubject),
    object_literal_ratio: round3(safeDiv(iriOrBNodeObjectCount ?? 0, literalObjectCount ?? 0)),
    top_predicates: topPredicateRows.map((row) => ({
      predicate: valueFromBinding(row.p),
      count: valueFromBinding(row.count) ?? 0,
    })),
  };
}

async function predicateSet(tmpDir, dataFiles) {
  const result = await rows(
    tmpDir,
    dataFiles,
    `${PREFIXES} SELECT DISTINCT ?p WHERE { ?s ?p ?o }`
  );
  return new Set(result.map((row) => valueFromBinding(row.p)).filter(Boolean));
}

async function inferenceMetrics(tmpDir, opts, topN) {
  if (!opts.asserted || !opts.inferred) return null;

  const assertedCount = await riotCount(opts.asserted);
  const inferredCount = await riotCount(opts.inferred);
  const assertedPlusInferredCount = await scalar(
    tmpDir,
    [opts.asserted, opts.inferred],
    `${PREFIXES} SELECT (COUNT(*) AS ?value) WHERE { ?s ?p ?o }`
  );
  const inferredTypeCount = await scalar(
    tmpDir,
    [opts.inferred],
    `${PREFIXES} SELECT (COUNT(*) AS ?value) WHERE { ?s rdf:type ?o }`
  );
  const inferredPredicateCount = await scalar(
    tmpDir,
    [opts.inferred],
    `${PREFIXES} SELECT (COUNT(DISTINCT ?p) AS ?value) WHERE { ?s ?p ?o }`
  );
  const inferredTopRows = await rows(
    tmpDir,
    [opts.inferred],
    `${PREFIXES}
SELECT ?p (COUNT(*) AS ?count) WHERE {
  ?s ?p ?o
}
GROUP BY ?p
ORDER BY DESC(?count)
LIMIT ${topN}`
  );

  const assertedPredicates = await predicateSet(tmpDir, [opts.asserted]);
  const inferredPredicates = await predicateSet(tmpDir, [opts.inferred]);
  const newPredicates = [...inferredPredicates].filter((p) => !assertedPredicates.has(p));

  return {
    asserted_triple_count: assertedCount,
    inferred_triple_count: inferredCount,
    asserted_plus_inferred_triple_count: assertedPlusInferredCount ?? assertedCount + inferredCount,
    closure_ratio: round3(safeDiv((assertedPlusInferredCount ?? assertedCount + inferredCount), assertedCount)),
    inference_gain: round3(safeDiv(inferredCount, assertedCount)),
    inferred_type_assertion_count: inferredTypeCount ?? 0,
    inferred_predicate_count: inferredPredicateCount ?? 0,
    inferred_new_predicate_count: newPredicates.length,
    inferred_new_predicates: newPredicates.sort(),
    top_inferred_predicates: inferredTopRows.map((row) => ({
      predicate: valueFromBinding(row.p),
      count: valueFromBinding(row.count) ?? 0,
    })),
  };
}

async function ruleMetrics(tmpDir, opts) {
  if (!opts.rules) return null;

  const dataFiles = pickDataFilesForInstanceMetrics(opts);
  if (!dataFiles.length) {
    return {
      warning: "Rules provided but no closure/asserted/inferred data provided for rule analysis.",
      rules: [],
      dead_rule_count: 0,
    };
  }

  const rules = await resolveRules(path.resolve(opts.rules));
  const dataLineSet = new Set();
  for (const dataFile of dataFiles) {
    const nt = await riotToNT(dataFile);
    for (const line of ntLines(nt)) dataLineSet.add(line);
  }

  const ruleDetails = [];
  for (const ruleFile of rules) {
    const t0 = process.hrtime.bigint();
    const args = [...dataFiles.map((f) => `--data=${f}`), `--query=${ruleFile}`];
    const { stdout: constructOut } = await runCommand("arq", args);
    let constructedSet = new Set();
    if (constructOut.trim()) {
      const { stdout: asNt } = await runCommand("riot", ["--syntax=TTL", "--output=NT", "-"], constructOut);
      constructedSet = new Set(ntLines(asNt));
    }
    const elapsedMs = Number(process.hrtime.bigint() - t0) / 1_000_000;
    let novelVsData = 0;
    for (const line of constructedSet) {
      if (!dataLineSet.has(line)) novelVsData++;
    }

    ruleDetails.push({
      rule: path.basename(ruleFile),
      constructed_triple_count: constructedSet.size,
      novel_vs_input_count: novelVsData,
      dead_on_input: novelVsData === 0,
      run_ms: round3(elapsedMs),
    });
  }

  const deadRuleCount = ruleDetails.filter((r) => r.dead_on_input).length;
  return {
    rule_count: ruleDetails.length,
    dead_rule_count: deadRuleCount,
    rules: ruleDetails,
  };
}

async function ensureSingleDataFileForShacl(tmpDir, dataFiles) {
  if (dataFiles.length === 1) return dataFiles[0];
  const mergedPath = path.join(tmpDir, "shacl-data-merged.ttl");
  const { stdout } = await runCommand("riot", ["--formatted=TTL", ...dataFiles]);
  await writeFile(mergedPath, stdout, "utf8");
  return mergedPath;
}

async function shaclMetrics(tmpDir, opts, topN) {
  if (!opts.shapes) return null;
  const dataFiles = pickDataFilesForInstanceMetrics(opts);
  if (!dataFiles.length) {
    return { warning: "Shapes provided but no data graph found (closure/asserted/inferred missing)." };
  }

  const shapesPath = path.resolve(opts.shapes);
  const dataPath = await ensureSingleDataFileForShacl(tmpDir, dataFiles);

  const { stdout: reportTtl } = await runCommand("shacl", [
    "validate",
    "--shapes",
    shapesPath,
    "--data",
    dataPath,
  ]);
  const reportPath = path.join(tmpDir, "shacl-report.ttl");
  await writeFile(reportPath, reportTtl, "utf8");

  const summaryRows = await rows(
    tmpDir,
    [reportPath],
    `${PREFIXES}
SELECT ?conforms (COUNT(?r) AS ?result_count) WHERE {
  ?report a sh:ValidationReport ;
          sh:conforms ?conforms .
  OPTIONAL { ?report sh:result ?r }
}
GROUP BY ?conforms`
  );
  const summary = summaryRows[0] ?? {};
  const conforms = valueFromBinding(summary.conforms);
  const resultCount = valueFromBinding(summary.result_count) ?? 0;

  const severityRows = await rows(
    tmpDir,
    [reportPath],
    `${PREFIXES}
SELECT ?severity (COUNT(*) AS ?count) WHERE {
  ?report a sh:ValidationReport ; sh:result ?r .
  ?r sh:resultSeverity ?severity .
}
GROUP BY ?severity
ORDER BY DESC(?count)`
  );

  const componentRows = await rows(
    tmpDir,
    [reportPath],
    `${PREFIXES}
SELECT ?component (COUNT(*) AS ?count) WHERE {
  ?report a sh:ValidationReport ; sh:result ?r .
  ?r sh:sourceConstraintComponent ?component .
}
GROUP BY ?component
ORDER BY DESC(?count)
LIMIT ${topN}`
  );

  return {
    conforms: conforms ?? null,
    result_count: resultCount,
    severity_counts: severityRows.map((row) => ({
      severity: valueFromBinding(row.severity),
      count: valueFromBinding(row.count) ?? 0,
    })),
    top_constraint_components: componentRows.map((row) => ({
      component: valueFromBinding(row.component),
      count: valueFromBinding(row.count) ?? 0,
    })),
  };
}

function buildQualityFlags(report) {
  const flags = [];
  const o = report.ontology;
  const d = report.data;
  const inf = report.inference;
  const rules = report.rules;
  const shacl = report.shacl;

  if (o) {
    if ((o.class_count ?? 0) >= 10 && (o.leaf_class_ratio ?? 0) > 0.9) {
      flags.push({
        severity: "warning",
        code: "flat_hierarchy",
        message: "Class hierarchy appears flat (very high leaf class ratio).",
      });
    }
    if ((o.max_superclass_count ?? 0) >= 8) {
      flags.push({
        severity: "warning",
        code: "deep_hierarchy",
        message: "Class hierarchy may be overly deep (high max superclass count).",
      });
    }
    if ((o.properties_with_domain_ratio ?? 1) < 0.3) {
      flags.push({
        severity: "warning",
        code: "low_domain_coverage",
        message: "Few properties declare rdfs:domain.",
      });
    }
    if ((o.properties_with_range_ratio ?? 1) < 0.3) {
      flags.push({
        severity: "warning",
        code: "low_range_coverage",
        message: "Few properties declare rdfs:range.",
      });
    }
  }

  if (d) {
    if ((d.typed_subject_coverage_ratio ?? 1) < 0.6) {
      flags.push({
        severity: "warning",
        code: "low_typing_coverage",
        message: "Many subjects are untyped in data graph.",
      });
    }
  }

  if (inf) {
    if ((inf.inference_gain ?? 0) > 3) {
      flags.push({
        severity: "warning",
        code: "high_inference_gain",
        message: "Inference gain is high; verify rule specificity and closure correctness.",
      });
    }
  }

  if (rules && Number.isFinite(rules.dead_rule_count) && rules.dead_rule_count > 0) {
    flags.push({
      severity: "info",
      code: "dead_rules",
      message: `${rules.dead_rule_count} rules produce no novel triples on current input.`,
    });
  }

  if (shacl && shacl.result_count > 0) {
    flags.push({
      severity: "warning",
      code: "shacl_violations",
      message: `SHACL report contains ${shacl.result_count} validation result(s).`,
    });
  }

  if (flags.length === 0) {
    flags.push({
      severity: "info",
      code: "no_major_flags",
      message: "No major heuristic quality flags triggered.",
    });
  }
  return flags;
}

function toMarkdown(report) {
  const lines = [];
  lines.push("# Ontology Quality Metrics");
  lines.push("");
  lines.push(`Generated: ${report.generated_at}`);
  lines.push("");
  lines.push("## Inputs");
  lines.push("");
  for (const [k, v] of Object.entries(report.inputs)) {
    if (v) lines.push(`- ${k}: \`${v}\``);
  }
  lines.push("");

  const sections = [
    ["Ontology", report.ontology],
    ["Data", report.data],
    ["Inference", report.inference],
    ["Rules", report.rules],
    ["SHACL", report.shacl],
  ];

  for (const [title, section] of sections) {
    if (!section) continue;
    lines.push(`## ${title}`);
    lines.push("");
    for (const [k, v] of Object.entries(section)) {
      if (Array.isArray(v)) {
        lines.push(`- ${k}:`);
        for (const row of v) {
          lines.push(`  - ${JSON.stringify(row)}`);
        }
      } else if (v && typeof v === "object") {
        lines.push(`- ${k}: ${JSON.stringify(v)}`);
      } else {
        lines.push(`- ${k}: ${v}`);
      }
    }
    lines.push("");
  }

  lines.push("## Quality Flags");
  lines.push("");
  for (const flag of report.quality_flags) {
    lines.push(`- [${flag.severity}] ${flag.code}: ${flag.message}`);
  }
  lines.push("");
  return lines.join("\n");
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(String(e.message ?? e));
    usage();
    process.exit(1);
  }

  const ontology = path.resolve(opts.ontology);
  const asserted = opts.asserted ? path.resolve(opts.asserted) : "";
  const inferred = opts.inferred ? path.resolve(opts.inferred) : "";
  const closure = opts.closure ? path.resolve(opts.closure) : "";
  const rules = opts.rules ? path.resolve(opts.rules) : "";
  const shapes = opts.shapes ? path.resolve(opts.shapes) : "";

  await assertReadableFile(ontology, "Ontology");
  if (asserted) await assertReadableFile(asserted, "Asserted");
  if (inferred) await assertReadableFile(inferred, "Inferred");
  if (closure) await assertReadableFile(closure, "Closure");
  if (rules) await assertReadableFile(rules, "Rules");
  if (shapes) await assertReadableFile(shapes, "Shapes");

  const tmpDir = await mkdtemp(path.join(tmpdir(), "onto-metrics-"));
  const dataFiles = pickDataFilesForInstanceMetrics({ asserted, inferred, closure });

  const report = {
    generated_at: nowIso(),
    inputs: {
      ontology,
      asserted: asserted || null,
      inferred: inferred || null,
      closure: closure || null,
      rules: rules || null,
      shapes: shapes || null,
      data_files_for_instance_metrics: dataFiles,
    },
    ontology: await ontologyMetrics(tmpDir, ontology),
    data: await dataMetrics(tmpDir, dataFiles, opts.topN),
    inference: await inferenceMetrics(tmpDir, { asserted, inferred }, opts.topN),
    rules: await ruleMetrics(tmpDir, { rules, asserted, inferred, closure }),
    shacl: await shaclMetrics(tmpDir, { shapes, asserted, inferred, closure }, opts.topN),
  };

  report.quality_flags = buildQualityFlags(report);

  const rendered = opts.format === "md"
    ? toMarkdown(report)
    : JSON.stringify(report, null, 2);

  if (opts.output) {
    const outputPath = path.resolve(opts.output);
    await writeFile(outputPath, rendered + "\n", "utf8");
    console.log(`Wrote ${opts.format.toUpperCase()} metrics to: ${outputPath}`);
  } else {
    console.log(rendered);
  }
}

main().catch((err) => {
  console.error(String(err.stack ?? err.message ?? err));
  process.exit(1);
});
