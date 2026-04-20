import { createHash } from "node:crypto";
import { runCommand } from "./shell.mjs";

const XSD = "http://www.w3.org/2001/XMLSchema#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const OWL = "http://www.w3.org/2002/07/owl#";

const BUILTIN_PREFIXES = new Map([
  ["rdf", RDF],
  ["rdfs", RDFS],
  ["owl", OWL],
  ["xsd", XSD],
]);

function parsePrefixMap(ontologyContent) {
  const map = new Map(BUILTIN_PREFIXES);
  const lines = ontologyContent.split(/\r?\n/);

  for (const line of lines) {
    const ttlMatch = line.match(/^\s*@prefix\s+([A-Za-z][\w-]*|):\s*<([^>]+)>\s*\.\s*$/i);
    if (ttlMatch) {
      const prefix = ttlMatch[1] === ":" ? "" : ttlMatch[1];
      map.set(prefix, ttlMatch[2]);
      continue;
    }
    const sparqlMatch = line.match(/^\s*PREFIX\s+([A-Za-z][\w-]*|):\s*<([^>]+)>\s*$/i);
    if (sparqlMatch) {
      const prefix = sparqlMatch[1] === ":" ? "" : sparqlMatch[1];
      map.set(prefix, sparqlMatch[2]);
    }
  }
  return map;
}

function expandCurie(curieOrIri, prefixMap) {
  if (!curieOrIri) return null;
  const s = curieOrIri.trim();
  if (s.startsWith("<") && s.endsWith(">")) return s.slice(1, -1);
  if (/^(?:https?:\/\/|urn:)/i.test(s)) return s;
  const i = s.indexOf(":");
  if (i < 0) return null;
  const prefix = s.slice(0, i);
  const local = s.slice(i + 1);
  const ns = prefixMap.get(prefix);
  if (!ns) return null;
  return ns + local;
}

function shortForm(uri, prefixMap) {
  let bestPrefix = null;
  let bestNs = "";
  for (const [prefix, ns] of prefixMap.entries()) {
    if (!ns || !uri.startsWith(ns)) continue;
    if (ns.length > bestNs.length) {
      bestNs = ns;
      bestPrefix = prefix;
    }
  }
  if (bestPrefix == null) return uri;
  const local = uri.slice(bestNs.length);
  if (!local) return uri;
  return bestPrefix ? `${bestPrefix}:${local}` : `:${local}`;
}

async function parseOntologyVocabularyFromTurtle(ontologyContent) {
  const { stdout: nt } = await runCommand(
    "riot",
    ["--syntax=TTL", "--output=NT", "-"],
    ontologyContent
  );

  const classUris = new Set();
  const propertyUris = new Set();

  const classTypeUris = new Set([`${OWL}Class`, `${RDFS}Class`]);
  const propertyTypeUris = new Set([
    `${OWL}ObjectProperty`,
    `${OWL}DatatypeProperty`,
    `${RDF}Property`,
    `${OWL}AnnotationProperty`,
  ]);

  const rdfType = `${RDF}type`;
  const rdfsSubClassOf = `${RDFS}subClassOf`;
  const rdfsDomain = `${RDFS}domain`;
  const rdfsRange = `${RDFS}range`;

  const iriTripleRe = /^<([^>]+)>\s+<([^>]+)>\s+<([^>]+)>\s+\.\s*$/;
  const lines = nt.split(/\r?\n/);

  for (const line of lines) {
    const m = line.match(iriTripleRe);
    if (!m) continue;

    const s = m[1];
    const p = m[2];
    const o = m[3];

    if (p === rdfType) {
      if (classTypeUris.has(o)) classUris.add(s);
      if (propertyTypeUris.has(o)) propertyUris.add(s);
      continue;
    }
    if (p === rdfsSubClassOf) {
      classUris.add(s);
      classUris.add(o);
      continue;
    }
    if (p === rdfsDomain) {
      propertyUris.add(s);
      classUris.add(o);
      continue;
    }
    if (p === rdfsRange) {
      propertyUris.add(s);
      if (!o.startsWith(XSD)) classUris.add(o);
    }
  }

  return {
    classUris,
    propertyUris,
  };
}

function buildOntologyContext(prefixMap, vocabulary) {
  const classNames = Array.from(vocabulary.classUris)
    .map((uri) => shortForm(uri, prefixMap))
    .sort();
  const propertyNames = Array.from(vocabulary.propertyUris)
    .map((uri) => shortForm(uri, prefixMap))
    .sort();
  const prefixes = Array.from(prefixMap.entries()).sort(([a], [b]) => a.localeCompare(b));

  let out = "PREFIXES:\n";
  for (const [prefix, ns] of prefixes) {
    out += `${prefix}: ${ns}\n`;
  }

  out += "\nALLOWED_CLASSES:\n";
  for (const cls of classNames) out += `- ${cls}\n`;

  out += "\nALLOWED_PROPERTIES:\n";
  for (const prop of propertyNames) out += `- ${prop}\n`;

  return out.trimEnd();
}

function slugify(s, fallback, maxLen) {
  if (!s) return fallback.slice(0, maxLen);
  let out = s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!out) out = fallback;
  return out.slice(0, maxLen);
}

function shortSha(seed, hexChars = 10) {
  return createHash("sha256").update(seed, "utf8").digest("hex").slice(0, hexChars);
}

function localName(iri) {
  const hash = iri.lastIndexOf("#");
  const slash = iri.lastIndexOf("/");
  const idx = Math.max(hash, slash);
  return idx >= 0 ? iri.slice(idx + 1) : iri;
}

function mintEntityIri(baseIri, typeIri, canonical) {
  const localType = slugify(localName(typeIri), "resource", 32);
  const normalizedLabel = slugify(canonical, localType, 64);
  const seed = `${localType}|${(canonical ?? normalizedLabel).toLowerCase()}`;
  const sha = shortSha(seed, 10);
  return `${baseIri}${localType}/${normalizedLabel}-${sha}`;
}

function escapeLiteral(s) {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

function ntIri(iri) {
  return `<${iri}>`;
}

function ntLiteral(value, datatypeIri) {
  const dt = datatypeIri || `${XSD}string`;
  return `"${escapeLiteral(value)}"^^<${dt}>`;
}

function buildNTriples(structured, prefixMap, baseIri) {
  const lines = [];
  const warnings = [];
  const idToIri = new Map();

  for (const e of structured.entities) {
    const typeIri = expandCurie(e.type, prefixMap);
    if (!typeIri) {
      warnings.push(`entity ${e.id}: unresolvable type '${e.type}'`);
      continue;
    }
    const iri = mintEntityIri(baseIri, typeIri, e.canonical);
    idToIri.set(e.id, iri);
    lines.push(`${ntIri(iri)} ${ntIri(`${RDF}type`)} ${ntIri(typeIri)} .`);
    lines.push(`${ntIri(iri)} ${ntIri(`${RDFS}label`)} "${escapeLiteral(e.canonical)}" .`);
  }

  const resolveNode = (ref) => {
    if (!ref) return null;
    if (idToIri.has(ref)) return idToIri.get(ref);
    return expandCurie(ref, prefixMap);
  };

  for (const t of structured.triples) {
    const predIri = expandCurie(t.p, prefixMap);
    if (!predIri) {
      warnings.push(`triple: unresolvable predicate '${t.p}'`);
      continue;
    }
    const subjIri = resolveNode(t.s);
    if (!subjIri) {
      warnings.push(`triple: unresolvable subject '${t.s}'`);
      continue;
    }

    if (t.oLiteral != null) {
      const dtIri = t.datatype ? expandCurie(t.datatype, prefixMap) : `${XSD}string`;
      if (!dtIri) {
        warnings.push(`triple: unresolvable datatype '${t.datatype}'`);
        continue;
      }
      lines.push(`${ntIri(subjIri)} ${ntIri(predIri)} ${ntLiteral(t.oLiteral, dtIri)} .`);
    } else if (t.o != null) {
      const objIri = resolveNode(t.o);
      if (!objIri) {
        warnings.push(`triple: unresolvable object '${t.o}'`);
        continue;
      }
      lines.push(`${ntIri(subjIri)} ${ntIri(predIri)} ${ntIri(objIri)} .`);
    } else {
      warnings.push(`triple: predicate ${t.p} has neither o nor oLiteral (skipped)`);
    }
  }

  return {
    nt: lines.join("\n") + (lines.length ? "\n" : ""),
    warnings,
    mintedCount: idToIri.size,
  };
}

async function ntToFormat(nt, format) {
  if (!nt.trim()) return "";
  const outMap = { ttl: "TTL", rdf: "RDFXML", nq: "NQUADS" };
  const { stdout } = await runCommand("riot", ["--syntax=NT", `--output=${outMap[format]}`, "-"], nt);
  return stdout;
}

function pickResourcePrefix(prefixMap) {
  const candidates = ["kg", "res", "resource"];
  for (const c of candidates) {
    if (!prefixMap.has(c)) return c;
  }
  let i = 1;
  while (prefixMap.has(`kg${i}`)) i++;
  return `kg${i}`;
}

function buildTurtlePrefixBlock(prefixMap, baseIri) {
  const out = [];
  const entries = Array.from(prefixMap.entries()).sort(([a], [b]) => a.localeCompare(b));

  for (const [prefix, ns] of entries) {
    if (!ns) continue;
    if (prefix === "") out.push(`@prefix : <${ns}> .`);
    else out.push(`@prefix ${prefix}: <${ns}> .`);
  }

  if (baseIri) {
    const alreadyHasBase = entries.some(([, ns]) => ns === baseIri);
    if (!alreadyHasBase) {
      const resourcePrefix = pickResourcePrefix(prefixMap);
      out.push(`@prefix ${resourcePrefix}: <${baseIri}> .`);
    }
  }

  return out.join("\n");
}

async function ntToFormatWithPrefixes(nt, format, prefixMap, baseIri) {
  if (!nt.trim()) return "";
  if (format !== "ttl") return ntToFormat(nt, format);

  const prefixBlock = buildTurtlePrefixBlock(prefixMap, baseIri);
  const ttlInput = `${prefixBlock}\n\n${nt}`;
  const { stdout } = await runCommand("riot", ["--syntax=TTL", "--formatted=TTL", "-"], ttlInput);
  return stdout;
}

async function buildOntologyContextFromTurtle(ontologyContent) {
  const prefixMap = parsePrefixMap(ontologyContent);
  const vocabulary = await parseOntologyVocabularyFromTurtle(ontologyContent);
  const ontologyContext = buildOntologyContext(prefixMap, vocabulary);
  return { prefixMap, ontologyContext, vocabulary };
}

export {
  buildNTriples,
  buildOntologyContextFromTurtle,
  ntToFormat,
  ntToFormatWithPrefixes,
  parsePrefixMap,
};
