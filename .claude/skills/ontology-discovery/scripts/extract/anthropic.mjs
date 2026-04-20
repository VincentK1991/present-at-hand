import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const EntitySchema = z.object({
  id: z.string().regex(/^e\d+$/, "id must be like e1, e2, ..."),
  mention: z.string().min(1),
  type: z.string().min(1).describe("prefixed class name, e.g. ex:Hospital"),
  canonical: z.string().min(1).describe("normalized label used for IRI + rdfs:label"),
});

const TripleSchema = z.object({
  s: z.string().min(1).describe("entity id (e1...) or prefixed IRI"),
  p: z.string().min(1).describe("prefixed property name"),
  o: z.union([z.string(), z.null()]).describe("entity id or prefixed IRI; null for datatype triples"),
  oLiteral: z.union([z.string(), z.null()]).describe("literal value; null for object triples"),
  datatype: z.union([z.string(), z.null()]).describe("e.g. xsd:decimal; null defaults to xsd:string"),
  evidence: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const EntityPassSchema = z.object({
  entities: z.array(EntitySchema),
});

const TriplePassSchema = z.object({
  triples: z.array(TripleSchema),
});

function buildEntitySystemPrompt(ontologyContext) {
  return `You extract ontology-aligned entities from unstructured text.
Return ONLY valid JSON matching this schema:
{"entities":[{"id":"e1","mention":"...","type":"prefix:Class","canonical":"..."}]}

Rules:
- Use only classes listed in ALLOWED_CLASSES.
- Use deterministic short ids: e1, e2, e3...
- Canonicalize entity names (same entity appears once).
- Extract only from the provided SOURCE chunk.
- Do not invent entities not grounded in text.
- If uncertain, omit the entity.
- No markdown, no commentary, JSON only.

${ontologyContext}`;
}

function buildTripleSystemPrompt(ontologyContext) {
  return `You extract ontology-aligned triples from unstructured text.
Return ONLY valid JSON matching this schema:
{"triples":[{"s":"e1","p":"prefix:property","o":"e2","oLiteral":null,"datatype":null,"evidence":"short quote","confidence":0.0}]}

Rules:
- s MUST be one of the provided entity ids.
- If object is an entity, set o to entity id and set oLiteral null.
- If object is a literal, set o null and set oLiteral to literal text.
- Subject and predicate must be supported by the provided SOURCE chunk.
- Do not create cross-chunk or cross-document relations.
- Use only properties listed in ALLOWED_PROPERTIES.
- Use datatype only when oLiteral is set (e.g. xsd:string, xsd:date).
- confidence must be between 0 and 1.
- evidence should be a short supporting quote from source.
- No markdown, no commentary, JSON only.

${ontologyContext}`;
}

async function extractEntitiesForChunk(client, chunkText, ontologyContext, model, maxTokens) {
  const response = await client.messages.parse({
    model,
    max_tokens: maxTokens,
    temperature: 0,
    system: buildEntitySystemPrompt(ontologyContext),
    messages: [
      {
        role: "user",
        content: `SOURCE:\n\n\`\`\`\n${chunkText}\n\`\`\``,
      },
    ],
    output_config: { format: zodOutputFormat(EntityPassSchema) },
  });

  if (!response.parsed_output) {
    throw new Error(
      `Entity pass: model did not return structured output. stop_reason=${response.stop_reason}\n` +
        `content: ${JSON.stringify(response.content).slice(0, 500)}`
    );
  }

  return {
    entities: response.parsed_output.entities,
    usage: response.usage ?? null,
    model: response.model ?? model,
  };
}

async function extractTriplesForChunk(client, chunkText, ontologyContext, entities, model, maxTokens) {
  if (!entities.length) {
    return {
      triples: [],
      usage: null,
      model,
      skipped: true,
    };
  }

  const entitiesJson = JSON.stringify(entities, null, 2);
  const userPrompt = `ENTITIES:
${entitiesJson}

SOURCE:
${chunkText}`;

  const response = await client.messages.parse({
    model,
    max_tokens: maxTokens,
    temperature: 0,
    system: buildTripleSystemPrompt(ontologyContext),
    messages: [
      {
        role: "user",
        content: userPrompt,
      },
    ],
    output_config: { format: zodOutputFormat(TriplePassSchema) },
  });

  if (!response.parsed_output) {
    throw new Error(
      `Triple pass: model did not return structured output. stop_reason=${response.stop_reason}\n` +
        `content: ${JSON.stringify(response.content).slice(0, 500)}`
    );
  }

  return {
    triples: response.parsed_output.triples,
    usage: response.usage ?? null,
    model: response.model ?? model,
    skipped: false,
  };
}

export {
  extractEntitiesForChunk,
  extractTriplesForChunk,
};
