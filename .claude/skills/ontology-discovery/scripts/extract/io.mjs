import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

const TTL_DIRECTIVE_RE = /^\s*(?:@prefix|@base|PREFIX|BASE)\b/i;

async function assertReadableFile(p, label) {
  try {
    await access(p, constants.R_OK);
  } catch {
    throw new Error(`${label} file not found or unreadable: ${p}`);
  }
}

async function fileExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function utcIsoNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function splitTurtleDirectives(ttl) {
  const lines = ttl.split(/\r?\n/);
  const directives = [];
  const body = [];
  for (const ln of lines) (TTL_DIRECTIVE_RE.test(ln) ? directives : body).push(ln);
  return { directives, body: body.join("\n") };
}

function directiveKey(line) {
  return line.trim().replace(/\s+/g, " ").replace(/\s+\.\s*$/, ".").toLowerCase();
}

async function appendOrWriteTurtle(
  outputPath,
  incoming,
  markerText,
  mode,
  noMarker,
  markerLabel = "extracted"
) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const exists = await fileExists(outputPath);
  if (mode === "create" || !exists) await writeFile(outputPath, "", "utf8");
  const current = await readFile(outputPath, "utf8");

  const cur = splitTurtleDirectives(current);
  const inc = splitTurtleDirectives(incoming);

  const merged = new Map();
  for (const ln of cur.directives) merged.set(directiveKey(ln), ln.trimEnd());
  for (const ln of inc.directives) {
    const k = directiveKey(ln);
    if (!merged.has(k)) merged.set(k, ln.trimEnd());
  }

  let body = cur.body;
  if (!noMarker) {
    if (body.length > 0 && !body.endsWith("\n")) body += "\n";
    if (body.length > 0) body += "\n";
    body += `# ---- ${markerLabel} from ${markerText} at ${utcIsoNow()} ----\n`;
  } else if (body.length > 0 && !body.endsWith("\n")) {
    body += "\n";
  }
  body += inc.body;

  let next = "";
  const dirBlock = Array.from(merged.values()).join("\n").trim();
  if (dirBlock) next += `${dirBlock}\n\n`;
  next += body.replace(/^\n+/, "");
  await writeFile(outputPath, next, "utf8");
}

async function writeNonTurtle(outputPath, content) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, content, "utf8");
}

export {
  appendOrWriteTurtle,
  assertReadableFile,
  writeNonTurtle,
};
