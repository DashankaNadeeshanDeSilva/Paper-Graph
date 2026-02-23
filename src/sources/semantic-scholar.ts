import type { Paper, SourceAdapter, SourceAdapterOptions } from '../types/index.js';
import { getHttpClient, type HttpClient } from '../utils/http-client.js';
import { getLogger } from '../utils/logger.js';
import { stripDoiPrefix, extractArxivId } from './utils.js';

const logger = getLogger();

const S2_BASE = 'https://api.semanticscholar.org/graph/v1';

/** Fields to request from S2 API */
const PAPER_FIELDS = [
    'paperId', 'externalIds', 'title', 'abstract', 'year', 'venue',
    'citationCount', 'influentialCitationCount', 'isOpenAccess',
    'fieldsOfStudy', 'authors', 'url',
].join(',');

const REFERENCE_FIELDS = [
    'paperId', 'externalIds', 'title', 'abstract', 'year', 'venue',
    'citationCount', 'influentialCitationCount', 'url', 'authors',
].join(',');

/**
 * Semantic Scholar API response types.
 */
interface S2Paper {
    paperId: string;
    externalIds?: {
        DOI?: string;
        ArXiv?: string;
        MAG?: string;
        CorpusId?: number;
    };
    title?: string;
    abstract?: string | null;
    year?: number | null;
    venue?: string;
    citationCount?: number;
    influentialCitationCount?: number;
    isOpenAccess?: boolean;
    fieldsOfStudy?: string[];
    authors?: Array<{
        authorId?: string;
        name?: string;
    }>;
    url?: string;
}

interface S2SearchResponse {
    total: number;
    offset: number;
    data: S2Paper[];
    next?: number;
    token?: string;
}

interface S2ReferencesResponse {
    offset: number;
    data: Array<{
        citedPaper: S2Paper;
    }>;
    next?: number;
}

interface S2CitationsResponse {
    offset: number;
    data: Array<{
        citingPaper: S2Paper;
    }>;
    next?: number;
}

/**
 * Semantic Scholar source adapter.
 * Secondary source with good citation data and batch API.
 *
 * @see https://api.semanticscholar.org/
 */
export class SemanticScholarAdapter implements SourceAdapter {
    readonly name = 'Semantic Scholar';
    readonly sourceId = 's2' as const;
    private httpClient: HttpClient;
    private apiKey?: string;

    constructor(options?: SourceAdapterOptions) {
        this.apiKey = options?.apiKey ?? process.env['S2_API_KEY'];
        this.httpClient = getHttpClient();
    }

    /**
     * For dependency injection in tests.
     */
    setHttpClient(client: HttpClient): void {
        this.httpClient = client;
    }

    async searchByTopic(topic: string, limit = 25): Promise<Paper[]> {
        const cleanedQuery = this.cleanSearchQuery(topic);
        const params = new URLSearchParams({
            query: cleanedQuery,
            limit: String(Math.min(limit, 100)),
            fields: PAPER_FIELDS,
        });

        const url = `${S2_BASE}/paper/search?${params.toString()}`;
        logger.debug({ url }, 'S2 topic search');

        const response = await this.httpClient.get<S2SearchResponse>(url, {
            source: 's2',
            headers: this.buildHeaders(),
        });

        return (response.data.data ?? []).map((paper) => this.normalizeS2Paper(paper));
    }

    async searchByTitle(title: string, limit = 10): Promise<Paper[]> {
        const cleanedQuery = this.cleanSearchQuery(title);
        const params = new URLSearchParams({
            query: cleanedQuery,
            limit: String(Math.min(limit, 100)),
            fields: PAPER_FIELDS,
        });

        const url = `${S2_BASE}/paper/search?${params.toString()}`;
        logger.debug({ url }, 'S2 title search');

        const response = await this.httpClient.get<S2SearchResponse>(url, {
            source: 's2',
            headers: this.buildHeaders(),
        });

        return (response.data.data ?? []).map((paper) => this.normalizeS2Paper(paper));
    }

    async fetchPaper(id: string): Promise<Paper | null> {
        const url = `${S2_BASE}/paper/${encodeURIComponent(id)}?fields=${PAPER_FIELDS}`;
        logger.debug({ url }, 'S2 fetch paper');

        try {
            const response = await this.httpClient.get<S2Paper>(url, {
                source: 's2',
                headers: this.buildHeaders(),
            });
            return this.normalizeS2Paper(response.data);
        } catch (error) {
            logger.warn({ id, error }, 'Failed to fetch paper from S2');
            return null;
        }
    }

    async fetchReferences(paperId: string, limit = 40): Promise<Paper[]> {
        const params = new URLSearchParams({
            fields: REFERENCE_FIELDS,
            limit: String(Math.min(limit, 1000)),
        });

        const url = `${S2_BASE}/paper/${encodeURIComponent(paperId)}/references?${params.toString()}`;
        logger.debug({ url }, 'S2 fetch references');

        try {
            const response = await this.httpClient.get<S2ReferencesResponse>(url, {
                source: 's2',
                headers: this.buildHeaders(),
            });
            return (response.data.data ?? [])
                .map((ref) => ref.citedPaper)
                .filter((p) => p.paperId && p.title)
                .map((paper) => this.normalizeS2Paper(paper));
        } catch (error) {
            logger.warn({ paperId, error }, 'Failed to fetch references from S2');
            return [];
        }
    }

    async fetchCitations(paperId: string, limit = 40): Promise<Paper[]> {
        const params = new URLSearchParams({
            fields: REFERENCE_FIELDS,
            limit: String(Math.min(limit, 1000)),
        });

        const url = `${S2_BASE}/paper/${encodeURIComponent(paperId)}/citations?${params.toString()}`;
        logger.debug({ url }, 'S2 fetch citations');

        try {
            const response = await this.httpClient.get<S2CitationsResponse>(url, {
                source: 's2',
                headers: this.buildHeaders(),
            });
            return (response.data.data ?? [])
                .map((cite) => cite.citingPaper)
                .filter((p) => p.paperId && p.title)
                .map((paper) => this.normalizeS2Paper(paper));
        } catch (error) {
            logger.warn({ paperId, error }, 'Failed to fetch citations from S2');
            return [];
        }
    }

    /**
     * Batch fetch papers by IDs.
     * S2 supports up to 500 papers per batch request.
     */
    async batchFetchPapers(ids: string[]): Promise<Paper[]> {
        if (ids.length === 0) return [];

        const batchSize = 500;
        const papers: Paper[] = [];

        for (let i = 0; i < ids.length; i += batchSize) {
            const batch = ids.slice(i, i + batchSize);

            const url = `${S2_BASE}/paper/batch?fields=${PAPER_FIELDS}`;
            logger.debug({ batchSize: batch.length, batchIndex: i / batchSize }, 'S2 batch fetch');

            try {
                const response = await this.httpClient.post<S2Paper[]>(
                    url,
                    { ids: batch },
                    { source: 's2', headers: this.buildHeaders() }
                );

                const batchPapers = (response.data ?? [])
                    .filter((p) => p && p.paperId && p.title)
                    .map((paper) => this.normalizeS2Paper(paper));

                papers.push(...batchPapers);
            } catch (error) {
                logger.warn({ error, batchIndex: i / batchSize }, 'Failed batch fetch from S2');
            }
        }

        return papers;
    }

    normalize(raw: { id: string; title: string }): Paper {
        return this.normalizeS2Paper(raw as unknown as S2Paper);
    }

    // ─── Private helpers ──────────────────────────────────────

    private normalizeS2Paper(paper: S2Paper): Paper {
        const doi = stripDoiPrefix(paper.externalIds?.DOI ?? null);
        const arxivId = extractArxivId(paper.externalIds?.ArXiv ?? null);

        return {
            source: 's2',
            source_id: paper.paperId,
            doi,
            arxiv_id: arxivId,
            title: paper.title ?? 'Untitled',
            abstract: paper.abstract ?? null,
            year: paper.year ?? null,
            venue: paper.venue || null,
            url: paper.url ?? (doi ? `https://doi.org/${doi}` : null),
            citation_count: paper.citationCount ?? 0,
            influence_score: paper.influentialCitationCount ?? null,
            keywords_json: paper.fieldsOfStudy
                ? JSON.stringify(paper.fieldsOfStudy)
                : null,
            concepts_json: null,
        };
    }

    /**
     * Clean search query — S2 treats hyphens and plus signs as operators.
     */
    private cleanSearchQuery(query: string): string {
        return query
            .replace(/[-+]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private buildHeaders(): Record<string, string> {
        const headers: Record<string, string> = {};
        if (this.apiKey) {
            headers['x-api-key'] = this.apiKey;
        }
        return headers;
    }
}
