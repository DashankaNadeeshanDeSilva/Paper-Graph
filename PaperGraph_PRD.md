# PaperGraph PRD (Product Requirements Document)

**Product:** PaperGraph  
**Type:** NPM package + CLI with built-in HTML viewer  
**Primary Output:** SQLite database file (`.db`) + self-contained HTML visualization  
**Date:** 2026-02-11 (Updated: 2026-02-12)  
**Status:** Draft v2.0  

---

## 1. Overview

PaperGraph is an npm-installable CLI tool that creates a research-paper connectivity graph for a given topic, keywords, seed papers, or explicit paper titles. It builds a graph using citation data and classical (non-LLM) NLP similarity by default, and optionally enriches the graph using an LLM provider (API key via environment variable).

The tool produces a **portable SQLite `.db` artifact** containing paper nodes, relationship edges, clusters, extracted entities (datasets/methods/tasks), and provenance. The graph can be visualized via a **self-contained HTML viewer** (Cytoscape.js + ELK.js) with git-graph-like hierarchical layout, or exported to common graph formats (JSON/GraphML/GEXF/CSV/Mermaid).

**Key idea:** Graph first (deterministic), LLM as optional enrichment.

---

## 2. Goals and Non-Goals

### 2.1 Goals
1. **Build a research-paper graph** from a topic, keywords, seed IDs (DOI/arXiv/OpenAlex/S2), or **explicit paper titles**.
2. Support **multiple "graph spine" strategies** selectable at runtime:
   - Citation-first
   - Similarity-first
   - Co-citation
   - Bibliographic coupling
   - Hybrid
3. Allow user to control **depth**, paper limits, and expansion policies.
4. Produce a **single SQLite `.db` output** that fully represents the graph and metadata.
5. Provide **exporters** to common graph formats for visualization, including a **self-contained HTML viewer**.
6. Make **LLM optional**, pluggable, and safe:
   - No-LLM mode is fully usable
   - LLM adds semantic edges, cluster naming, and rationales
7. Provide **reproducibility** in non-LLM mode (deterministic, cacheable).
8. Include robust **provenance and auditability**, especially for LLM-enriched outputs.

### 2.2 Non-Goals
- Full-text PDF ingestion and claim extraction at scale (future scope).
- Hosting a cloud service (PaperGraph is local-first CLI; cloud may come later).
- Perfect "contradiction detection" without full-text access (best-effort heuristics/LLM).
- Replacing dedicated bibliographic managers (Zotero/Mendeley).
- VS Code extension or IDE integration (future scope).
- OAuth login or OS keychain token storage (env vars only).
- LLM storyline generation (only edge labeling + cluster naming).

---

## 3. Target Users and Use Cases

### 3.1 Primary Users
- Researchers, PhD students, and engineers doing literature reviews
- R&D teams exploring new domains quickly
- Technical writers / product researchers producing "research maps"
- AI engineers building tools on top of `.db` artifacts

### 3.2 Core Use Cases
1. **Topic mapping:** "Give me the main clusters and seminal papers in X."
2. **Paper exploration:** "Build a citation graph around this specific paper."
3. **Lineage tracing:** "How did method A evolve into method B?"
4. **Survey acceleration:** "Find surveys and how they connect to core works."
5. **Dataset/method landscape:** "Which datasets and methods dominate this topic?"
6. **Project onboarding:** "Generate a navigable knowledge graph for team members."

---

## 4. Product Experience and Key Workflows

### 4.1 Installation
- Global:
  - `npm install -g papergraph`
- One-shot:
  - `npx papergraph build ...`

### 4.2 Minimal Build (No LLM)
```bash
papergraph build \
  --topic "EEG guided target speaker extraction" \
  --source openalex \
  --spine citation \
  --depth 2 \
  --max-papers 150 \
  --out ./papergraph.db
```

### 4.3 Build from Paper Title
```bash
papergraph build \
  --paper "Attention Is All You Need" \
  --source openalex \
  --spine citation \
  --depth 2 \
  --max-papers 150 \
  --out ./papergraph.db
```

### 4.4 LLM-Enriched Build
```bash
papergraph build \
  --topic "neuro-guided target speaker extraction" \
  --source s2 \
  --spine hybrid \
  --depth 3 \
  --max-papers 250 \
  --llm openai \
  --model gpt-4.1-mini \
  --out ./papergraph.db
```

### 4.5 User-Selectable Spine
Users can choose at runtime:
- `--spine citation | similarity | co-citation | coupling | hybrid`

### 4.6 Exports
```bash
papergraph export --db ./papergraph.db --format json --out graph.json
papergraph export --db ./papergraph.db --format gexf --out graph.gexf
papergraph export --db ./papergraph.db --format html --out graph.html
```

### 4.7 View (HTML Visualization)
```bash
papergraph view --db ./papergraph.db
# Generates self-contained HTML file and opens in browser
```

---

## 5. Functional Requirements

### 5.1 Inputs
PaperGraph MUST support:
- Topic string: `--topic "..."` (search-based discovery)
- **Paper title: `--paper "..."` (repeatable)** — resolves paper by title search with disambiguation
- Seed papers (one or many):
  - `--doi 10.XXXX/...`
  - `--arxiv 2401.01234`
  - `--s2 <paperId>`
  - `--openalex W...`
  - `--seed-file seeds.txt` (one id per line)

**Paper Title Resolution:**
- Search via source adapter's title search (OpenAlex `title.search` filter preferred)
- **Auto-select**: highest-cited match, log selection to user
- **Override**: `--paper-index N` to select Nth result instead
- **Disambiguation**: exact match → near match by citation count → show top candidates

### 5.2 Data Sources (Ingestion)
PaperGraph MUST support two primary source adapters and a pluggable architecture for more.

**Primary Sources:**
- OpenAlex (works, citations, concepts) — **primary, best title search**
- Semantic Scholar (references, citations, influence) — **secondary**

**Metadata Enrichment (not a standalone source):**
- arXiv (abstracts, categories, PDF links) — has zero citation data; used to supplement OpenAlex/S2 metadata only

**Requirement:** Each source adapter MUST normalize results into a common internal `Paper` object.

**Note on abstracts:** OpenAlex abstract coverage has dropped to ~22.5% for 2022-2024 papers due to publisher restrictions. The NLP pipeline MUST handle null abstracts gracefully (title-only fallback).

### 5.3 Graph Building
PaperGraph MUST build a graph containing:
- Paper nodes (with metadata)
- Relationship edges (see 5.4)
- Clusters (community detection)
- Entities (datasets/methods/tasks)

Graph building MUST honor:
- `--depth` (neighborhood expansion)
- `--max-papers`
- `--max-refs-per-paper`
- `--max-cites-per-paper`
- `--year-from`, `--year-to` filters
- Rate limit and retry policies per source

### 5.4 Relationship Types (Edges)

#### 5.4.1 Non-LLM Edge Types (Core)
- `CITES` (direct references)
- `CITED_BY` (optional, can be derived)
- `CO_CITED` (computed)
- `BIB_COUPLED` (computed)
- `SIMILAR_TEXT` (computed)
- `SHARED_KEYWORDS` (computed)
- `SAME_AUTHOR` (optional)
- `SAME_VENUE` (optional)

Each edge MUST include:
- `src_id`, `dst_id`
- `type`
- `weight` (float)
- `confidence` (float; deterministic edges often 1.0)
- `created_by` = `algo`
- `provenance` (source + algorithm version)

#### 5.4.2 LLM Edge Types (Enrichment)
When `--llm` is enabled, PaperGraph MAY add:
- `EXTENDS`
- `IMPROVES`
- `SURVEYS`
- `CONTRADICTS`
- `USES_METHOD`
- `INTRODUCES_METHOD`
- `USES_DATASET`
- `INTRODUCES_DATASET`

LLM edges MUST include:
- `rationale` (short)
- `evidence` (text span or extracted snippet)
- `confidence` (0..1)
- `created_by` = `llm`
- `model`, `provider`, timestamp

### 5.5 Ranking and Scoring
PaperGraph MUST compute per-paper scores:
- citation count (from sources)
- relevance score (TF-IDF similarity to topic)
- centrality score (PageRank on citation graph)
- recency score (optional)
- overall score (weighted combination)

The scoring strategy MUST be configurable via config file or CLI flags.

### 5.6 Clustering
PaperGraph MUST support community detection using Louvain algorithm.

**Critical implementation note:** Citation graphs are directed; Louvain requires undirected graphs. MUST convert directed → undirected before running Louvain.

Clusters MUST include:
- cluster id
- member count
- optional label + description
- method used (e.g., `louvain_citation`)

In LLM mode, clusters MAY be named using the LLM; otherwise use heuristics:
- top TF-IDF terms from cluster members' titles
- top concept tags from OpenAlex

### 5.7 Classical NLP Similarity (No LLM)
PaperGraph MUST support similarity edges using:
- TF-IDF on titles + abstracts (default)
- Title-only fallback when abstract is null (log warning with percentage)

Similarity pipeline MUST be deterministic:
- fixed tokenization and preprocessing
- no stemming (adds library dependency)
- hardcoded English stopword list
- reproducible seed behavior

### 5.8 Entity Extraction (No LLM)
PaperGraph SHOULD extract entities without LLM using:
- Curated dictionaries (~100-200 entries) + regex patterns
- OpenAlex concepts fallback (map `concepts_json` to task entities)

Entities:
- datasets (e.g., LibriSpeech, WSJ0-2mix, ImageNet, MNIST)
- methods/models (Conv-TasNet, DPRNN, Transformer, BERT, GPT)
- tasks (speech separation, classification, NER)
- metrics (accuracy, F1, BLEU, WER)

### 5.9 Storage (SQLite Output)
PaperGraph MUST create a SQLite `.db` containing ALL of:
- papers
- edges
- runs
- authors + paper_authors
- clusters + paper_clusters
- entities + paper_entities

All 10 tables MUST be created in a single migration at database initialization.

**Required pragmas:**
- `PRAGMA journal_mode = WAL`
- `PRAGMA foreign_keys = ON`
- Schema version via `PRAGMA user_version`

### 5.10 Exporters
PaperGraph MUST export graph to:
- JSON (Cytoscape-compatible)
- GraphML
- GEXF
- CSVs (papers.csv, edges.csv)
- **HTML (self-contained viewer with Cytoscape.js + ELK.js)**
- Mermaid (for small tree views; **hard cap at 50 nodes**)

### 5.11 Caching and Offline Re-runs
PaperGraph MUST cache:
- API results (by query and paper id)

Cache location:
- `~/.cache/papergraph/` (Linux/macOS)
- `%LOCALAPPDATA%\papergraph\cache` (Windows)

Cache implementation:
- File-based JSON with SHA-256 keyed filenames
- Default TTL: 7 days (configurable)
- `--no-cache` flag MUST be available

LLM responses MUST NOT be cached.

### 5.12 Configuration
PaperGraph MUST support:
- CLI flags
- Config file: `papergraph.config.json` only
- Environment variables for secrets (API keys)

Order of precedence:
1. CLI flags
2. environment variables
3. config file defaults

---

## 6. Non-Functional Requirements

### 6.1 Performance
- Must handle graphs of 50–2,000 papers locally.
- Provide streaming progress logs (no time estimates required).
- Keep memory usage bounded (batch processing).

### 6.2 Reliability
- Robust retry/backoff for external APIs (exponential backoff with jitter, max 3 retries).
- Partial failures should not corrupt `.db` (use transactions; bulk inserts via `db.transaction()`).
- Minimal resume support: `--resume` skips re-fetching papers already in DB.

### 6.3 Security and Privacy
- Never write API keys to disk in plaintext.
- API keys provided via environment variables only:
  - `OPENALEX_API_KEY`
  - `S2_API_KEY`
  - `OPENAI_API_KEY`
- LLM prompts must not include user secrets.

### 6.4 Reproducibility
- Non-LLM mode must be deterministic given same inputs and API data.
- Record run config + version info into DB (`runs` table).

### 6.5 Cross-Platform
- Windows/macOS/Linux support.
- Note: `better-sqlite3` is a native addon requiring prebuilt binaries. ~5% of users (Alpine Linux, exotic Node versions) may need `node-gyp` compilation. Document system requirements.

---

## 7. CLI Specification

### 7.1 Commands
- `papergraph build` — Build a graph DB
- `papergraph export` — Export from DB to formats
- `papergraph inspect` — Quick stats and summaries
- `papergraph view` — Generate HTML viewer and open in browser
- `papergraph cache clear` — Clear cache

### 7.2 Key Flags (build)
- `--topic <string>`
- `--paper <title>` (repeatable) — **NEW: search by paper title**
- `--paper-index <int>` — **NEW: select Nth title search result**
- `--seed-file <path>`
- `--doi <doi>` (repeatable)
- `--arxiv <id>` (repeatable)
- `--source <openalex|s2|mixed>`
- `--spine <citation|similarity|co-citation|coupling|hybrid>`
- `--depth <int>`
- `--max-papers <int>`
- `--max-refs-per-paper <int>`
- `--max-cites-per-paper <int>`
- `--year-from <int>`
- `--year-to <int>`
- `--out <path>`
- `--cache <path>` (optional)
- `--no-cache`
- `--resume`
- `--json-logs`
- `--log-level <error|warn|info|debug>`

### 7.3 LLM Flags (optional)
- `--llm <openai|ollama>`
- `--model <string>`
- `--llm-tasks <edges,clusters>`
- `--llm-budget <tokens|cost>` (optional cap)
- `--llm-concurrency <int>`
- `--llm-disable` (explicit no-LLM)

---

## 8. System Architecture

### 8.1 High-Level Modules
1. **CLI Layer**
   - parse args (commander), config merging (cosmiconfig)
   - progress reporting (pino)
2. **Source Adapters**
   - OpenAlex, Semantic Scholar
   - normalize to internal models
3. **Graph Builder**
   - expansion, filtering, spine logic, paper title resolution
4. **NLP & Similarity**
   - TF-IDF (custom, deterministic)
5. **Graph Algorithms**
   - PageRank, Louvain communities, co-citation, coupling, scoring
6. **LLM Enrichment (optional)**
   - OpenAI + Ollama adapters, task orchestrator
7. **Storage**
   - SQLite schema + migrations (better-sqlite3)
8. **Exporters**
   - JSON/GraphML/GEXF/CSV/Mermaid
9. **Cache**
   - File-based response cache with TTL
10. **HTML Viewer**
    - Self-contained HTML generator (Cytoscape.js + ELK.js)

### 8.2 Data Flow (Build)
1. Parse input (topic/seeds/**paper title**) → normalized seed set
2. **If paper title**: resolve via title search + disambiguation
3. Search and fetch seeds via sources
4. Expand neighborhood by depth and constraints (BFS expansion)
5. Build base edges (citation + computed)
6. Compute scoring (PageRank + TF-IDF relevance + recency) + clustering (Louvain)
7. Extract entities (dictionary + regex + OpenAlex concepts)
8. Optional LLM enrichment (edges/labels)
9. Write results into SQLite (transaction)
10. Print summary stats + next steps

---

## 9. Data Model (SQLite Schema)

### 9.1 Required Tables (ALL created at initialization)
- `papers`
- `edges`
- `runs`
- `authors`
- `paper_authors`
- `clusters`
- `paper_clusters`
- `entities`
- `paper_entities`

### 9.2 Table Definitions

#### `runs`
- `run_id` (INTEGER PRIMARY KEY)
- `created_at`
- `papergraph_version`
- `config_json` (full run config snapshot)
- `source` (primary source)
- `spine`
- `depth`
- `stats_json` (counts, timings)

#### `papers`
- `paper_id` (INTEGER PRIMARY KEY)
- `source` (openalex|s2)
- `source_id` (original id)
- `doi`
- `arxiv_id`
- `title`
- `abstract`
- `year`
- `venue`
- `url`
- `citation_count`
- `influence_score` (optional)
- `keywords_json` (optional)
- `concepts_json` (optional)
- `created_at`

#### `edges`
- `edge_id` (INTEGER PRIMARY KEY)
- `src_paper_id`
- `dst_paper_id`
- `type`
- `weight`
- `confidence`
- `rationale` (nullable)
- `evidence` (nullable)
- `created_by` (`algo`|`llm`)
- `provenance_json`
- `created_at`

#### `authors`
- `author_id` (INTEGER PRIMARY KEY)
- `name`
- `source_id`
- `affiliation`

#### `paper_authors`
- `paper_id`
- `author_id`
- `position`

#### `clusters`
- `cluster_id` (INTEGER PRIMARY KEY)
- `method`
- `name` (nullable)
- `description` (nullable)
- `stats_json`

#### `paper_clusters`
- `paper_id`
- `cluster_id`

#### `entities`
- `entity_id` (INTEGER PRIMARY KEY)
- `type` (`dataset`|`method`|`task`|`metric`)
- `name`
- `aliases_json`

#### `paper_entities`
- `paper_id`
- `entity_id`
- `role` (`uses`|`introduces`|`benchmarks`)

**Indexes** (must-have):
- edges: `(src_paper_id)`, `(dst_paper_id)`, `(type)`
- papers: `(doi)`, `(arxiv_id)`, `(source_id)`, `(year)`

---

## 10. Spine Implementations (Detailed)

### 10.1 Citation Spine
- Expand by `references` and/or `citations`
- Build `CITES` edges
- Filter self-citations (A→A)
- Ranking uses PageRank on `CITES` graph

### 10.2 Similarity Spine
- Build TF-IDF vectors for title+abstract (title-only fallback for null abstracts)
- Connect each paper to top-N nearest neighbors above threshold
- Create `SIMILAR_TEXT` edges with cosine similarity weights

### 10.3 Co-Citation
- For each paper, consider its outgoing references
- Count co-occurrence pairs
- Add `CO_CITED` edges between referenced papers with count-based weight

### 10.4 Bibliographic Coupling
- For two papers A and B, compute overlap of references
- Weight = overlap size / min(|refsA|,|refsB|)

### 10.5 Hybrid
- Normalize weights from multiple edge sources to [0, 1]
- Combine using weighted sum and cap degree per node (configurable, default 20)

---

## 11. LLM Enrichment (Optional)

### 11.1 Provider Abstraction
Interface:
- `complete(prompt, params) -> text/json`
- `supportsStructuredOutput` (true/false)
- `rateLimitHints`

**Supported providers (initial release):**
- OpenAI (cloud, API key via `OPENAI_API_KEY`)
- Ollama (local, no API key needed)

### 11.2 LLM Tasks
1. **Semantic edge labeling** (pairwise or neighborhood-based)
2. **Cluster naming & descriptions**

### 11.3 Guardrails
- Always store:
  - prompt template version
  - model/provider
  - confidence score
  - evidence snippet (must be present when possible)
- Enforce budgets:
  - max papers to annotate (default 120)
  - max edges to label (default 400)
  - concurrency limits
- Allow users to disable any LLM task selectively via `--llm-tasks`

---

## 12. Error Handling and Observability

### 12.1 Logging
- log levels: `error|warn|info|debug`
- `--json-logs` flag for CI usage
- Structured logging via pino

### 12.2 Progress Reporting
- display counts: fetched papers, built edges, clusters
- show rate limit waits clearly
- log API credit usage at build completion

### 12.3 Failure Modes
- API rate limit: exponential backoff + resume
- missing abstracts: skip similarity or rely on title-only (log percentage with warning)
- incomplete citation data: fallback to other sources (in `mixed` mode)
- Self-citations: filter from edges (A→A)
- Disconnected components: handle gracefully, don't crash

---

## 13. Testing Requirements

### 13.1 Unit Tests
- source adapter parsing and normalization
- inverted index abstract reconstruction
- graph scoring functions
- similarity computations (determinism)
- edge building correctness
- sqlite migrations and CRUD
- entity extraction (dictionary matching)
- cache operations

### 13.2 Integration Tests
- end-to-end build with fixture data (mocked HTTP, no live API calls)
- db schema verification + export verification
- caching behavior

### 13.3 Regression Tests
- fixed fixture topics/seeds
- check deterministic outputs (non-LLM)

**Mocking Strategy:** Use Vitest `vi.mock()` to mock HttpClient. Return JSON fixture data. No live API calls in any test.

---

## 14. Packaging and Distribution

### 14.1 NPM Package Layout
- TypeScript source compiled to `dist/` via tsup
- Provide binary entry in `package.json`:

```json
{
  "bin": {
    "papergraph": "dist/cli/index.js"
  },
  "engines": {
    "node": ">=20"
  }
}
```

### 14.2 Dependencies
- CLI: `commander`
- HTTP: `undici`
- SQLite: `better-sqlite3`
- Graph: `graphology` (+ `graphology-metrics`, `graphology-communities-louvain`, `graphology-operators`)
- NLP: custom TF-IDF (no external library)
- Config: `cosmiconfig`
- Logging: `pino`
- Build: `tsup`
- Test: `vitest`

**Note:** `better-sqlite3` is a native addon. Prebuilds cover most platforms. Document fallback compilation requirements.

### 14.3 HTML Viewer Dependencies (CDN-loaded at runtime)
- Cytoscape.js (~170KB) — graph rendering
- ELK.js (~500KB) — layered/hierarchical layout algorithm
- cytoscape-elk — bridge between the two

---

## 15. Scope (Single Release)

All features ship in a single release (v1.0.0). No phased versioning.

**Included:**
- Two source adapters (OpenAlex + Semantic Scholar)
- All five spine strategies
- Full SQLite schema (10 tables)
- Clustering (Louvain) + ranking (PageRank + TF-IDF + recency)
- Entity extraction (dictionary + regex + OpenAlex concepts)
- Caching + minimal resume
- All exporters (JSON/GraphML/GEXF/CSV/Mermaid/HTML)
- Self-contained HTML viewer (Cytoscape.js + ELK.js)
- LLM enrichment (OpenAI + Ollama; edges + cluster naming)
- Paper title input with disambiguation

**Excluded (future scope):**
- VS Code extension
- Full-text PDF ingestion pipeline
- OAuth / OS keychain token storage
- Anthropic / Together / Azure LLM providers
- LLM storyline generation
- Leiden community detection
- Comprehensive NER (beyond dictionaries)

---

## 16. Acceptance Criteria (Definition of Done)

A build is "done" when:
1. Running `papergraph build --topic "..."` creates a valid SQLite `.db`.
2. Running `papergraph build --paper "..."` resolves paper by title and builds graph.
3. DB contains all 10 tables with correct indexes.
4. Graph respects user constraints (`depth`, limits, years).
5. Exports succeed for all 6 formats (JSON, GraphML, GEXF, CSV, Mermaid, HTML).
6. HTML viewer renders graph with pan/zoom/click-for-details in browser.
7. Non-LLM runs are deterministic for fixed inputs (within API variability).
8. LLM mode (if enabled):
   - adds semantic edges with evidence + rationale
   - stores provider/model metadata
9. `npx vitest run` passes all tests.
10. `npm pack --dry-run` succeeds.

---

## 17. Appendix A — Suggested Default Config

```json
{
  "source": "openalex",
  "spine": "citation",
  "depth": 2,
  "maxPapers": 150,
  "maxRefsPerPaper": 40,
  "maxCitesPerPaper": 40,
  "similarity": {
    "enabled": true,
    "topK": 10,
    "threshold": 0.25
  },
  "clustering": {
    "enabled": true,
    "method": "louvain"
  },
  "ranking": {
    "pagerankWeight": 0.5,
    "relevanceWeight": 0.3,
    "recencyWeight": 0.2
  },
  "llm": {
    "enabled": false,
    "provider": "openai",
    "model": "gpt-4.1-mini",
    "tasks": ["edges", "clusters"],
    "maxAnnotatedPapers": 120,
    "maxAnnotatedEdges": 400
  }
}
```

---

## 18. Appendix B — Documentation Deliverables

Project MUST ship:
- README with quickstart and examples (topic build, paper title build, export, view)
- Command reference (all 5 commands with all flags)
- Schema reference (10 tables with column descriptions)
- Configuration file reference
- Troubleshooting / FAQ (better-sqlite3 install, rate limits, missing abstracts)

---

**End of PRD**
