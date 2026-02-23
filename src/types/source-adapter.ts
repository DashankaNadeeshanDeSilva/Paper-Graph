import type { Paper, RawPaperData } from './paper.js';

/**
 * Interface for data source adapters (OpenAlex, Semantic Scholar, etc.).
 * Each adapter normalizes results into the common Paper interface.
 */
export interface SourceAdapter {
    /** Human-readable source name */
    readonly name: string;

    /** Source identifier for storage */
    readonly sourceId: 'openalex' | 's2';

    /**
     * Search for papers by topic string.
     * Returns normalized Paper objects.
     */
    searchByTopic(topic: string, limit?: number): Promise<Paper[]>;

    /**
     * Search for papers by exact or near-exact title.
     * Returns candidates sorted by relevance/citation count.
     */
    searchByTitle(title: string, limit?: number): Promise<Paper[]>;

    /**
     * Fetch a single paper by its source-specific ID.
     */
    fetchPaper(id: string): Promise<Paper | null>;

    /**
     * Fetch papers that the given paper references (outgoing citations).
     * @param paperId - Source-specific paper ID
     * @param limit - Maximum number of references to fetch
     */
    fetchReferences(paperId: string, limit?: number): Promise<Paper[]>;

    /**
     * Fetch papers that cite the given paper (incoming citations).
     * @param paperId - Source-specific paper ID
     * @param limit - Maximum number of citing papers to fetch
     */
    fetchCitations(paperId: string, limit?: number): Promise<Paper[]>;

    /**
     * Normalize raw API data into a Paper object.
     */
    normalize(raw: RawPaperData): Paper;
}

/**
 * Options for source adapter initialization.
 */
export interface SourceAdapterOptions {
    /** API key (from environment variable) */
    apiKey?: string;

    /** Contact email for polite pool (OpenAlex) */
    email?: string;
}
