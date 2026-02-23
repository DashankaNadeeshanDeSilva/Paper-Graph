import { tokenize } from './tokenizer.js';
import { getLogger } from '../utils/logger.js';
import type { Paper } from '../types/index.js';

const logger = getLogger();

/**
 * TF-IDF corpus built from paper titles and abstracts.
 * Fully deterministic — identical input produces identical output.
 */
export interface TfIdfCorpus {
    /** Document ID → TF-IDF vector (term → weight) */
    documents: Map<string, Map<string, number>>;
    /** Term → document frequency (how many documents contain this term) */
    df: Map<string, number>;
    /** Total number of documents */
    size: number;
}

/**
 * Build a TF-IDF corpus from a collection of papers.
 *
 * Uses title + abstract text. If abstract is null, falls back to title + keywords.
 * Logs a warning with the percentage of null abstracts.
 */
export function buildCorpus(papers: Paper[]): TfIdfCorpus {
    const df = new Map<string, number>();
    const documents = new Map<string, Map<string, number>>();

    let nullAbstractCount = 0;

    for (const paper of papers) {
        const id = paper.source_id || String(paper.paper_id);

        // Build text: title + abstract (or title + keywords if no abstract)
        let text = paper.title;

        if (paper.abstract) {
            text += ' ' + paper.abstract;
        } else {
            nullAbstractCount++;
            // Fallback: use keywords if available
            if (paper.keywords_json) {
                try {
                    const keywords = JSON.parse(paper.keywords_json) as string[];
                    text += ' ' + keywords.join(' ');
                } catch {
                    // Ignore malformed JSON
                }
            }
        }

        // Tokenize
        const tokens = tokenize(text);
        if (tokens.length === 0) continue;

        // Compute term frequency (TF)
        const tf = new Map<string, number>();
        for (const token of tokens) {
            tf.set(token, (tf.get(token) ?? 0) + 1);
        }

        // Normalize TF by document length
        const maxTf = Math.max(...tf.values());
        const normalizedTf = new Map<string, number>();
        for (const [term, count] of tf) {
            normalizedTf.set(term, count / maxTf);
        }

        documents.set(id, normalizedTf);

        // Update document frequency
        const seenTerms = new Set(tokens);
        for (const term of seenTerms) {
            df.set(term, (df.get(term) ?? 0) + 1);
        }
    }

    // Log null abstract percentage
    if (papers.length > 0) {
        const pct = ((nullAbstractCount / papers.length) * 100).toFixed(1);
        if (nullAbstractCount > 0) {
            logger.warn(
                { nullAbstracts: nullAbstractCount, total: papers.length, percentage: pct },
                `${pct}% of papers have null abstracts (using title-only fallback)`
            );
        }
    }

    // Compute TF-IDF weights
    const N = documents.size;
    for (const [, docTf] of documents) {
        for (const [term, tf] of docTf) {
            const termDf = df.get(term) ?? 1;
            const idf = Math.log(N / termDf);
            docTf.set(term, tf * idf);
        }
    }

    return { documents, df, size: N };
}

/**
 * Get the TF-IDF vector for a specific document.
 */
export function getDocumentVector(corpus: TfIdfCorpus, docId: string): Map<string, number> | undefined {
    return corpus.documents.get(docId);
}

/**
 * Get the top-N TF-IDF terms from a set of document IDs.
 * Useful for cluster naming.
 */
export function getTopTerms(corpus: TfIdfCorpus, docIds: string[], topN = 5): string[] {
    const termScores = new Map<string, number>();

    for (const docId of docIds) {
        const vector = corpus.documents.get(docId);
        if (!vector) continue;

        for (const [term, weight] of vector) {
            termScores.set(term, (termScores.get(term) ?? 0) + weight);
        }
    }

    return Array.from(termScores.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, topN)
        .map(([term]) => term);
}

/**
 * Compute topic relevance score for a paper against a query.
 * Returns a value between 0 and 1.
 */
export function computeRelevance(corpus: TfIdfCorpus, docId: string, queryTokens: string[]): number {
    const docVector = corpus.documents.get(docId);
    if (!docVector || queryTokens.length === 0) return 0;

    let score = 0;
    for (const token of queryTokens) {
        score += docVector.get(token) ?? 0;
    }

    // Normalize by query length and max possible score
    return Math.min(1.0, score / queryTokens.length);
}
