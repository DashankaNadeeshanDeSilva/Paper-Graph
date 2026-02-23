import type { Paper, SourceAdapter, SourceAdapterOptions } from '../types/index.js';
import { getHttpClient, type HttpClient } from '../utils/http-client.js';
import { getLogger } from '../utils/logger.js';
import { invertedIndexToText, stripDoiPrefix, extractArxivId } from './utils.js';

const logger = getLogger();

const OPENALEX_BASE = 'https://api.openalex.org';

/**
 * OpenAlex API response types (subset of relevant fields).
 */
interface OpenAlexWork {
    id: string;
    doi?: string | null;
    title?: string;
    display_name?: string;
    publication_year?: number;
    abstract_inverted_index?: Record<string, number[]> | null;
    primary_location?: {
        source?: { display_name?: string };
        landing_page_url?: string;
    };
    cited_by_count?: number;
    authorships?: Array<{
        author?: { id?: string; display_name?: string };
        institutions?: Array<{ display_name?: string }>;
        author_position?: string;
    }>;
    concepts?: Array<{ display_name?: string; score?: number; level?: number }>;
    keywords?: Array<{ keyword?: string; score?: number }>;
    ids?: {
        openalex?: string;
        doi?: string;
        pmid?: string;
    };
    referenced_works?: string[];
    related_works?: string[];
}

interface OpenAlexSearchResponse {
    meta: { count: number; per_page: number; page: number };
    results: OpenAlexWork[];
}

/**
 * OpenAlex source adapter.
 * Primary source with best title search capabilities.
 *
 * @see https://docs.openalex.org/
 */
export class OpenAlexAdapter implements SourceAdapter {
    readonly name = 'OpenAlex';
    readonly sourceId = 'openalex' as const;
    private httpClient: HttpClient;
    private apiKey?: string;
    private email?: string;

    constructor(options?: SourceAdapterOptions) {
        this.apiKey = options?.apiKey ?? process.env['OPENALEX_API_KEY'];
        this.email = options?.email;
        this.httpClient = getHttpClient();
    }

    /**
     * For dependency injection in tests.
     */
    setHttpClient(client: HttpClient): void {
        this.httpClient = client;
    }

    async searchByTopic(topic: string, limit = 25): Promise<Paper[]> {
        const params = new URLSearchParams({
            search: topic,
            per_page: String(Math.min(limit, 200)),
            sort: 'cited_by_count:desc',
        });

        this.addAuthParams(params);

        const url = `${OPENALEX_BASE}/works?${params.toString()}`;
        logger.debug({ url }, 'OpenAlex topic search');

        const response = await this.httpClient.get<OpenAlexSearchResponse>(url, { source: 'openalex' });
        return response.data.results.map((work) => this.normalizeWork(work));
    }

    async searchByTitle(title: string, limit = 10): Promise<Paper[]> {
        // Try exact title search first using filter
        const exactParams = new URLSearchParams({
            'filter': `title.search:${title}`,
            'per_page': String(Math.min(limit, 200)),
            'sort': 'cited_by_count:desc',
        });

        this.addAuthParams(exactParams);

        const exactUrl = `${OPENALEX_BASE}/works?${exactParams.toString()}`;
        logger.debug({ url: exactUrl }, 'OpenAlex title search (exact)');

        const exactResponse = await this.httpClient.get<OpenAlexSearchResponse>(exactUrl, { source: 'openalex' });

        if (exactResponse.data.results.length > 0) {
            return exactResponse.data.results.map((work) => this.normalizeWork(work));
        }

        // Fallback to general search
        const fallbackParams = new URLSearchParams({
            search: title,
            per_page: String(Math.min(limit, 200)),
            sort: 'cited_by_count:desc',
        });

        this.addAuthParams(fallbackParams);

        const fallbackUrl = `${OPENALEX_BASE}/works?${fallbackParams.toString()}`;
        logger.debug({ url: fallbackUrl }, 'OpenAlex title search (fallback)');

        const fallbackResponse = await this.httpClient.get<OpenAlexSearchResponse>(fallbackUrl, { source: 'openalex' });
        return fallbackResponse.data.results.map((work) => this.normalizeWork(work));
    }

    async fetchPaper(id: string): Promise<Paper | null> {
        // Normalize OpenAlex ID
        const normalizedId = id.startsWith('https://openalex.org/')
            ? id
            : `https://openalex.org/${id}`;

        const params = new URLSearchParams();
        this.addAuthParams(params);

        const url = `${OPENALEX_BASE}/works/${encodeURIComponent(normalizedId)}?${params.toString()}`;
        logger.debug({ url }, 'OpenAlex fetch paper');

        try {
            const response = await this.httpClient.get<OpenAlexWork>(url, { source: 'openalex' });
            return this.normalizeWork(response.data);
        } catch (error) {
            logger.warn({ id, error }, 'Failed to fetch paper from OpenAlex');
            return null;
        }
    }

    async fetchReferences(paperId: string, limit = 40): Promise<Paper[]> {
        // First, get the paper to find its referenced_works
        const paper = await this.fetchFullWork(paperId);
        if (!paper?.referenced_works?.length) {
            logger.debug({ paperId }, 'No references found');
            return [];
        }

        // Fetch referenced works in batches using filter
        const refIds = paper.referenced_works.slice(0, limit);
        return this.fetchWorksByIds(refIds);
    }

    async fetchCitations(paperId: string, limit = 40): Promise<Paper[]> {
        const normalizedId = paperId.startsWith('https://openalex.org/')
            ? paperId
            : `https://openalex.org/${paperId}`;

        const params = new URLSearchParams({
            'filter': `cites:${normalizedId}`,
            'per_page': String(Math.min(limit, 200)),
            'sort': 'cited_by_count:desc',
        });

        this.addAuthParams(params);

        const url = `${OPENALEX_BASE}/works?${params.toString()}`;
        logger.debug({ url }, 'OpenAlex fetch citations');

        const response = await this.httpClient.get<OpenAlexSearchResponse>(url, { source: 'openalex' });
        return response.data.results.map((work) => this.normalizeWork(work));
    }

    normalize(raw: { id: string; title: string }): Paper {
        return this.normalizeWork(raw as OpenAlexWork);
    }

    // ─── Private helpers ──────────────────────────────────────

    private async fetchFullWork(id: string): Promise<OpenAlexWork | null> {
        const normalizedId = id.startsWith('https://openalex.org/')
            ? id
            : `https://openalex.org/${id}`;

        const params = new URLSearchParams();
        this.addAuthParams(params);

        const url = `${OPENALEX_BASE}/works/${encodeURIComponent(normalizedId)}?${params.toString()}`;

        try {
            const response = await this.httpClient.get<OpenAlexWork>(url, { source: 'openalex' });
            return response.data;
        } catch {
            return null;
        }
    }

    private async fetchWorksByIds(ids: string[]): Promise<Paper[]> {
        if (ids.length === 0) return [];

        // OpenAlex supports pipe-separated filter for multiple IDs
        // Split into batches of 50 (API URL length limits)
        const batchSize = 50;
        const papers: Paper[] = [];

        for (let i = 0; i < ids.length; i += batchSize) {
            const batch = ids.slice(i, i + batchSize);
            const filter = batch
                .map((id) => id.replace('https://openalex.org/', ''))
                .join('|');

            const params = new URLSearchParams({
                'filter': `openalex:${filter}`,
                'per_page': String(batchSize),
            });

            this.addAuthParams(params);

            const url = `${OPENALEX_BASE}/works?${params.toString()}`;

            try {
                const response = await this.httpClient.get<OpenAlexSearchResponse>(url, { source: 'openalex' });
                papers.push(...response.data.results.map((work) => this.normalizeWork(work)));
            } catch (error) {
                logger.warn({ error, batchIndex: i }, 'Failed to fetch batch of works');
            }
        }

        return papers;
    }

    private normalizeWork(work: OpenAlexWork): Paper {
        const openalexId = work.id?.replace('https://openalex.org/', '') ?? '';
        const doi = stripDoiPrefix(work.doi);
        const abstract = invertedIndexToText(work.abstract_inverted_index);

        // Extract arXiv ID from identifiers or DOI
        let arxivId: string | null = null;
        if (doi?.includes('arxiv')) {
            arxivId = extractArxivId(doi);
        }

        // Build keywords from OpenAlex keywords field
        const keywords = work.keywords
            ?.map((k) => k.keyword)
            .filter((k): k is string => !!k) ?? [];

        // Build concepts from OpenAlex concepts field (level 0-2 only)
        const concepts = work.concepts
            ?.filter((c) => (c.level ?? 0) <= 2)
            .map((c) => ({ name: c.display_name ?? '', score: c.score }))
            .filter((c) => c.name) ?? [];

        return {
            source: 'openalex',
            source_id: openalexId,
            doi,
            arxiv_id: arxivId,
            title: work.display_name ?? work.title ?? 'Untitled',
            abstract,
            year: work.publication_year ?? null,
            venue: work.primary_location?.source?.display_name ?? null,
            url: work.primary_location?.landing_page_url ?? (doi ? `https://doi.org/${doi}` : null),
            citation_count: work.cited_by_count ?? 0,
            influence_score: null,
            keywords_json: keywords.length > 0 ? JSON.stringify(keywords) : null,
            concepts_json: concepts.length > 0 ? JSON.stringify(concepts) : null,
        };
    }

    private addAuthParams(params: URLSearchParams): void {
        if (this.apiKey) {
            params.set('api_key', this.apiKey);
        }
        if (this.email) {
            params.set('mailto', this.email);
        }
    }
}
