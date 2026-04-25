import { segmentSourceIntoTokenChunks } from "./chunking.mjs";
import { extractEntitiesForChunk, extractTriplesForChunk } from "./anthropic.mjs";

function firstNonBlank(...values) {
  for (const value of values) {
    if (value == null) continue;
    const trimmed = String(value).trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function dedupeEntityKey(type, canonical) {
  const t = String(type ?? "").trim().toLowerCase();
  const c = String(canonical ?? "").trim().toLowerCase();
  return `${t}|${c}`;
}

function isLocalEntityId(ref) {
  return /^e\d+$/.test(String(ref ?? "").trim());
}

function remapChunkEntityRef(ref, localToGlobal, chunkIndex, role, warnings) {
  const raw = String(ref ?? "").trim();
  if (!raw) return null;
  if (localToGlobal.has(raw)) return localToGlobal.get(raw);
  if (isLocalEntityId(raw)) {
    warnings.push(
      `chunk ${chunkIndex + 1}: triple ${role} references unknown local entity id '${raw}' (dropped)`
    );
    return null;
  }
  return raw;
}

function dedupeTriples(triples) {
  const deduped = new Map();
  for (const t of triples) {
    const key = JSON.stringify([
      t.s ?? "",
      t.p ?? "",
      t.o ?? "",
      t.oLiteral ?? "",
      t.datatype ?? "",
    ]);
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, t);
      continue;
    }
    const existingConfidence = existing.confidence ?? -1;
    const nextConfidence = t.confidence ?? -1;
    if (nextConfidence > existingConfidence) deduped.set(key, t);
  }
  return Array.from(deduped.values());
}

function sumUsage(a, b) {
  if (!a && !b) return null;
  const safeA = a ?? {};
  const safeB = b ?? {};
  return {
    input_tokens: (safeA.input_tokens ?? 0) + (safeB.input_tokens ?? 0),
    output_tokens: (safeA.output_tokens ?? 0) + (safeB.output_tokens ?? 0),
    cache_creation_input_tokens:
      (safeA.cache_creation_input_tokens ?? 0) + (safeB.cache_creation_input_tokens ?? 0),
    cache_read_input_tokens:
      (safeA.cache_read_input_tokens ?? 0) + (safeB.cache_read_input_tokens ?? 0),
  };
}

async function runChunkedTwoStageExtraction({
  client,
  sourceText,
  ontologyContext,
  model,
  maxTokens,
  chunkTokenLimit,
  charsPerToken,
  chunkOverlapChars,
  chunkConcurrency,
}) {
  const chunks = segmentSourceIntoTokenChunks(
    sourceText,
    chunkTokenLimit,
    charsPerToken,
    chunkOverlapChars
  );

  const warnings = [];
  if (chunks.length > 1) {
    warnings.push(
      `Source text was segmented into ${chunks.length} chunks ` +
        `(max ${chunkTokenLimit} tokens/chunk, heuristic: ${charsPerToken} chars/token, overlap: ${chunkOverlapChars} chars).`
    );
  }

  const chunkResults = new Array(chunks.length);
  const workerCount = Math.max(1, Math.min(chunkConcurrency, chunks.length));
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= chunks.length) return;

      const chunkText = chunks[index];
      const entityPass = await extractEntitiesForChunk(
        client,
        chunkText,
        ontologyContext,
        model,
        maxTokens
      );
      const triplePass = await extractTriplesForChunk(
        client,
        chunkText,
        ontologyContext,
        entityPass.entities,
        model,
        maxTokens
      );

      chunkResults[index] = {
        index,
        textLength: chunkText.length,
        entities: entityPass.entities,
        triples: triplePass.triples,
        entityUsage: entityPass.usage,
        tripleUsage: triplePass.usage,
        tripleSkipped: triplePass.skipped ?? false,
      };
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const mergedEntities = [];
  const mergedTriplesRaw = [];
  const entityKeyToGlobalId = new Map();
  let nextEntityId = 1;
  let droppedTriples = 0;

  for (const chunkResult of chunkResults) {
    const localToGlobal = new Map();

    for (const entity of chunkResult.entities) {
      const localId = String(entity.id ?? "").trim();
      if (!localId) continue;

      const canonical = firstNonBlank(entity.canonical, entity.mention, localId);
      const dedupeKey = dedupeEntityKey(entity.type, canonical);

      let globalId = entityKeyToGlobalId.get(dedupeKey);
      if (!globalId) {
        globalId = `e${nextEntityId++}`;
        entityKeyToGlobalId.set(dedupeKey, globalId);
        mergedEntities.push({
          id: globalId,
          mention: entity.mention,
          type: entity.type,
          canonical,
        });
      }
      localToGlobal.set(localId, globalId);
    }

    for (const triple of chunkResult.triples) {
      const mappedS = remapChunkEntityRef(
        triple.s,
        localToGlobal,
        chunkResult.index,
        "subject",
        warnings
      );
      if (!mappedS) {
        droppedTriples++;
        continue;
      }

      let mappedO = null;
      if (triple.o != null) {
        mappedO = remapChunkEntityRef(
          triple.o,
          localToGlobal,
          chunkResult.index,
          "object",
          warnings
        );
        if (!mappedO) {
          droppedTriples++;
          continue;
        }
      }

      mergedTriplesRaw.push({
        s: mappedS,
        p: triple.p,
        o: mappedO,
        oLiteral: triple.oLiteral,
        datatype: triple.datatype,
        evidence: triple.evidence,
        confidence: triple.confidence,
      });
    }
  }

  const mergedTriples = dedupeTriples(mergedTriplesRaw);
  const dedupedTriples = mergedTriplesRaw.length - mergedTriples.length;
  if (dedupedTriples > 0) {
    warnings.push(`Dropped ${dedupedTriples} duplicate triples during cross-chunk merge.`);
  }
  if (droppedTriples > 0) {
    warnings.push(`Dropped ${droppedTriples} triples due to unresolved local entity references.`);
  }

  let entityUsage = null;
  let tripleUsage = null;
  let totalProposedEntities = 0;
  let totalProposedTriples = 0;

  for (const chunkResult of chunkResults) {
    totalProposedEntities += chunkResult.entities.length;
    totalProposedTriples += chunkResult.triples.length;
    entityUsage = sumUsage(entityUsage, chunkResult.entityUsage);
    tripleUsage = sumUsage(tripleUsage, chunkResult.tripleUsage);
  }

  return {
    chunks,
    chunkResults,
    entities: mergedEntities,
    triples: mergedTriples,
    totalProposedEntities,
    totalProposedTriples,
    warnings,
    usage: {
      entity: entityUsage,
      triple: tripleUsage,
      total: sumUsage(entityUsage, tripleUsage),
    },
  };
}

export {
  runChunkedTwoStageExtraction,
};
