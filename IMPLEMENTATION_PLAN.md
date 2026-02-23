# PaperGraph — Implementation Plan

> **Goal**: Build `papergraph` — an npm CLI tool that creates research paper connectivity graphs from topics, keywords, or paper titles. Produces SQLite `.db` + self-contained HTML viewer.

---

## Architecture Overview

```
src/
  cli/           → Commander CLI (build, export, inspect, view, cache clear)
  sources/       → OpenAlex + Semantic Scholar adapters
  graph/         → Graph builder, spines (citation/similarity/co-citation/coupling/hybrid)
  nlp/           → TF-IDF tokenizer + cosine similarity
  storage/       → SQLite (better-sqlite3, 10 tables, WAL mode)
  exporters/     → JSON/GraphML/GEXF/CSV/Mermaid
  viewer/        → Self-contained HTML (Cytoscape.js + ELK.js)
  llm/           → OpenAI + Ollama (edge labeling + cluster naming)
  cache/         → File-based JSON cache (SHA-256 keys, 7-day TTL)
  entities/      → Dictionary-based extraction (datasets/methods/tasks/metrics)
  types/         → Shared TypeScript interfaces
  utils/         → HTTP client, logger, config loader
  __tests__/     → Vitest test suite
```

---

## Tech Stack

| Concern | Choice |
|---------|--------|
| Language | TypeScript (ES2022, NodeNext) |
| CLI | commander |
| HTTP | undici (native fetch) |
| SQLite | better-sqlite3 (WAL, foreign keys) |
| Graph | graphology + graphology-metrics + graphology-communities-louvain + graphology-operators |
| NLP | Custom TF-IDF (no external library, no stemming) |
| Config | cosmiconfig (`papergraph.config.json` only) |
| Logging | pino |
| Build | tsup (entry: `src/cli/index.ts`, format: esm, target: node20) |
| Test | Vitest (fixture mocking, no live API calls) |
| Viewer | Cytoscape.js + ELK.js (CDN-loaded in HTML) |

---

## Implementation Steps

### Step 1 — Project Scaffolding + Types + Config

**Files**: `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `src/types/*.ts`, `src/utils/config.ts`, `src/utils/logger.ts`

1. `npm init` + install all deps (core + dev)
2. Create directory structure (all 12 directories under `src/`)
3. Define shared types in `src/types/`:
   - `paper.ts` — Paper interface (paper_id, source, source_id, doi, arxiv_id, title, abstract, year, venue, url, citation_count, influence_score, keywords_json, concepts_json)
   - `edge.ts` — Edge interface + EdgeType enum (16 types: CITES, CITED_BY, CO_CITED, BIB_COUPLED, SIMILAR_TEXT, SHARED_KEYWORDS, SAME_AUTHOR, SAME_VENUE, EXTENDS, IMPROVES, SURVEYS, CONTRADICTS, USES_METHOD, INTRODUCES_METHOD, USES_DATASET, INTRODUCES_DATASET)
   - `cluster.ts`, `entity.ts`, `config.ts`, `source-adapter.ts`, `llm-provider.ts`
4. Config loader (`cosmiconfig`) — merge: CLI flags > env vars > config file
5. Logger (`pino`) — supports `--log-level` and `--json-logs`
6. tsup config: entry `src/cli/index.ts`, format esm, target node20
7. `package.json` bin: `"papergraph": "dist/cli/index.js"` with shebang
8. Vitest config + one example test
9. `.gitignore`, `.npmignore`

**Verify**: `npx tsc --noEmit` passes, `npx tsup` builds, `npx vitest run` passes 1 test

---

### Step 2 — HTTP Client (rate limiting + retry)

**Files**: `src/utils/http-client.ts`

1. Centralized HTTP client on top of `undici` fetch
2. Token bucket rate limiter (per-source: OpenAlex 100/s, S2 1/s)
3. Exponential backoff retry (max 3, initial 1s, max 30s, jitter)
4. HTTP 429 → parse `Retry-After` header
5. Credit tracking (count requests per source, warn at 80% daily limit)
6. Request queue (serialize per-source)
7. Configurable timeout (default 30s)
8. User-Agent: `PaperGraph/{version} (mailto:...)` (required by OpenAlex)
9. Error classification: retryable (429, 500, 503, ECONNRESET) vs fatal (400, 401, 404)

**Verify**: Rate limiter throttles 5 requests at 2/sec → elapsed ≥ 2s

---

### Step 3 — SQLite Storage Layer

**Files**: `src/storage/database.ts`, `src/storage/migrations.ts`

1. Wrap better-sqlite3: WAL mode, foreign keys ON, `PRAGMA user_version` for migrations
2. Create all 10 tables in migration v1:
   - `runs`, `papers`, `edges`, `authors`, `paper_authors`, `clusters`, `paper_clusters`, `entities`, `paper_entities`
   - All PKs: `INTEGER PRIMARY KEY` (SQLite native rowid)
3. Indexes: edges by (src_paper_id), (dst_paper_id), (type); papers by (doi), (arxiv_id), (source_id), (year)
4. CRUD methods wrapped in `db.transaction()`:
   - `insertPapers()`, `insertEdges()`, `insertRun()`, `upsertPaper()`
   - `getPaperById()`, `getPaperByDoi()`, `getPaperBySourceId()`, `paperExists()`
   - `getAllPapers()`, `getAllEdges()`, `getAllClusters()`, `getAllEntities()`, `getStats()`
   - `insertClusters()`, `insertEntities()`, `insertAuthors()`

**Verify**: Create DB → `.tables` shows 10 tables, `PRAGMA user_version` = 1, `PRAGMA journal_mode` = wal

---

### Step 4 — OpenAlex Source Adapter

**Files**: `src/sources/openalex.ts`, `src/sources/utils.ts`

1. Implement `SourceAdapter` interface: `searchByTopic`, `searchByTitle`, `fetchPaper`, `fetchReferences`, `fetchCitations`
2. `searchByTitle` — use `filter=title.search:{title}` with `.no_stem` for exact match first, fall back to stemmed
3. Abstract reconstruction: `invertedIndexToText(invertedIndex)` — handles malformed/null entries
4. Normalize OpenAlex response → `Paper` interface (map all fields, strip DOI prefix, extract arXiv ID)
5. API key from `OPENALEX_API_KEY` env var
6. Pagination handling (`meta.count`, `meta.per_page`, `meta.page`)

**Verify**: `invertedIndexToText({"This":[0],"is":[1],"a":[2],"test":[3]})` → `"This is a test"`

---

### Step 5 — Semantic Scholar Source Adapter

**Files**: `src/sources/semantic-scholar.ts`

1. Implement `SourceAdapter`: `searchByTopic`, `searchByTitle`, `fetchPaper`, `fetchReferences`, `fetchCitations`, `batchFetchPapers`
2. Title cleaning: remove hyphens, plus signs (S2 treats them as operators)
3. Batch endpoint: POST `/paper/batch` — max 500 per request, split larger batches
4. API key from `S2_API_KEY` env var as `x-api-key` header
5. Token-based pagination for bulk search

**Verify**: `batchFetchPapers(600 IDs)` splits into 2 batches (500 + 100)

---

### Step 6 — NLP Pipeline (TF-IDF + Cosine Similarity)

**Files**: `src/nlp/tfidf.ts`, `src/nlp/tokenizer.ts`, `src/nlp/similarity.ts`, `src/nlp/stopwords.ts`

1. Tokenizer: lowercase, split on whitespace/punctuation, remove ~150 English stopwords, no stemming
2. TF-IDF: `buildCorpus(papers)` from title+abstract; null abstract → title+keywords only (log warning %)
3. Cosine similarity: `computeSimilarity(a, b, corpus)`, `findTopKSimilar(id, corpus, k, threshold)`
4. `buildSimilarityEdges(papers, corpus, config)` → SIMILAR_TEXT edges
5. **Deterministic**: identical input → identical output (no random seeds, fixed precision)

**Verify**: Two runs on same 5 papers produce identical similarity scores; self-similarity = 1.0; all scores ∈ [0, 1]

---

### Step 7 — Graph Algorithms

**Files**: `src/graph/algorithms.ts`, `src/graph/scoring.ts`

1. **PageRank**: Build `DirectedGraph` from CITES edges, compute via `graphology-metrics/centrality/pagerank`
2. **Louvain**: Convert directed → undirected via `graphology-operators.toUndirected()`, run `graphology-communities-louvain`, map to Cluster objects
3. Non-LLM cluster naming: top-3 TF-IDF terms from cluster members' titles
4. **Scoring**: composite score = pagerank×0.5 + relevance×0.3 + recency×0.2 (configurable weights)
5. **Co-citation**: for each pair cited together by a third paper → CO_CITED edge (count-based weight)
6. **Bib coupling**: weight = |overlap(refs_A, refs_B)| / min(|refs_A|, |refs_B|) → BIB_COUPLED edge

**Verify**: PageRank scores > 0, sum ≈ 1.0; most-cited paper has highest PageRank; every paper gets a cluster

---

### Step 8 — Graph Builder + Citation Spine + Title Search

**Files**: `src/graph/builder.ts`, `src/graph/title-resolver.ts`, `src/graph/spines/citation.ts`

1. **Title resolution**: `resolvePaperByTitle(title, source)`:
   - Exact match (case-insensitive, normalized) → auto-select
   - Near match (>90% Levenshtein) → pick highest citation count
   - Multiple → auto-select highest-cited, log selection
   - `--paper-index N` override
2. **Build pipeline** (orchestrates everything):
   1. Parse input → resolve topic/seeds/paper-title into seed set
   2. Fetch seeds via source adapter
   3. Store seeds in DB
   4. BFS expansion by depth: fetch refs/citations per frontier paper, honor limits (`--max-refs-per-paper`, `--max-cites-per-paper`, `--year-from/to`, `--max-papers`), skip papers already in DB (minimal resume)
   5. Build CITES edges, filter self-citations (A→A)
   6. Run NLP similarity (if enabled)
   7. Run graph algorithms (scoring + clustering)
   8. Run entity extraction (if enabled)
   9. Record run metadata
   10. Log summary stats
3. **Citation spine**: expand via refs/citations, build CITES edges, rank by PageRank

**Verify**: Builder with 10 fixture papers → DB has ≥10 papers, >0 CITES edges, 1 run, 0 self-citation edges

---

### Step 9 — Extended Spines

**Files**: `src/graph/spines/similarity.ts`, `src/graph/spines/co-citation.ts`, `src/graph/spines/coupling.ts`, `src/graph/spines/hybrid.ts`, `src/graph/spines/index.ts`

1. **Similarity spine**: TF-IDF corpus → top-K neighbors above threshold → SIMILAR_TEXT edges
2. **Co-citation spine**: use co-citation computation from algorithms module
3. **Coupling spine**: use bib-coupling computation
4. **Hybrid spine**: normalize weights [0,1], weighted sum, cap degree per node (default 20)
5. **Factory**: `getSpine(name: SpineType)` returns correct strategy

**Verify**: `--spine similarity` → SIMILAR_TEXT edges exist; `--spine hybrid` → multiple edge types present

---

### Step 10 — Entity Extraction

**Files**: `src/entities/extractor.ts`, `src/entities/index.ts`, `src/entities/dictionaries/*.json`

1. Ship curated dictionaries (~100-200 entries): `datasets.json`, `methods.json`, `tasks.json`, `metrics.json`
2. Case-insensitive substring + word boundary matching against title + abstract
3. Regex patterns for CamelCase/hyphenated model/dataset names
4. OpenAlex concepts fallback: map high-level concepts to task entities
5. Role classification: `uses` (default), `introduces` (if title contains entity), `benchmarks` (metric/dataset)
6. Store via storage layer (entities + paper_entities tables)

**Verify**: Paper with "LibriSpeech and MNIST" in abstract → both extracted as type=dataset

---

### Step 11 — Cache System

**Files**: `src/cache/cache.ts`

1. File-based JSON cache at `~/.cache/papergraph/` (or `%LOCALAPPDATA%\papergraph\cache` on Windows)
2. Key: SHA-256 of (source + endpoint + params JSON) → filename
3. Each file: `{response, timestamp, ttl}`; default TTL: 7 days
4. Operations: `get(key)`, `set(key, response, ttl?)`, `has(key)`, `clear()`, `stats()`
5. Wrap HttpClient — check cache before API call, store after
6. `--no-cache` flag bypasses entirely
7. Do NOT cache LLM responses

**Verify**: `set("k", {data:"hello"})` then `get("k")` returns it; expired entry returns null; `clear()` removes all

---

### Step 12 — LLM Enrichment

**Files**: `src/llm/provider.ts`, `src/llm/openai.ts`, `src/llm/ollama.ts`, `src/llm/tasks/edge-labeling.ts`, `src/llm/tasks/cluster-naming.ts`, `src/llm/orchestrator.ts`

1. **OpenAI adapter**: POST `/v1/chat/completions`, key from `OPENAI_API_KEY`, JSON mode
2. **Ollama adapter**: POST `http://localhost:11434/api/chat`, no key, detect if running
3. **Edge labeling**: classify pairs → EXTENDS/IMPROVES/SURVEYS/CONTRADICTS/USES_METHOD/INTRODUCES_METHOD/USES_DATASET/INTRODUCES_DATASET; include rationale + evidence + confidence
4. **Cluster naming**: top-5 paper titles → name (3-5 words) + description (1-2 sentences)
5. **Orchestrator**: respect `--llm-concurrency`, `--llm-budget`, `--llm-tasks edges,clusters`; log usage
6. All LLM edges: `created_by='llm'`, store model/provider/timestamp in provenance_json
7. Budget caps: maxAnnotatedPapers=120, maxAnnotatedEdges=400

**Verify**: Mock OpenAI response → parsed to {type, rationale, evidence, confidence}; budget cap honored

---

### Step 13 — Exporters

**Files**: `src/exporters/exporter.ts`, `src/exporters/json.ts`, `src/exporters/graphml.ts`, `src/exporters/gexf.ts`, `src/exporters/csv.ts`, `src/exporters/mermaid.ts`, `src/exporters/index.ts`

1. **JSON**: Cytoscape-compatible `{elements: {nodes: [...], edges: [...]}}`
2. **GraphML**: standard XML with node/edge data keys (no raw abstracts — too large)
3. **GEXF**: XML with attributes, edge weights, dynamic year
4. **CSV**: `papers.csv` + `edges.csv` in output directory, proper escaping
5. **Mermaid**: flowchart syntax, **hard cap 50 nodes** (top-50 by score), log warning if truncated
6. **Factory**: `getExporter(format)` returns correct implementation

**Verify**: JSON export has `.elements.nodes.length > 0`; CSV creates both files; Mermaid ≤ 50 nodes

---

### Step 14 — HTML Viewer

**Files**: `src/viewer/template.html`, `src/viewer/generate.ts`, `src/viewer/styles.ts`

1. Single HTML file: inline CSS/JS, CDN-load Cytoscape.js + ELK.js + cytoscape-elk
2. Inject graph data as `window.paperGraphData = /* JSON */` (escape `</` → `<\/` for XSS prevention)
3. **Layout**: ELK layered (top-down, git-graph-like), nodeNode spacing 80px
4. **Nodes**: size ∝ score (20-60px), color by cluster (10-color palette), rectangle shape, label: first 40 chars
5. **Edges**: color by type (CITES=#888, SIMILAR=#4a90d9, CO_CITED=#50c878, BIB_COUPLED=#e8a838, LLM=#ff6b6b), width ∝ weight, arrows for CITES
6. **Interaction**: pan/zoom, click → side panel (title, authors, year, venue, abstract, citations, scores, DOI link), edge type filter checkboxes
7. Performance: `hideEdgesOnViewport: true` when >500 nodes

**Verify**: Generated HTML > 1KB, contains `paperGraphData` and `cytoscape`, renders in browser with canvas element

---

### Step 15 — CLI Layer (Wires Everything Together)

**Files**: `src/cli/index.ts`, `src/cli/commands/build.ts`, `src/cli/commands/export.ts`, `src/cli/commands/view.ts`, `src/cli/commands/inspect.ts`, `src/cli/commands/cache.ts`

1. Entry point with `#!/usr/bin/env node` shebang
2. **`build`**: all flags from PRD §7.2 (--topic, --paper, --paper-index, --source, --spine, --depth, --max-papers, etc.), config merging, wire full pipeline
3. **`export`**: --db, --format (json|graphml|gexf|csv|mermaid|html), --out
4. **`view`**: generate HTML + auto-open in browser
5. **`inspect`**: --db → print paper/edge/cluster/entity counts
6. **`cache clear`**: clear cache directory
7. Error handling: try/catch all commands, user-friendly errors, exit code 1
8. Env var mapping: `OPENALEX_API_KEY`, `S2_API_KEY`, `OPENAI_API_KEY`

**Verify**: `--help` lists all 5 commands; `build --help` lists all flags; end-to-end build creates valid DB

---

### Step 16 — Test Suite

**Files**: `test/fixtures/*.json`, `src/__tests__/**/*.test.ts`

1. Create fixtures: `openalex-work.json`, `openalex-search.json`, `s2-paper.json`, `s2-search.json`, `papers-10.json`
2. Unit tests for every module: NLP (determinism, null abstracts), algorithms (PageRank, Louvain, scoring), sources (normalization, inverted index), storage (CRUD, upsert, migration), entities (matching), exporters (format validation), cache (TTL)
3. Integration tests: end-to-end build with fixtures (mocked HTTP) → verify DB contents; build then export each format
4. Mock strategy: `vi.mock()` on HttpClient → return fixtures, never call live APIs
5. Test DBs: in-memory SQLite (`:memory:`) or temp files

**Verify**: `npx vitest run` → exit 0, all suites pass

---

### Step 17 — Documentation + Packaging

**Files**: `README.md`, `package.json` updates, `.npmignore`

1. README: description, installation, quickstart (topic build, paper title build, export, view), command reference, schema reference (10 tables), config example, env vars, spine strategies, LLM usage, troubleshooting/FAQ
2. `package.json`: name=papergraph, version=1.0.0, bin, files=[dist/], engines≥node20, scripts (build, test, prepublishOnly)
3. `.npmignore`: exclude src/, test/, .sisyphus/, *.md except README

**Verify**: `npm pack --dry-run` succeeds, includes `dist/cli/index.js` and `README.md`

---

## Execution Order (Dependency Waves)

```
Wave 1:  Step 1                         (foundation — blocks everything)
Wave 2:  Steps 2 + 3                    (parallel — HTTP client + SQLite)
Wave 3:  Steps 4 + 5 + 6 + 7           (parallel — sources + NLP + algorithms)
Wave 4:  Steps 8 + 11                   (parallel — builder + cache)
Wave 5:  Steps 9 + 10 + 12 + 13 + 14   (parallel — spines + entities + LLM + exporters + viewer)
Wave 6:  Step 15                        (CLI — integrates everything)
Wave 7:  Steps 16 + 17                  (parallel — tests + docs)
```

**Critical path**: 1 → 2+3 → 4 → 8 → 9 → 15 → 16

---

## Guardrails (Must NOT Have)

- No VS Code extension or PDF ingestion
- No OAuth / OS keychain — env vars only
- No more than 2 LLM providers (OpenAI + Ollama)
- No LLM storyline generation — only edges + cluster naming
- No comprehensive NER — dictionary + regex + OpenAlex concepts only
- No `.papergraphrc` / YAML / TOML — `papergraph.config.json` only
- No `login`, `logout`, `doctor` commands
- No live API calls in tests
- No frontend build pipeline for viewer
- No Mermaid export > 50 nodes

---

## Definition of Done

- [ ] `papergraph build --topic "..." --out graph.db` → valid SQLite with papers/edges/runs
- [ ] `papergraph build --paper "Attention Is All You Need" --out graph.db` → resolves by title
- [ ] `papergraph export --db graph.db --format html --out graph.html` → working HTML viewer
- [ ] `npx vitest run` → all tests pass
- [ ] `npm pack --dry-run` → succeeds
