import type { Paper } from '../types/index.js';
import type { TfIdfCorpus } from '../nlp/tfidf.js';
import { computeRelevance } from '../nlp/tfidf.js';
import { tokenize } from '../nlp/tokenizer.js';

/**
 * Scoring configuration weights.
 */
export interface ScoringWeights {
    pagerankWeight: number;
    relevanceWeight: number;
    recencyWeight: number;
}

const DEFAULT_WEIGHTS: ScoringWeights = {
    pagerankWeight: 0.5,
    relevanceWeight: 0.3,
    recencyWeight: 0.2,
};

/**
 * Compute composite scores for all papers.
 *
 * composite = pagerank × w1 + relevance × w2 + recency × w3
 *
 * @param papers - Array of papers
 * @param pagerankScores - PageRank scores (paper_id → score)
 * @param corpus - TF-IDF corpus for relevance computation
 * @param topic - Topic string for relevance scoring (optional)
 * @param weights - Custom scoring weights
 * @returns Map from paper_id to composite score
 */
export function computeCompositeScores(
    papers: Paper[],
    pagerankScores: Map<number, number>,
    corpus: TfIdfCorpus,
    topic?: string,
    weights: ScoringWeights = DEFAULT_WEIGHTS
): Map<number, number> {
    const scores = new Map<number, number>();

    // Compute current year for recency
    const currentYear = new Date().getFullYear();
    const oldestYear = Math.min(
        ...papers.map((p) => p.year ?? currentYear).filter((y) => y > 1900)
    );
    const yearRange = Math.max(1, currentYear - oldestYear);

    // Tokenize topic for relevance scoring
    const queryTokens = topic ? tokenize(topic) : [];

    // Normalize PageRank scores to [0, 1]
    const maxPagerank = Math.max(0.001, ...pagerankScores.values());

    for (const paper of papers) {
        if (paper.paper_id === undefined) continue;

        // PageRank (normalized)
        const pr = (pagerankScores.get(paper.paper_id) ?? 0) / maxPagerank;

        // Relevance (TF-IDF similarity to topic)
        const sourceId = paper.source_id || String(paper.paper_id);
        const relevance = queryTokens.length > 0
            ? computeRelevance(corpus, sourceId, queryTokens)
            : 0;

        // Recency (linear scaling: newer = higher)
        const paperYear = paper.year ?? currentYear;
        const recency = yearRange > 0 ? (paperYear - oldestYear) / yearRange : 0.5;

        // Composite score
        const composite =
            pr * weights.pagerankWeight +
            relevance * weights.relevanceWeight +
            recency * weights.recencyWeight;

        scores.set(paper.paper_id, Math.min(1.0, composite));
    }

    return scores;
}
