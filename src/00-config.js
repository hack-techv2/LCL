// =============================================================================
// Central tunable constants (CFG)
// =============================================================================
// Single source of truth for limits, thresholds and magic numbers that were
// previously scattered as inline literals across modules. Loaded first (sorts
// before every other src module) so the whole bundle can read CFG values.
// Namespaced under one object to stay collision-free in the concatenated scope.
const CFG = {
  // Tokens
  MAX_TOKENS_CAP: 131072,   // hard ceiling accepted by Save (custom input)
  MAX_TOKENS_SLIDER: 32768, // slider max (custom input may exceed, up to CAP)
  DEFAULT_MAX_TOKENS: 8192,

  // Chat / RAG
  DOC_FULLTEXT_LIMIT: 200000, // chars; below this a doc is sent in full vs RAG
  STICKY_CHUNK_RATIO: 0.3,    // share of topK reserved for previous-turn chunks
  RATE_LIMIT_GRACE_MS: 2000,  // extra wait past a 429 reset before auto-retry

  // Chunking / embeddings
  DEFAULT_CHUNK_SIZE: 800,
  CHUNK_OVERLAP_RATIO: 0.2,
  MIN_CHUNK_CHARS: 40,
  DEFAULT_TOP_K: 5,
  HASH_LEN: 16,               // shared with server hashText() — keep in sync

  // Files / OCR
  SCAN_MIN_PAGES: 2,
  SCAN_MIN_SHARE: 0.15,
  OCR_SCALE: 2.0,

  // Misc
  DEMO_SENTINEL: 'demo',
}
