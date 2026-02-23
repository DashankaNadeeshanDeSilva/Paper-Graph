import { describe, it, expect } from 'vitest';
import { computePageRank, computeLouvainClusters, computeCoCitation, computeBibCoupling, buildClusterObjects } from '../graph/algorithms.js';
import { computeCompositeScores } from '../graph/scoring.js';
import { buildCorpus } from '../nlp/tfidf.js';
import { EdgeType } from '../types/index.js';
import type { Paper, Edge } from '../types/index.js';

// Helper: create a test paper
function makePaper(id: number, title: string, year = 2020): Paper {
    return {
        paper_id: id,
        source: 'openalex',
        source_id: `W${id}`,
        doi: null,
        arxiv_id: null,
        title,
        abstract: `Abstract about ${title.toLowerCase()}`,
        year,
        venue: null,
        url: null,
        citation_count: id * 10,
        influence_score: null,
        keywords_json: null,
        concepts_json: null,
    };
}

// Helper: create a CITES edge
function makeEdge(src: number, dst: number): Edge {
    return {
        edge_id: undefined,
        src_paper_id: src,
        dst_paper_id: dst,
        type: EdgeType.CITES,
        weight: 1.0,
        confidence: 1.0,
        rationale: null,
        evidence: null,
        created_by: 'algo',
        provenance_json: '{}',
    };
}

describe('Graph Algorithms', () => {
    const papers = [
        makePaper(1, 'Paper A', 2020),
        makePaper(2, 'Paper B', 2021),
        makePaper(3, 'Paper C', 2022),
        makePaper(4, 'Paper D', 2023),
    ];

    // A->B, A->C, B->C, B->D, C->D
    const edges: Edge[] = [
        makeEdge(1, 2),
        makeEdge(1, 3),
        makeEdge(2, 3),
        makeEdge(2, 4),
        makeEdge(3, 4),
    ];

    describe('PageRank', () => {
        it('should compute positive scores for all papers', () => {
            const scores = computePageRank(papers, edges);
            expect(scores.size).toBe(4);
            for (const [, score] of scores) {
                expect(score).toBeGreaterThan(0);
            }
        });

        it('should give highest PageRank to most-cited paper', () => {
            const scores = computePageRank(papers, edges);
            // Paper D is cited by B and C (terminal node)
            const scoreD = scores.get(4)!;
            const scoreA = scores.get(1)!;
            expect(scoreD).toBeGreaterThan(scoreA);
        });

        it('should have scores summing approximately to 1.0', () => {
            const scores = computePageRank(papers, edges);
            const sum = Array.from(scores.values()).reduce((a, b) => a + b, 0);
            expect(sum).toBeCloseTo(1.0, 0);
        });
    });

    describe('Louvain Clustering', () => {
        it('should assign every paper to a cluster', () => {
            const clusterMap = computeLouvainClusters(papers, edges);
            const allPaperIds = new Set<number>();
            for (const [, ids] of clusterMap) {
                ids.forEach((id) => allPaperIds.add(id));
            }
            expect(allPaperIds.size).toBe(4);
        });

        it('should create at least one cluster', () => {
            const clusterMap = computeLouvainClusters(papers, edges);
            expect(clusterMap.size).toBeGreaterThanOrEqual(1);
        });
    });

    describe('Co-Citation', () => {
        it('should find co-cited pairs', () => {
            const coCiteEdges = computeCoCitation(edges);
            // Paper A cites B and C → B and C are co-cited
            // Paper B cites C and D → C and D are co-cited
            expect(coCiteEdges.length).toBeGreaterThan(0);
            expect(coCiteEdges.every((e) => e.type === EdgeType.CO_CITED)).toBe(true);
        });

        it('should have weights between 0 and 1', () => {
            const coCiteEdges = computeCoCitation(edges);
            for (const edge of coCiteEdges) {
                expect(edge.weight).toBeGreaterThan(0);
                expect(edge.weight).toBeLessThanOrEqual(1);
            }
        });
    });

    describe('Bibliographic Coupling', () => {
        it('should find coupled papers (sharing references)', () => {
            const couplingEdges = computeBibCoupling(edges);
            // A cites {B,C}, B cites {C,D} → overlap = {C}, weight = 1/min(2,2) = 0.5
            expect(couplingEdges.length).toBeGreaterThan(0);
            expect(couplingEdges.every((e) => e.type === EdgeType.BIB_COUPLED)).toBe(true);
        });
    });

    describe('Cluster Objects', () => {
        it('should build cluster objects from community map', () => {
            const clusterMap = new Map([[0, [1, 2]], [1, [3, 4]]]);
            const { clusters, paperMappings } = buildClusterObjects(clusterMap);
            expect(clusters).toHaveLength(2);
            expect(paperMappings.size).toBe(2);
            expect(clusters[0]!.method).toBe('louvain_citation');
        });
    });

    describe('Composite Scoring', () => {
        it('should compute scores for all papers', () => {
            const pagerankScores = computePageRank(papers, edges);
            const corpus = buildCorpus(papers);
            const scores = computeCompositeScores(papers, pagerankScores, corpus, 'paper');

            expect(scores.size).toBe(4);
            for (const [, score] of scores) {
                expect(score).toBeGreaterThanOrEqual(0);
                expect(score).toBeLessThanOrEqual(1);
            }
        });
    });
});
