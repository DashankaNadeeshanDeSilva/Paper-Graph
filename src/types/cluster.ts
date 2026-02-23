/**
 * Cluster interface — represents a community/group of related papers.
 */
export interface Cluster {
    /** Internal auto-increment ID (SQLite rowid) */
    cluster_id?: number;

    /** Method used for clustering (e.g., 'louvain_citation', 'louvain_similarity') */
    method: string;

    /** Human-readable cluster name (heuristic or LLM-generated, nullable) */
    name: string | null;

    /** Short description of the cluster theme (nullable) */
    description: string | null;

    /** Cluster statistics as JSON string (member_count, top_papers, etc.) */
    stats_json: string;
}

/**
 * Junction table: links a paper to a cluster.
 */
export interface PaperCluster {
    paper_id: number;
    cluster_id: number;
}
