/**
 * PaperGraph spine strategies for graph building.
 */
export type SpineType = 'citation' | 'similarity' | 'co-citation' | 'coupling' | 'hybrid';

/**
 * Log level options.
 */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

/**
 * LLM task types that can be selectively enabled/disabled.
 */
export type LlmTask = 'edges' | 'clusters';

/**
 * LLM provider configuration.
 */
export interface LlmConfig {
    enabled: boolean;
    provider: 'openai' | 'ollama';
    model: string;
    tasks: LlmTask[];
    maxAnnotatedPapers: number;
    maxAnnotatedEdges: number;
    concurrency: number;
    budget?: number;
}

/**
 * Similarity configuration.
 */
export interface SimilarityConfig {
    enabled: boolean;
    topK: number;
    threshold: number;
}

/**
 * Clustering configuration.
 */
export interface ClusteringConfig {
    enabled: boolean;
    method: 'louvain';
}

/**
 * Ranking weight configuration (must sum to 1.0).
 */
export interface RankingConfig {
    pagerankWeight: number;
    relevanceWeight: number;
    recencyWeight: number;
}

/**
 * Full PaperGraph configuration merged from CLI flags, env vars, and config file.
 */
export interface PaperGraphConfig {
    // Input
    topic?: string;
    paper?: string[];
    paperIndex?: number;
    seedFile?: string;
    doi?: string[];
    arxiv?: string[];
    s2?: string[];
    openalex?: string[];

    // Source & graph strategy
    source: 'openalex' | 's2' | 'mixed';
    spine: SpineType;
    depth: number;
    maxPapers: number;
    maxRefsPerPaper: number;
    maxCitesPerPaper: number;
    yearFrom?: number;
    yearTo?: number;

    // Output
    out: string;

    // Cache
    cache?: string;
    noCache: boolean;
    resume: boolean;

    // Logging
    logLevel: LogLevel;
    jsonLogs: boolean;

    // Similarity
    similarity: SimilarityConfig;

    // Clustering
    clustering: ClusteringConfig;

    // Ranking
    ranking: RankingConfig;

    // LLM
    llm: LlmConfig;
}

/**
 * Default configuration values.
 */
export const DEFAULT_CONFIG: Omit<PaperGraphConfig, 'out'> = {
    source: 'openalex',
    spine: 'citation',
    depth: 2,
    maxPapers: 150,
    maxRefsPerPaper: 40,
    maxCitesPerPaper: 40,
    noCache: false,
    resume: false,
    logLevel: 'info',
    jsonLogs: false,
    similarity: {
        enabled: true,
        topK: 10,
        threshold: 0.25,
    },
    clustering: {
        enabled: true,
        method: 'louvain',
    },
    ranking: {
        pagerankWeight: 0.5,
        relevanceWeight: 0.3,
        recencyWeight: 0.2,
    },
    llm: {
        enabled: false,
        provider: 'openai',
        model: 'gpt-4.1-mini',
        tasks: ['edges', 'clusters'],
        maxAnnotatedPapers: 120,
        maxAnnotatedEdges: 400,
        concurrency: 3,
    },
};

/**
 * Run metadata stored in the SQLite `runs` table.
 */
export interface RunRecord {
    run_id?: number;
    created_at: string;
    papergraph_version: string;
    config_json: string;
    source: string;
    spine: string;
    depth: number;
    stats_json: string;
}
