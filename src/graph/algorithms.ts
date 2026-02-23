import GraphDefault from 'graphology';
import pagerankModule from 'graphology-metrics/centrality/pagerank.js';
import louvainModule from 'graphology-communities-louvain';
import { toUndirected } from 'graphology-operators';
import type { Paper, Edge, Cluster } from '../types/index.js';
import { EdgeType } from '../types/index.js';
import { getLogger } from '../utils/logger.js';

// Handle CJS/ESM interop for graphology modules
const Graph = (GraphDefault as any).default ?? GraphDefault;
const pagerank = (pagerankModule as any).default ?? pagerankModule;
const louvain = (louvainModule as any).default ?? louvainModule;

const logger = getLogger();

/**
 * Compute PageRank scores for papers based on CITES edges.
 *
 * @param papers - Array of papers (must have paper_id)
 * @param edges - Array of CITES edges
 * @returns Map from paper_id to PageRank score
 */
export function computePageRank(
    papers: Paper[],
    edges: Edge[]
): Map<number, number> {
    const graph = new Graph({ type: 'directed' });

    // Add nodes
    for (const paper of papers) {
        if (paper.paper_id !== undefined) {
            graph.addNode(String(paper.paper_id));
        }
    }

    // Add CITES edges
    const citesEdges = edges.filter((e) => e.type === EdgeType.CITES);
    for (const edge of citesEdges) {
        const src = String(edge.src_paper_id);
        const dst = String(edge.dst_paper_id);
        if (graph.hasNode(src) && graph.hasNode(dst) && !graph.hasEdge(src, dst)) {
            graph.addEdge(src, dst, { weight: edge.weight });
        }
    }

    // Compute PageRank
    const scores = pagerank(graph, { alpha: 0.85, maxIterations: 100, tolerance: 1e-6 });

    // Convert to Map<number, number>
    const result = new Map<number, number>();
    for (const [nodeId, score] of Object.entries(scores)) {
        result.set(parseInt(nodeId, 10), score as number);
    }

    logger.debug({ nodeCount: graph.order, edgeCount: graph.size }, 'PageRank computed');
    return result;
}

/**
 * Run Louvain community detection.
 * Citation graphs are directed; Louvain requires undirected — we convert first.
 *
 * @param papers - Array of papers (must have paper_id)
 * @param edges - Array of edges (all types used for community detection)
 * @returns Map from cluster index to array of paper IDs in that cluster
 */
export function computeLouvainClusters(
    papers: Paper[],
    edges: Edge[]
): Map<number, number[]> {
    const directedGraph = new Graph({ type: 'directed', allowSelfLoops: false });

    // Add nodes
    for (const paper of papers) {
        if (paper.paper_id !== undefined) {
            directedGraph.addNode(String(paper.paper_id));
        }
    }

    // Add all edges
    for (const edge of edges) {
        const src = String(edge.src_paper_id);
        const dst = String(edge.dst_paper_id);
        if (directedGraph.hasNode(src) && directedGraph.hasNode(dst) && !directedGraph.hasEdge(src, dst)) {
            directedGraph.addEdge(src, dst, { weight: edge.weight });
        }
    }

    // Convert to undirected (required by Louvain)
    const undirectedGraph = toUndirected(directedGraph);

    // Handle edge case: isolated nodes or empty graph
    if (undirectedGraph.order === 0) {
        return new Map();
    }

    // Run Louvain
    const communities = louvain(undirectedGraph, {
        resolution: 1.0,
    });

    // Group paper IDs by community
    const clusterMap = new Map<number, number[]>();
    for (const [nodeId, community] of Object.entries(communities)) {
        const paperId = parseInt(nodeId, 10);
        const communityNum = community as number;
        if (!clusterMap.has(communityNum)) {
            clusterMap.set(communityNum, []);
        }
        clusterMap.get(communityNum)!.push(paperId);
    }

    logger.debug(
        { communities: clusterMap.size, papers: papers.length },
        'Louvain clustering computed'
    );

    return clusterMap;
}

/**
 * Compute co-citation edges.
 * For each pair of papers that are cited together by a third paper,
 * create a CO_CITED edge with count-based weight.
 *
 * @param edges - CITES edges (src cites dst)
 * @returns Array of CO_CITED edges
 */
export function computeCoCitation(
    edges: Edge[]
): Omit<Edge, 'edge_id' | 'created_at'>[] {
    const citesEdges = edges.filter((e) => e.type === EdgeType.CITES);

    // Build: citing paper → set of cited papers
    const citingToRefs = new Map<number, Set<number>>();
    for (const edge of citesEdges) {
        if (!citingToRefs.has(edge.src_paper_id)) {
            citingToRefs.set(edge.src_paper_id, new Set());
        }
        citingToRefs.get(edge.src_paper_id)!.add(edge.dst_paper_id);
    }

    // Count co-citation pairs
    const pairCounts = new Map<string, number>();
    for (const [, refs] of citingToRefs) {
        const refArray = Array.from(refs);
        for (let i = 0; i < refArray.length; i++) {
            for (let j = i + 1; j < refArray.length; j++) {
                const a = Math.min(refArray[i]!, refArray[j]!);
                const b = Math.max(refArray[i]!, refArray[j]!);
                const key = `${a}-${b}`;
                pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
            }
        }
    }

    // Convert to edges
    const coCitationEdges: Omit<Edge, 'edge_id' | 'created_at'>[] = [];
    const maxCount = Math.max(1, ...pairCounts.values());

    for (const [key, count] of pairCounts) {
        const [a, b] = key.split('-').map(Number) as [number, number];
        coCitationEdges.push({
            src_paper_id: a,
            dst_paper_id: b,
            type: EdgeType.CO_CITED,
            weight: count / maxCount,  // Normalize to [0, 1]
            confidence: 1.0,
            rationale: null,
            evidence: null,
            created_by: 'algo',
            provenance_json: JSON.stringify({ source: 'co-citation', count }),
        });
    }

    logger.debug({ pairs: coCitationEdges.length }, 'Co-citation edges computed');
    return coCitationEdges;
}

/**
 * Compute bibliographic coupling edges.
 * Weight = |overlap(refs_A, refs_B)| / min(|refs_A|, |refs_B|)
 *
 * @param edges - CITES edges
 * @returns Array of BIB_COUPLED edges
 */
export function computeBibCoupling(
    edges: Edge[]
): Omit<Edge, 'edge_id' | 'created_at'>[] {
    const citesEdges = edges.filter((e) => e.type === EdgeType.CITES);

    // Build: citing paper → set of cited papers
    const paperRefs = new Map<number, Set<number>>();
    for (const edge of citesEdges) {
        if (!paperRefs.has(edge.src_paper_id)) {
            paperRefs.set(edge.src_paper_id, new Set());
        }
        paperRefs.get(edge.src_paper_id)!.add(edge.dst_paper_id);
    }

    // Compute coupling for all pairs
    const couplingEdges: Omit<Edge, 'edge_id' | 'created_at'>[] = [];
    const papers = Array.from(paperRefs.keys());

    for (let i = 0; i < papers.length; i++) {
        const refsA = paperRefs.get(papers[i]!)!;
        if (refsA.size === 0) continue;

        for (let j = i + 1; j < papers.length; j++) {
            const refsB = paperRefs.get(papers[j]!)!;
            if (refsB.size === 0) continue;

            // Count overlap
            let overlap = 0;
            for (const ref of refsA) {
                if (refsB.has(ref)) overlap++;
            }

            if (overlap === 0) continue;

            const weight = overlap / Math.min(refsA.size, refsB.size);

            couplingEdges.push({
                src_paper_id: papers[i]!,
                dst_paper_id: papers[j]!,
                type: EdgeType.BIB_COUPLED,
                weight,
                confidence: 1.0,
                rationale: null,
                evidence: null,
                created_by: 'algo',
                provenance_json: JSON.stringify({
                    source: 'bib-coupling',
                    overlap,
                    refsA: refsA.size,
                    refsB: refsB.size,
                }),
            });
        }
    }

    logger.debug({ pairs: couplingEdges.length }, 'Bibliographic coupling edges computed');
    return couplingEdges;
}

/**
 * Create Cluster objects from Louvain community detection results.
 * Names clusters using top TF-IDF terms (non-LLM).
 */
export function buildClusterObjects(
    clusterMap: Map<number, number[]>,
    clusterNames?: Map<number, string>
): { clusters: Omit<Cluster, 'cluster_id'>[]; paperMappings: Map<number, number[]> } {
    const clusters: Omit<Cluster, 'cluster_id'>[] = [];
    const paperMappings = new Map<number, number[]>();

    let idx = 0;
    for (const [communityId, paperIds] of clusterMap) {
        const name = clusterNames?.get(communityId) ?? `Cluster ${communityId}`;

        clusters.push({
            method: 'louvain_citation',
            name,
            description: null,
            stats_json: JSON.stringify({
                member_count: paperIds.length,
                community_id: communityId,
            }),
        });

        paperMappings.set(idx, paperIds);
        idx++;
    }

    return { clusters, paperMappings };
}
