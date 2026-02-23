/**
 * Edge types supported by PaperGraph.
 *
 * Non-LLM (core, deterministic):
 *   CITES, CITED_BY, CO_CITED, BIB_COUPLED, SIMILAR_TEXT,
 *   SHARED_KEYWORDS, SAME_AUTHOR, SAME_VENUE
 *
 * LLM (enrichment, non-deterministic):
 *   EXTENDS, IMPROVES, SURVEYS, CONTRADICTS,
 *   USES_METHOD, INTRODUCES_METHOD, USES_DATASET, INTRODUCES_DATASET
 */
export enum EdgeType {
    // Core (non-LLM) edge types
    CITES = 'CITES',
    CITED_BY = 'CITED_BY',
    CO_CITED = 'CO_CITED',
    BIB_COUPLED = 'BIB_COUPLED',
    SIMILAR_TEXT = 'SIMILAR_TEXT',
    SHARED_KEYWORDS = 'SHARED_KEYWORDS',
    SAME_AUTHOR = 'SAME_AUTHOR',
    SAME_VENUE = 'SAME_VENUE',

    // LLM enrichment edge types
    EXTENDS = 'EXTENDS',
    IMPROVES = 'IMPROVES',
    SURVEYS = 'SURVEYS',
    CONTRADICTS = 'CONTRADICTS',
    USES_METHOD = 'USES_METHOD',
    INTRODUCES_METHOD = 'INTRODUCES_METHOD',
    USES_DATASET = 'USES_DATASET',
    INTRODUCES_DATASET = 'INTRODUCES_DATASET',
}

/** Edge creator type — either algorithmic or LLM-generated */
export type EdgeCreator = 'algo' | 'llm';

/**
 * Edge interface — represents a relationship between two papers.
 */
export interface Edge {
    /** Internal auto-increment ID (SQLite rowid) */
    edge_id?: number;

    /** Source paper ID (references the papers table) */
    src_paper_id: number;

    /** Destination paper ID (references the papers table) */
    dst_paper_id: number;

    /** Relationship type */
    type: EdgeType;

    /** Edge weight (0.0 to 1.0+, interpretation depends on type) */
    weight: number;

    /** Confidence score (0.0 to 1.0; deterministic edges are typically 1.0) */
    confidence: number;

    /** LLM-generated rationale for why this edge exists (nullable) */
    rationale: string | null;

    /** LLM-generated evidence snippet (nullable) */
    evidence: string | null;

    /** Who created this edge */
    created_by: EdgeCreator;

    /** Provenance metadata as JSON string (source, algorithm version, model, etc.) */
    provenance_json: string;

    /** ISO timestamp */
    created_at?: string;
}

/** Set of non-LLM (core) edge types */
export const CORE_EDGE_TYPES: ReadonlySet<EdgeType> = new Set([
    EdgeType.CITES,
    EdgeType.CITED_BY,
    EdgeType.CO_CITED,
    EdgeType.BIB_COUPLED,
    EdgeType.SIMILAR_TEXT,
    EdgeType.SHARED_KEYWORDS,
    EdgeType.SAME_AUTHOR,
    EdgeType.SAME_VENUE,
]);

/** Set of LLM edge types */
export const LLM_EDGE_TYPES: ReadonlySet<EdgeType> = new Set([
    EdgeType.EXTENDS,
    EdgeType.IMPROVES,
    EdgeType.SURVEYS,
    EdgeType.CONTRADICTS,
    EdgeType.USES_METHOD,
    EdgeType.INTRODUCES_METHOD,
    EdgeType.USES_DATASET,
    EdgeType.INTRODUCES_DATASET,
]);
