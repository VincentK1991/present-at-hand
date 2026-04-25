function findWhitespaceSplitBackward(text, start, endExclusive) {
  for (let i = endExclusive; i > start; i--) {
    if (/\s/.test(text[i - 1])) return i;
  }
  return endExclusive;
}

function segmentSourceIntoTokenChunks(sourceText, tokenLimit, charsPerToken, overlapChars = 0) {
  const text = sourceText ?? "";
  if (!text.trim()) return [""];

  const effectiveTokenLimit = Math.max(1, tokenLimit);
  const effectiveCharsPerToken = Math.max(1, charsPerToken);
  const charLimit = effectiveTokenLimit * effectiveCharsPerToken;

  if (text.length <= charLimit) return [text];

  const chunks = [];
  let start = 0;
  const length = text.length;

  while (start < length) {
    let end = Math.min(start + charLimit, length);
    if (end < length) {
      const split = findWhitespaceSplitBackward(text, start, end);
      if (split > start) end = split;
    }

    chunks.push(text.slice(start, end));

    let nextStart = end;
    if (overlapChars > 0) {
      nextStart = Math.max(start + 1, end - overlapChars);
    }
    start = nextStart;
    while (start < length && /\s/.test(text[start])) start++;
  }

  return chunks;
}

export {
  segmentSourceIntoTokenChunks,
};
