import Database from 'better-sqlite3';
import type { Paper, Edge, Author, PaperAuthor, Cluster, PaperCluster, Entity, PaperEntity, RunRecord } from '../types/index.js';
import { getLogger } from '../utils/logger.js';

const logger = getLogger();

/**
 * SQLite schema migration v1.
 * Creates all 10 tables required by PaperGraph.
 */
const MIGRATION_V1 = `
-- Runs: build session metadata
CREATE TABLE IF NOT EXISTS runs (
  run_id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  papergraph_version TEXT NOT NULL,
  config_json TEXT NOT NULL,
  source TEXT NOT NULL,
  spine TEXT NOT NULL,
  depth INTEGER NOT NULL,
  stats_json TEXT NOT NULL DEFAULT '{}'
);

-- Papers: core paper nodes
CREATE TABLE IF NOT EXISTS papers (
  paper_id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  doi TEXT,
  arxiv_id TEXT,
  title TEXT NOT NULL,
  abstract TEXT,
  year INTEGER,
  venue TEXT,
  url TEXT,
  citation_count INTEGER NOT NULL DEFAULT 0,
  influence_score REAL,
  keywords_json TEXT,
  concepts_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Edges: relationships between papers
CREATE TABLE IF NOT EXISTS edges (
  edge_id INTEGER PRIMARY KEY,
  src_paper_id INTEGER NOT NULL REFERENCES papers(paper_id),
  dst_paper_id INTEGER NOT NULL REFERENCES papers(paper_id),
  type TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  confidence REAL NOT NULL DEFAULT 1.0,
  rationale TEXT,
  evidence TEXT,
  created_by TEXT NOT NULL DEFAULT 'algo',
  provenance_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Authors
CREATE TABLE IF NOT EXISTS authors (
  author_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  source_id TEXT,
  affiliation TEXT
);

-- Paper-Author junction
CREATE TABLE IF NOT EXISTS paper_authors (
  paper_id INTEGER NOT NULL REFERENCES papers(paper_id),
  author_id INTEGER NOT NULL REFERENCES authors(author_id),
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (paper_id, author_id)
);

-- Clusters: community detection results
CREATE TABLE IF NOT EXISTS clusters (
  cluster_id INTEGER PRIMARY KEY,
  method TEXT NOT NULL,
  name TEXT,
  description TEXT,
  stats_json TEXT NOT NULL DEFAULT '{}'
);

-- Paper-Cluster junction
CREATE TABLE IF NOT EXISTS paper_clusters (
  paper_id INTEGER NOT NULL REFERENCES papers(paper_id),
  cluster_id INTEGER NOT NULL REFERENCES clusters(cluster_id),
  PRIMARY KEY (paper_id, cluster_id)
);

-- Entities: extracted datasets/methods/tasks/metrics
CREATE TABLE IF NOT EXISTS entities (
  entity_id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]'
);

-- Paper-Entity junction
CREATE TABLE IF NOT EXISTS paper_entities (
  paper_id INTEGER NOT NULL REFERENCES papers(paper_id),
  entity_id INTEGER NOT NULL REFERENCES entities(entity_id),
  role TEXT NOT NULL DEFAULT 'uses',
  PRIMARY KEY (paper_id, entity_id)
);

-- Indexes for edges (fast lookup by src, dst, type)
CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(src_paper_id);
CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst_paper_id);
CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(type);

-- Indexes for papers (fast lookup by doi, arxiv, source_id, year)
CREATE INDEX IF NOT EXISTS idx_papers_doi ON papers(doi);
CREATE INDEX IF NOT EXISTS idx_papers_arxiv ON papers(arxiv_id);
CREATE INDEX IF NOT EXISTS idx_papers_source_id ON papers(source_id);
CREATE INDEX IF NOT EXISTS idx_papers_year ON papers(year);

-- Unique constraint on source + source_id to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_papers_source_unique ON papers(source, source_id);
`;

/**
 * PaperGraph database wrapper around better-sqlite3.
 * Handles schema migration, WAL mode, foreign keys, and CRUD operations.
 */
export class PaperGraphDatabase {
    private db: Database.Database;

    constructor(dbPath: string) {
        this.db = new Database(dbPath);

        // Set pragmas
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');

        // Run migrations
        this.migrate();

        logger.debug({ dbPath }, 'Database initialized');
    }

    /**
     * Run schema migrations.
     */
    private migrate(): void {
        const currentVersion = this.db.pragma('user_version', { simple: true }) as number;

        if (currentVersion < 1) {
            this.db.exec(MIGRATION_V1);
            this.db.pragma('user_version = 1');
            logger.info('Database migrated to v1');
        }
    }

    // ─── Papers ───────────────────────────────────────────────

    /**
     * Insert multiple papers in a single transaction.
     * Returns the inserted paper IDs.
     */
    insertPapers(papers: Omit<Paper, 'paper_id' | 'created_at'>[]): number[] {
        const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO papers (source, source_id, doi, arxiv_id, title, abstract, year, venue, url, citation_count, influence_score, keywords_json, concepts_json)
      VALUES (@source, @source_id, @doi, @arxiv_id, @title, @abstract, @year, @venue, @url, @citation_count, @influence_score, @keywords_json, @concepts_json)
    `);

        const ids: number[] = [];
        const insertAll = this.db.transaction((papers: Omit<Paper, 'paper_id' | 'created_at'>[]) => {
            for (const paper of papers) {
                const result = stmt.run(paper);
                if (result.changes > 0) {
                    ids.push(Number(result.lastInsertRowid));
                } else {
                    // Paper already exists, get its ID
                    const existing = this.getPaperBySourceId(paper.source, paper.source_id);
                    if (existing) ids.push(existing.paper_id!);
                }
            }
        });

        insertAll(papers);
        return ids;
    }

    /**
     * Upsert a single paper. If it already exists (by source+source_id), update it.
     */
    upsertPaper(paper: Omit<Paper, 'paper_id' | 'created_at'>): number {
        const stmt = this.db.prepare(`
      INSERT INTO papers (source, source_id, doi, arxiv_id, title, abstract, year, venue, url, citation_count, influence_score, keywords_json, concepts_json)
      VALUES (@source, @source_id, @doi, @arxiv_id, @title, @abstract, @year, @venue, @url, @citation_count, @influence_score, @keywords_json, @concepts_json)
      ON CONFLICT(source, source_id) DO UPDATE SET
        doi = COALESCE(excluded.doi, doi),
        arxiv_id = COALESCE(excluded.arxiv_id, arxiv_id),
        title = excluded.title,
        abstract = COALESCE(excluded.abstract, abstract),
        year = COALESCE(excluded.year, year),
        venue = COALESCE(excluded.venue, venue),
        url = COALESCE(excluded.url, url),
        citation_count = MAX(citation_count, excluded.citation_count),
        influence_score = COALESCE(excluded.influence_score, influence_score),
        keywords_json = COALESCE(excluded.keywords_json, keywords_json),
        concepts_json = COALESCE(excluded.concepts_json, concepts_json)
    `);

        const result = stmt.run(paper);
        if (result.changes > 0 && result.lastInsertRowid) {
            return Number(result.lastInsertRowid);
        }

        // If upsert updated, get the existing ID
        const existing = this.getPaperBySourceId(paper.source, paper.source_id);
        return existing?.paper_id ?? -1;
    }

    getPaperById(id: number): Paper | undefined {
        return this.db.prepare('SELECT * FROM papers WHERE paper_id = ?').get(id) as Paper | undefined;
    }

    getPaperByDoi(doi: string): Paper | undefined {
        return this.db.prepare('SELECT * FROM papers WHERE doi = ?').get(doi) as Paper | undefined;
    }

    getPaperBySourceId(source: string, sourceId: string): Paper | undefined {
        return this.db.prepare('SELECT * FROM papers WHERE source = ? AND source_id = ?').get(source, sourceId) as Paper | undefined;
    }

    paperExists(source: string, sourceId: string): boolean {
        const row = this.db.prepare('SELECT 1 FROM papers WHERE source = ? AND source_id = ?').get(source, sourceId);
        return row !== undefined;
    }

    getAllPapers(): Paper[] {
        return this.db.prepare('SELECT * FROM papers ORDER BY paper_id').all() as Paper[];
    }

    getPaperCount(): number {
        const row = this.db.prepare('SELECT COUNT(*) as count FROM papers').get() as { count: number };
        return row.count;
    }

    // ─── Edges ────────────────────────────────────────────────

    /**
     * Insert multiple edges in a single transaction.
     */
    insertEdges(edges: Omit<Edge, 'edge_id' | 'created_at'>[]): void {
        const stmt = this.db.prepare(`
      INSERT INTO edges (src_paper_id, dst_paper_id, type, weight, confidence, rationale, evidence, created_by, provenance_json)
      VALUES (@src_paper_id, @dst_paper_id, @type, @weight, @confidence, @rationale, @evidence, @created_by, @provenance_json)
    `);

        const insertAll = this.db.transaction((edges: Omit<Edge, 'edge_id' | 'created_at'>[]) => {
            for (const edge of edges) {
                stmt.run(edge);
            }
        });

        insertAll(edges);
    }

    getAllEdges(): Edge[] {
        return this.db.prepare('SELECT * FROM edges ORDER BY edge_id').all() as Edge[];
    }

    getEdgesByType(type: string): Edge[] {
        return this.db.prepare('SELECT * FROM edges WHERE type = ?').all(type) as Edge[];
    }

    getEdgeCount(): number {
        const row = this.db.prepare('SELECT COUNT(*) as count FROM edges').get() as { count: number };
        return row.count;
    }

    // ─── Authors ──────────────────────────────────────────────

    insertAuthors(authors: Omit<Author, 'author_id'>[], paperLinks: Array<{ authorIndex: number; paperId: number; position: number }>): void {
        const authorStmt = this.db.prepare(`
      INSERT OR IGNORE INTO authors (name, source_id, affiliation)
      VALUES (@name, @source_id, @affiliation)
    `);

        const linkStmt = this.db.prepare(`
      INSERT OR IGNORE INTO paper_authors (paper_id, author_id, position)
      VALUES (?, ?, ?)
    `);

        const insertAll = this.db.transaction(() => {
            const authorIds: number[] = [];
            for (const author of authors) {
                const result = authorStmt.run(author);
                authorIds.push(Number(result.lastInsertRowid));
            }

            for (const link of paperLinks) {
                const authorId = authorIds[link.authorIndex];
                if (authorId !== undefined) {
                    linkStmt.run(link.paperId, authorId, link.position);
                }
            }
        });

        insertAll();
    }

    // ─── Clusters ─────────────────────────────────────────────

    insertClusters(clusters: Omit<Cluster, 'cluster_id'>[], paperMappings: Map<number, number[]>): void {
        const clusterStmt = this.db.prepare(`
      INSERT INTO clusters (method, name, description, stats_json)
      VALUES (@method, @name, @description, @stats_json)
    `);

        const linkStmt = this.db.prepare(`
      INSERT OR IGNORE INTO paper_clusters (paper_id, cluster_id)
      VALUES (?, ?)
    `);

        const insertAll = this.db.transaction(() => {
            let clusterIndex = 0;
            for (const cluster of clusters) {
                const result = clusterStmt.run(cluster);
                const clusterId = Number(result.lastInsertRowid);

                const paperIds = paperMappings.get(clusterIndex) ?? [];
                for (const paperId of paperIds) {
                    linkStmt.run(paperId, clusterId);
                }
                clusterIndex++;
            }
        });

        insertAll();
    }

    getAllClusters(): Cluster[] {
        return this.db.prepare('SELECT * FROM clusters ORDER BY cluster_id').all() as Cluster[];
    }

    getClusterCount(): number {
        const row = this.db.prepare('SELECT COUNT(*) as count FROM clusters').get() as { count: number };
        return row.count;
    }

    // ─── Entities ─────────────────────────────────────────────

    insertEntities(entities: Omit<Entity, 'entity_id'>[], paperLinks: Array<{ entityIndex: number; paperId: number; role: string }>): void {
        const entityStmt = this.db.prepare(`
      INSERT OR IGNORE INTO entities (type, name, aliases_json)
      VALUES (@type, @name, @aliases_json)
    `);

        const getEntityStmt = this.db.prepare(`
      SELECT entity_id FROM entities WHERE type = ? AND name = ?
    `);

        const linkStmt = this.db.prepare(`
      INSERT OR IGNORE INTO paper_entities (paper_id, entity_id, role)
      VALUES (?, ?, ?)
    `);

        const insertAll = this.db.transaction(() => {
            const entityIds: number[] = [];
            for (const entity of entities) {
                const result = entityStmt.run(entity);
                if (result.changes > 0) {
                    entityIds.push(Number(result.lastInsertRowid));
                } else {
                    const existing = getEntityStmt.get(entity.type, entity.name) as { entity_id: number } | undefined;
                    entityIds.push(existing?.entity_id ?? -1);
                }
            }

            for (const link of paperLinks) {
                const entityId = entityIds[link.entityIndex];
                if (entityId !== undefined && entityId !== -1) {
                    linkStmt.run(link.paperId, entityId, link.role);
                }
            }
        });

        insertAll();
    }

    getAllEntities(): Entity[] {
        return this.db.prepare('SELECT * FROM entities ORDER BY entity_id').all() as Entity[];
    }

    getEntityCount(): number {
        const row = this.db.prepare('SELECT COUNT(*) as count FROM entities').get() as { count: number };
        return row.count;
    }

    // ─── Runs ─────────────────────────────────────────────────

    insertRun(run: Omit<RunRecord, 'run_id'>): number {
        const stmt = this.db.prepare(`
      INSERT INTO runs (created_at, papergraph_version, config_json, source, spine, depth, stats_json)
      VALUES (@created_at, @papergraph_version, @config_json, @source, @spine, @depth, @stats_json)
    `);
        const result = stmt.run(run);
        return Number(result.lastInsertRowid);
    }

    // ─── Stats ────────────────────────────────────────────────

    getStats(): {
        papers: number;
        edges: number;
        clusters: number;
        entities: number;
        runs: number;
        edgesByType: Record<string, number>;
    } {
        const papers = this.getPaperCount();
        const edges = this.getEdgeCount();
        const clusters = this.getClusterCount();
        const entities = this.getEntityCount();
        const runs = (this.db.prepare('SELECT COUNT(*) as count FROM runs').get() as { count: number }).count;

        const edgeTypeRows = this.db.prepare('SELECT type, COUNT(*) as count FROM edges GROUP BY type').all() as Array<{ type: string; count: number }>;
        const edgesByType: Record<string, number> = {};
        for (const row of edgeTypeRows) {
            edgesByType[row.type] = row.count;
        }

        return { papers, edges, clusters, entities, runs, edgesByType };
    }

    // ─── Score Updates ────────────────────────────────────────

    /**
     * Update influence_score for a paper by its paper_id.
     */
    updatePaperScore(paperId: number, score: number): void {
        this.db.prepare('UPDATE papers SET influence_score = ? WHERE paper_id = ?').run(score, paperId);
    }

    // ─── Utility ──────────────────────────────────────────────

    /**
     * Execute a function within a transaction.
     */
    transaction<T>(fn: () => T): T {
        return this.db.transaction(fn)();
    }

    /**
     * Close the database connection.
     */
    close(): void {
        this.db.close();
        logger.debug('Database closed');
    }

    /**
     * Get the raw better-sqlite3 instance (for advanced queries).
     */
    getRawDb(): Database.Database {
        return this.db;
    }
}
