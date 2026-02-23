# PaperGraph — Usage Guide

This document explains how to install, configure, and use PaperGraph to build research paper connectivity graphs.

---

## Table of Contents

1. [Installation](#installation)
2. [CLI Commands](#cli-commands)
3. [Configuration](#configuration)
4. [Environment Variables](#environment-variables)
5. [Workflow Examples](#workflow-examples)
6. [Export Formats](#export-formats)
7. [Troubleshooting](#troubleshooting)

---

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/Paper-Graph.git
cd Paper-Graph

# Install dependencies
npm install

# Build the CLI
npm run build

# Verify installation
node dist/index.js --help
```

### Global Installation (optional)

```bash
# Link globally so you can use `papergraph` anywhere
npm link

# Now you can run:
papergraph --help
```

---

## CLI Commands

### `papergraph build` — Build a Graph

This is the main command. It searches for papers, traverses citations, computes relationships, and stores everything in a SQLite database.

```bash
papergraph build -t "transformer attention" -o graph.db
```

#### Options

| Flag | Description | Default |
|------|------------|---------|
| `-t, --topic <topic>` | **Required.** Search topic | — |
| `-p, --paper <titles...>` | Additional paper titles to seed | — |
| `--doi <dois...>` | Seed by DOI(s) | — |
| `-s, --source <source>` | Data source: `openalex` or `s2` | `openalex` |
| `--spine <spine>` | Graph strategy (see below) | `citation` |
| `-d, --depth <n>` | Citation traversal depth | `2` |
| `-m, --max-papers <n>` | Maximum papers to collect | `200` |
| `-o, --out <path>` | Output database path | `./papergraph.db` |
| `--max-refs <n>` | Max references per paper | `20` |
| `--max-cites <n>` | Max citations per paper | `20` |
| `--year-from <year>` | Filter: only papers from this year | — |
| `--year-to <year>` | Filter: only papers up to this year | — |
| `--log-level <level>` | `debug`, `info`, `warn`, `error` | `info` |
| `--json-logs` | Machine-readable JSON logs | `false` |
| `--no-cache` | Disable response caching | — |

#### Spine Strategies

| Spine | What It Does |
|-------|-------------|
| `citation` | Only direct citation edges (A → B means A cites B) |
| `similarity` | Adds TF-IDF cosine similarity edges between abstracts |
| `co-citation` | Adds edges between papers that are frequently cited together |
| `coupling` | Adds edges between papers that cite the same references |
| `hybrid` | **All of the above** — richest graph, slower to build |

#### Examples

```bash
# Basic: topic search with OpenAlex
papergraph build -t "speech enhancement deep learning" -o speech.db

# Multiple seed papers
papergraph build -t "attention mechanisms" \
  -p "Attention Is All You Need" "BERT" \
  -o attention.db

# Hybrid spine with deeper traversal
papergraph build -t "graph neural networks" \
  --spine hybrid -d 3 -m 300 \
  -o gnn.db

# Using Semantic Scholar
papergraph build -t "diffusion models" -s s2 -o diffusion.db

# With DOI seeds
papergraph build -t "language models" \
  --doi "10.48550/arXiv.2005.14165" \
  -o lm.db

# Filter by year range
papergraph build -t "reinforcement learning" \
  --year-from 2020 --year-to 2025 \
  -o rl.db

# Debug mode (verbose logging)
papergraph build -t "transformers" --log-level debug -o debug.db
```

---

### `papergraph export` — Export Graph

Export the database to various formats for use in other tools.

```bash
papergraph export -i graph.db -f json -o graph.json
```

| Flag | Description | Default |
|------|------------|---------|
| `-i, --input <path>` | **Required.** Input database path | — |
| `-f, --format <fmt>` | **Required.** `json`, `graphml`, `gexf`, `csv`, `mermaid` | — |
| `-o, --out <path>` | Output file path | Auto-generated from input |

#### Examples

```bash
# Export all formats
papergraph export -i graph.db -f json
papergraph export -i graph.db -f graphml    # For Gephi / yEd
papergraph export -i graph.db -f gexf       # For Gephi
papergraph export -i graph.db -f csv        # For spreadsheets
papergraph export -i graph.db -f mermaid    # For GitHub/GitLab
```

---

### `papergraph view` — Generate HTML Viewer

Creates a self-contained HTML file with an interactive graph visualization.

```bash
papergraph view -i graph.db -o graph.html
```

Then open `graph.html` in any browser. The viewer includes:

- **Search** — type to filter papers by title, venue, or DOI
- **Click** a node to see paper details (year, venue, citations, DOI link)
- **Click** a node to highlight its direct connections
- **Fit** — zoom to fit all nodes
- **Re-layout** — re-run force-directed layout animation
- **Reset** — clear all highlights and filters

| Flag | Description | Default |
|------|------------|---------|
| `-i, --input <path>` | **Required.** Input database path | — |
| `-o, --out <path>` | Output HTML file | `<input>.html` |

---

### `papergraph inspect` — Show Statistics

Display a summary of what's in the database.

```bash
papergraph inspect -i graph.db
```

Output example:

```
📊 PaperGraph Database Statistics

  Papers:   142
  Edges:    387
  Clusters: 5
  Entities: 23
  Runs:     1

  Edge Types:
    CITES: 312
    SIMILAR_TEXT: 45
    CO_CITED: 18
    BIB_COUPLED: 12
```

---

### `papergraph cache` — Manage Cache

PaperGraph caches API responses to avoid redundant requests.

```bash
# Show cache stats
papergraph cache stats

# Clear all cached responses
papergraph cache clear
```

---

## Configuration

You can create a `papergraph.config.json` file in your project directory to set defaults:

```json
{
  "source": "openalex",
  "spine": "hybrid",
  "depth": 2,
  "maxPapers": 200,
  "maxRefsPerPaper": 20,
  "maxCitesPerPaper": 20,
  "logLevel": "info",
  "noCache": false,
  "similarity": {
    "topK": 10,
    "threshold": 0.25
  },
  "ranking": {
    "pagerankWeight": 0.5,
    "relevanceWeight": 0.3,
    "recencyWeight": 0.2
  }
}
```

CLI flags always override config file values.

---

## Environment Variables

| Variable | Purpose | Required |
|----------|---------|---------|
| `OPENALEX_API_KEY` | OpenAlex polite pool access (email) | No (but recommended) |
| `S2_API_KEY` | Semantic Scholar higher rate limits | No (but recommended for speed) |
| `OPENAI_API_KEY` | LLM enrichment (future feature) | No |

Set them before running:

```bash
export OPENALEX_API_KEY="your-email@example.com"
export S2_API_KEY="your-s2-key"
```

---

## Workflow Examples

### Research Survey Workflow

```bash
# 1. Build the graph
papergraph build -t "neural machine translation" --spine hybrid -d 2 -m 150 -o nmt.db

# 2. Check what you got
papergraph inspect -i nmt.db

# 3. Generate the interactive viewer
papergraph view -i nmt.db -o nmt.html

# 4. Open in browser
open nmt.html

# 5. Export for further analysis
papergraph export -i nmt.db -f json -o nmt.json
papergraph export -i nmt.db -f csv -o nmt.csv
```

### Specific Paper Exploration

```bash
# Start from known papers and explore their citation network
papergraph build -t "attention mechanisms" \
  -p "Attention Is All You Need" "BERT: Pre-training of Deep Bidirectional Transformers" \
  --spine citation -d 3 \
  -o attention-network.db

papergraph view -i attention-network.db
```

### Comparing Fields

```bash
# Build separate graphs for different fields
papergraph build -t "speech enhancement" -o speech.db
papergraph build -t "image super resolution" -o image.db

# Export both and compare in your analysis tool
papergraph export -i speech.db -f json -o speech.json
papergraph export -i image.db -f json -o image.json
```

---

## Export Formats — Detailed

### JSON
Structured output with paper metadata, edges, clusters, and entities. Best for programmatic access.

### GraphML
XML-based format supported by **Gephi**, **yEd**, **NetworkX**, and **igraph**. Includes node/edge attributes.

### GEXF
Gephi's native format. Includes all node attributes (title, year, venue, citations, influence) and edge attributes (type, weight).

### CSV
Two-section file: nodes (papers) followed by edges. Easy to import into **Excel**, **Google Sheets**, or **pandas**.

### Mermaid
Generates a `graph TD` diagram that renders directly in **GitHub**, **GitLab**, **Notion**, and other Markdown renderers. Limited to 100 edges for readability.

---

## Troubleshooting

### "No seed papers found"
- Check your topic spelling
- Try broader search terms
- Try switching source: `--source s2` or `--source openalex`

### Rate limiting / 429 errors
- The HTTP client automatically retries with backoff
- OpenAlex: set `OPENALEX_API_KEY` to your email for the polite pool (10 req/s)
- Semantic Scholar: get an API key from [semanticscholar.org](https://www.semanticscholar.org/product/api)

### Build is slow
- Reduce `--depth` (default 2, try 1)
- Reduce `--max-papers` (default 200, try 50)
- Use `citation` spine instead of `hybrid`

### Database errors
- Make sure the output directory exists
- Delete the `.db` file and rebuild if corrupted
