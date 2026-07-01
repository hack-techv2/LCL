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
  MAX_TOKENS_SLIDER: 32768, // slider max 
  DEFAULT_MAX_TOKENS: 8192,

  // Chat / RAG
  DOC_FULLTEXT_LIMIT: 10000,  // chars; conservative fallback for unknown/custom models
  DOC_FULLTEXT_FLOOR: 40000,  // item 2a: min full-text budget when model window is known
  DOC_FULLTEXT_CEILING: 250000, // item 2a: max full-text budget (cost/latency/quality cap)
  STICKY_CHUNK_RATIO: 0.3,    // share of topK reserved for previous-turn chunks
  RATE_LIMIT_GRACE_MS: 2000,  // extra wait past a 429 reset before auto-retry

  // Retrieval pipeline
  DEFAULT_RETRIEVAL_MODE: 'hybrid', // vector | keyword | hybrid | auto
  DEFAULT_RERANK_MODE: 'heuristic', 
  HYBRID_RRF_K: 60,
  HYBRID_CANDIDATE_MULT: 5,
  HYBRID_MAX_CANDIDATES: 80,
  MAX_RETRIEVAL_ROUNDS: 2,
  ENABLE_AUTO_RETRIEVE_MORE: true,
  RETRIEVAL_MIN_VECTOR_SCORE: 0.4,
  RETRIEVAL_STRONG_VECTOR_SCORE: 0.48,
  RETRIEVAL_SHORT_QUERY_MIN_VECTOR_SCORE: 0.4,
  RETRIEVAL_MIN_TERM_COVERAGE: 0.5,
  CONTEXT_EXPAND_NEIGHBORS: 1,
  CONTEXT_EXPAND_MIN_VECTOR_SCORE: 0.4,
  CONTEXT_EXPAND_MIN_TERM_COVERAGE: 0.4,
  CONTEXT_MAX_CHARS: 40000,
  PARENT_SECTION_MAX_CHARS: 4000,
  STRUCTURAL_SECTION_MAX_CHARS: 40000,
  SUFFICIENCY_MIN_TERM_COVERAGE: 0.6,

  // Chunking / embeddings
  DEFAULT_CHUNK_SIZE: 800,
  CHUNK_OVERLAP_RATIO: 0.2,
  MIN_CHUNK_CHARS: 40,
  MIN_SECTION_CHARS: 160,
  TOP_K_MIN: 3,
  TOP_K_MAX: 10,
  DEFAULT_TOP_K: 5,
  HASH_LEN: 16,               // shared with server hashText() — keep in sync

  // Files / OCR
  SCAN_MIN_PAGES: 2,
  SCAN_MIN_SHARE: 0.15,
  OCR_SCALE: 2.0,

  // Misc
  DEMO_SENTINEL: 'demo',
}

