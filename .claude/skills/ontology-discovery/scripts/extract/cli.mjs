function usage() {
  console.log(`Usage:
  extract-to-ttl.mjs --text <file.txt> --ontology <file.ttl> --output <out> --base-iri <iri> [options]

Required:
  --text <path>             Source text file for extraction
  --ontology <path>         Ontology .ttl
  --output <path>           Output file (TTL / RDF-XML / N-Quads)
  --base-iri <iri>          Base IRI for minted entities, e.g. http://localhost:4321/kg/

Extraction Options:
  --model <name>            Anthropic model (default: claude-haiku-4-5-20251001)
  --max-tokens <n>          Max output tokens per extraction pass call (default: 8192)
  --chunk-token-limit <n>   Max tokens per source chunk (default: 4096)
  --chars-per-token <n>     Chunk heuristic: chars per token (default: 4)
  --chunk-overlap-chars <n> Overlap between adjacent chunks (default: 0)
  --chunk-concurrency <n>   Number of chunks to process in parallel (default: 1)

Output Options:
  --mode <append|create>    Write mode (default: append; must be 'create' for non-TTL)
  --output-format <fmt>     ttl | rdf | nq (default: ttl)
  --no-marker               Skip the "# ---- extracted from ... ----" marker
  --help                    Show this help`);
}

function parsePositiveInt(value, flagName) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flagName} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeInt(value, flagName) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flagName} must be a non-negative integer`);
  }
  return parsed;
}

function parseArgs(argv) {
  const opts = {
    text: "",
    ontology: "",
    output: "",
    baseIri: "",
    mode: "append",
    outputFormat: "ttl",
    model: "claude-haiku-4-5-20251001",
    maxTokens: 8192,
    chunkTokenLimit: 4096,
    charsPerToken: 4,
    chunkOverlapChars: 0,
    chunkConcurrency: 1,
    noMarker: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const n = argv[i + 1];
    switch (a) {
      case "--text":
        opts.text = n ?? "";
        i++;
        break;
      case "--ontology":
        opts.ontology = n ?? "";
        i++;
        break;
      case "--output":
        opts.output = n ?? "";
        i++;
        break;
      case "--base-iri":
        opts.baseIri = n ?? "";
        i++;
        break;
      case "--mode":
        opts.mode = n ?? "";
        i++;
        break;
      case "--output-format":
        opts.outputFormat = (n ?? "").toLowerCase();
        i++;
        break;
      case "--model":
        opts.model = n ?? "";
        i++;
        break;
      case "--max-tokens":
        if (!n) throw new Error("--max-tokens requires a value");
        opts.maxTokens = parsePositiveInt(n, "--max-tokens");
        i++;
        break;
      case "--chunk-token-limit":
        if (!n) throw new Error("--chunk-token-limit requires a value");
        opts.chunkTokenLimit = parsePositiveInt(n, "--chunk-token-limit");
        i++;
        break;
      case "--chars-per-token":
        if (!n) throw new Error("--chars-per-token requires a value");
        opts.charsPerToken = parsePositiveInt(n, "--chars-per-token");
        i++;
        break;
      case "--chunk-overlap-chars":
        if (!n) throw new Error("--chunk-overlap-chars requires a value");
        opts.chunkOverlapChars = parseNonNegativeInt(n, "--chunk-overlap-chars");
        i++;
        break;
      case "--chunk-concurrency":
        if (!n) throw new Error("--chunk-concurrency requires a value");
        opts.chunkConcurrency = parsePositiveInt(n, "--chunk-concurrency");
        i++;
        break;
      case "--no-marker":
        opts.noMarker = true;
        break;
      case "--help":
      case "-h":
        usage();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${a}`);
    }
  }

  if (!opts.text || !opts.ontology || !opts.output || !opts.baseIri) {
    throw new Error("--text, --ontology, --output, and --base-iri are required.");
  }
  if (opts.mode !== "append" && opts.mode !== "create") {
    throw new Error("--mode must be 'append' or 'create'.");
  }
  if (!["ttl", "rdf", "nq"].includes(opts.outputFormat)) {
    throw new Error("--output-format must be ttl, rdf, or nq");
  }
  if (opts.outputFormat !== "ttl" && opts.mode === "append") {
    throw new Error("--mode append is only supported with --output-format ttl");
  }

  const chunkCharLimit = opts.chunkTokenLimit * opts.charsPerToken;
  if (opts.chunkOverlapChars >= chunkCharLimit) {
    throw new Error("--chunk-overlap-chars must be less than chunk-token-limit * chars-per-token");
  }

  if (!opts.baseIri.endsWith("/") && !opts.baseIri.endsWith("#")) {
    opts.baseIri += "/";
  }
  return opts;
}

export {
  parseArgs,
  usage,
};
