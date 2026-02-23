import type { TfIdfCorpus } from './tfidf.js';
import type { Edge } from '../types/index.js';
import { EdgeType } from '../types/index.js';

/**
 * Compute cosine similarity between two TF-IDF vectors.
 * Returns value in [0, 1].
 */
export function cosineSimilarity(
    vecA: Map<string, number>,
    vecB: Map<string, number>
): number {
    if (vecA.size === 0 || vecB.size === 0) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    // Use the smaller vector for iteration efficiency
    const [smaller, larger] = vecA.size <= vecB.size ? [vecA, vecB] : [vecB, vecA];

    for (const [term, weightA] of smaller) {
        const weightB = larger.get(term);
        if (weightB !== undefined) {
            dotProduct += weightA * weightB;
        }
        normA += weightA * weightA;
    }

    // Add remaining terms from larger vector to normB computation
    for (const [term, weight] of larger) {
        normB += weight * weight;
        if (!smaller.has(term)) {
            // These terms don't contribute to dotProduct
        }
    }

    // Recompute normA fully from vecA, normB from vecB
    normA = 0;
    for (const [, w] of vecA) normA += w * w;
    normB = 0;
    for (const [, w] of vecB) normB += w * w;

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;

    return dotProduct / denominator;
}

/**
 * Find the top-K most similar documents to a given document.
 */
export function findTopKSimilar(
    docId: string,
    corpus: TfIdfCorpus,
    k: number,
    threshold: number
): Array<{ id: string; similarity: number }> {
    const docVector = corpus.documents.get(docId);
    if (!docVector) return [];

    const similarities: Array<{ id: string; similarity: number }> = [];

    for (const [otherId, otherVector] of corpus.documents) {
        if (otherId === docId) continue;

        const sim = cosineSimilarity(docVector, otherVector);
        if (sim >= threshold) {
            similarities.push({ id: otherId, similarity: sim });
        }
    }

    // Sort by similarity descending and take top K
    similarities.sort((a, b) => b.similarity - a.similarity);
    return similarities.slice(0, k);
}

/**
 * Build SIMILAR_TEXT edges from TF-IDF corpus.
 * Connects each paper to its top-K nearest neighbors above the threshold.
 *
 * @param paperIdMap - Mapping from source_id to paper_id (DB integer ID)
 * @param corpus - TF-IDF corpus
 * @param topK - Maximum neighbors per paper
 * @param threshold - Minimum similarity to create an edge
 * @returns Array of SIMILAR_TEXT edges
 */
export function buildSimilarityEdges(
    paperIdMap: Map<string, number>,
    corpus: TfIdfCorpus,
    topK = 10,
    threshold = 0.25
): Omit<Edge, 'edge_id' | 'created_at'>[] {
    const edges: Omit<Edge, 'edge_id' | 'created_at'>[] = [];
    const seenPairs = new Set<string>();

    for (const [sourceId, paperId] of paperIdMap) {
        const neighbors = findTopKSimilar(sourceId, corpus, topK, threshold);

        for (const neighbor of neighbors) {
            const neighborPaperId = paperIdMap.get(neighbor.id);
            if (neighborPaperId === undefined) continue;

            // Avoid duplicate edges (A→B and B→A)
            const pairKey = [Math.min(paperId, neighborPaperId), Math.max(paperId, neighborPaperId)].join('-');
            if (seenPairs.has(pairKey)) continue;
            seenPairs.add(pairKey);

            edges.push({
                src_paper_id: paperId,
                dst_paper_id: neighborPaperId,
                type: EdgeType.SIMILAR_TEXT,
                weight: neighbor.similarity,
                confidence: neighbor.similarity,
                rationale: null,
                evidence: null,
                created_by: 'algo',
                provenance_json: JSON.stringify({
                    source: 'tfidf',
                    version: '1.0.0',
                    topK,
                    threshold,
                }),
            });
        }
    }

    return edges;
}
