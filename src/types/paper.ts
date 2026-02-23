/**
 * Paper interface — the core data model for academic papers.
 * Normalized from any source (OpenAlex, Semantic Scholar) into this common shape.
 */
export interface Paper {
    /** Internal auto-increment ID (SQLite rowid) */
    paper_id?: number;

    /** Source adapter that provided this paper */
    source: PaperSource;

    /** Original ID from the source (e.g., OpenAlex work ID, S2 paperId) */
    source_id: string;

    /** Digital Object Identifier (without https://doi.org/ prefix) */
    doi: string | null;

    /** arXiv identifier (e.g., "2401.01234") */
    arxiv_id: string | null;

    /** Paper title */
    title: string;

    /** Full abstract text (may be null — ~22.5% missing for recent OpenAlex papers) */
    abstract: string | null;

    /** Publication year */
    year: number | null;

    /** Published venue/journal name */
    venue: string | null;

    /** URL to the paper (landing page or PDF) */
    url: string | null;

    /** Citation count from source */
    citation_count: number;

    /** Influence/impact score from source (optional) */
    influence_score: number | null;

    /** Keywords as JSON array string */
    keywords_json: string | null;

    /** Concepts/topics as JSON array string (e.g., OpenAlex concepts) */
    concepts_json: string | null;

    /** ISO timestamp of when this paper was added to the DB */
    created_at?: string;
}

export type PaperSource = 'openalex' | 's2';

/**
 * Author associated with a paper.
 */
export interface Author {
    author_id?: number;
    name: string;
    source_id: string | null;
    affiliation: string | null;
}

/**
 * Junction table: links a paper to an author with position.
 */
export interface PaperAuthor {
    paper_id: number;
    author_id: number;
    /** Author position in the author list (0-indexed) */
    position: number;
}

/**
 * Raw paper data from a source before normalization.
 * Used by source adapters during the normalization step.
 */
export interface RawPaperData {
    id: string;
    title: string;
    abstract?: string | null;
    year?: number | null;
    venue?: string | null;
    url?: string | null;
    doi?: string | null;
    arxiv_id?: string | null;
    citation_count?: number;
    influence_score?: number | null;
    keywords?: string[];
    concepts?: Array<{ name: string; score?: number }>;
    authors?: Array<{ name: string; id?: string; affiliation?: string }>;
    references?: string[];
    citations?: string[];
}
