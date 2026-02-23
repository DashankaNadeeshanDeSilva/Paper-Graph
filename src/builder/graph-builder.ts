import type { Paper, Edge, PaperGraphConfig, SourceAdapter } from '../types/index.js';
import { EdgeType } from '../types/index.js';
import { PaperGraphDatabase } from '../storage/database.js';
import { OpenAlexAdapter } from '../sources/openalex.js';
import { SemanticScholarAdapter } from '../sources/semantic-scholar.js';
import { buildCorpus, getTopTerms, type TfIdfCorpus } from '../nlp/tfidf.js';
import { buildSimilarityEdges } from '../nlp/similarity.js';
import {
    computePageRank,
    computeLouvainClusters,
    computeCoCitation,
    computeBibCoupling,
    buildClusterObjects,
} from '../graph/algorithms.js';
import { computeCompositeScores } from '../graph/scoring.js';
import { tokenize } from '../nlp/tokenizer.js';
import { getLogger } from '../utils/logger.js';

const logger = getLogger();

/**
 * Resolve the source adapter based on config.
 */
function getSourceAdapter(config: PaperGraphConfig): SourceAdapter {
    switch (config.source) {
        case 's2':
            return new SemanticScholarAdapter();
        case 'openalex':
        default:
            return new OpenAlexAdapter();
    }
}

/**
 * Main graph builder — orchestrates the full pipeline:
 *
 * 1. Search / seed papers
 * 2. BFS citation traversal (depth)
 * 3. Build NLP corpus + similarity edges
 * 4. Build citation-analytic edges (co-citation, coupling)
 * 5. Run graph algorithms (PageRank, Louvain)
 * 6. Compute composite ranking
 * 7. Persist everything to SQLite
 */
export async function buildGraph(config: PaperGraphConfig): Promise<string> {
    const db = new PaperGraphDatabase(config.out);
    const adapter = getSourceAdapter(config);

    logger.info(
        { topic: config.topic, paper: config.paper, source: config.source, spine: config.spine, depth: config.depth, maxPapers: config.maxPapers },
        'Starting graph build'
    );

    const startTime = Date.now();

    try {
        // ──────────────────────────────────────────────────
        // Step 1: Seed papers
        // ──────────────────────────────────────────────────
        const seedPapers = await findSeeds(adapter, config);
        logger.info({ seedCount: seedPapers.length }, 'Seeds found');

        if (seedPapers.length === 0) {
            logger.warn('No seed papers found — nothing to build');
            db.close();
            return config.out;
        }

        // Insert seeds and assign their database IDs back
        const seedIds = db.insertPapers(seedPapers);
        for (let i = 0; i < seedPapers.length; i++) {
            seedPapers[i]!.paper_id = seedIds[i];
        }

        // ──────────────────────────────────────────────────
        // Step 2: Citation traversal (BFS by depth)
        // ──────────────────────────────────────────────────
        const allEdges: Omit<Edge, 'edge_id' | 'created_at'>[] = [];
        await traverseCitations(adapter, db, seedPapers, config, allEdges);

        // ──────────────────────────────────────────────────
        // Step 3: Fetch all papers from DB for NLP + algorithms
        // ──────────────────────────────────────────────────
        const allPapers = db.getAllPapers();
        logger.info({ paperCount: allPapers.length }, 'Papers in database');

        // ──────────────────────────────────────────────────
        // Step 4: NLP — Build TF-IDF corpus + similarity edges
        // ──────────────────────────────────────────────────
        const corpus = buildCorpus(allPapers);
        logger.info({ corpusSize: corpus.size }, 'TF-IDF corpus built');

        // Build paper ID map (source_id → paper_id)
        const paperIdMap = new Map<string, number>();
        for (const paper of allPapers) {
            if (paper.paper_id !== undefined) {
                paperIdMap.set(paper.source_id, paper.paper_id);
            }
        }

        // Similarity edges (only if spine includes similarity)
        const spine = config.spine;
        if (spine === 'similarity' || spine === 'hybrid') {
            const simEdges = buildSimilarityEdges(
                paperIdMap,
                corpus,
                config.similarity?.topK ?? 10,
                config.similarity?.threshold ?? 0.25
            );
            db.insertEdges(simEdges);
            logger.info({ simEdges: simEdges.length }, 'Similarity edges added');
        }

        // ──────────────────────────────────────────────────
        // Step 5: Citation-analytic edges
        // ──────────────────────────────────────────────────
        const dbEdges = db.getAllEdges();

        if (spine === 'co-citation' || spine === 'hybrid') {
            const coCiteEdges = computeCoCitation(dbEdges);
            db.insertEdges(coCiteEdges);
            logger.info({ coCiteEdges: coCiteEdges.length }, 'Co-citation edges added');
        }

        if (spine === 'coupling' || spine === 'hybrid') {
            const couplingEdges = computeBibCoupling(dbEdges);
            db.insertEdges(couplingEdges);
            logger.info({ couplingEdges: couplingEdges.length }, 'Bib coupling edges added');
        }

        // ──────────────────────────────────────────────────
        // Step 6: Graph algorithms (PageRank, Louvain)
        // ──────────────────────────────────────────────────
        const finalEdges = db.getAllEdges();
        const pagerankScores = computePageRank(allPapers, finalEdges);
        logger.info({ nodes: pagerankScores.size }, 'PageRank computed');

        // Louvain clustering
        const clusterMap = computeLouvainClusters(allPapers, finalEdges);

        // Name clusters using top TF-IDF terms
        const clusterNames = new Map<number, string>();
        for (const [communityId, paperIds] of clusterMap) {
            const sourceIds = paperIds
                .map((id) => allPapers.find((p) => p.paper_id === id)?.source_id)
                .filter((id): id is string => !!id);
            const top = getTopTerms(corpus, sourceIds, 3);
            clusterNames.set(communityId, top.join(', ') || `Cluster ${communityId}`);
        }

        const { clusters, paperMappings } = buildClusterObjects(clusterMap, clusterNames);

        // Insert clusters with paper mappings
        db.insertClusters(clusters, paperMappings);
        logger.info({ clusterCount: clusters.length }, 'Clusters stored');

        // ──────────────────────────────────────────────────
        // Step 7: Composite ranking + score updates
        // ──────────────────────────────────────────────────
        const topicQuery = config.topic ?? '';
        const compositeScores = computeCompositeScores(
            allPapers,
            pagerankScores,
            corpus,
            topicQuery,
            {
                pagerankWeight: config.ranking?.pagerankWeight ?? 0.5,
                relevanceWeight: config.ranking?.relevanceWeight ?? 0.3,
                recencyWeight: config.ranking?.recencyWeight ?? 0.2,
            }
        );

        // Update papers with PageRank as influence_score
        for (const [paperId, pr] of pagerankScores) {
            db.updatePaperScore(paperId, pr);
        }

        // ──────────────────────────────────────────────────
        // Step 8: Record run metadata
        // ──────────────────────────────────────────────────
        const stats = db.getStats();
        db.insertRun({
            created_at: new Date().toISOString(),
            papergraph_version: '1.0.0',
            config_json: JSON.stringify(config),
            source: config.source,
            spine: config.spine,
            depth: config.depth,
            stats_json: JSON.stringify(stats),
        });

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        logger.info(
            { papers: stats.papers, edges: stats.edges, clusters: stats.clusters, elapsed: `${elapsed}s` },
            'Graph build complete'
        );

        db.close();
        return config.out;
    } catch (error) {
        db.close();
        throw error;
    }
}

// ─── Internal helpers ─────────────────────────────────

/**
 * Find seed papers from topic, named papers, DOIs, or arXiv IDs.
 */
async function findSeeds(
    adapter: SourceAdapter,
    config: PaperGraphConfig
): Promise<Paper[]> {
    const papers: Paper[] = [];
    const seen = new Set<string>();

    const addUnique = (paper: Paper) => {
        const key = `${paper.source}:${paper.source_id}`;
        if (!seen.has(key)) {
            seen.add(key);
            papers.push(paper);
        }
    };

    // Cap seeds at ~40% of maxPapers so traversal has room to discover new papers
    const seedLimit = Math.max(10, Math.min(Math.floor(config.maxPapers * 0.4), 200));

    // Search by topic
    if (config.topic) {
        const results = await adapter.searchByTopic(config.topic, seedLimit);
        results.forEach(addUnique);
    }

    // Search by paper titles
    if (config.paper?.length) {
        for (const title of config.paper) {
            const results = await adapter.searchByTitle(title, 5);
            if (results.length > 0) {
                addUnique(results[0]!);
            }
        }
    }

    // Search by DOI
    if (config.doi?.length) {
        for (const doi of config.doi) {
            const paper = await adapter.fetchPaper(doi);
            if (paper) addUnique(paper);
        }
    }

    return papers.slice(0, seedLimit);
}

/**
 * BFS citation traversal up to config.depth.
 *
 * Key design: we always process every paper in the frontier for edge discovery,
 * even if we've hit the maxPapers cap. New papers are only inserted when
 * below quota, but edges to already-known papers are always created.
 */
async function traverseCitations(
    adapter: SourceAdapter,
    db: PaperGraphDatabase,
    seedPapers: Paper[],
    config: PaperGraphConfig,
    allEdges: Omit<Edge, 'edge_id' | 'created_at'>[]
): Promise<void> {
    const depth = config.depth;
    const maxPapers = config.maxPapers;
    const refsPerPaper = config.maxRefsPerPaper;

    let frontier = [...seedPapers];
    const visited = new Set<string>();
    const edgeSeen = new Set<string>(); // Prevent duplicate edges

    for (const paper of seedPapers) {
        visited.add(`${paper.source}:${paper.source_id}`);
    }

    for (let d = 0; d < depth; d++) {
        const nextFrontier: Paper[] = [];
        const atCapacity = db.getPaperCount() >= maxPapers;

        logger.info(
            { depth: d, frontier: frontier.length, atCapacity, totalPapers: db.getPaperCount() },
            'Starting depth traversal'
        );

        for (const paper of frontier) {
            if (paper.paper_id === undefined) continue;

            try {
                // Fetch references — always do this for edge discovery
                const refs = await adapter.fetchReferences(paper.source_id, refsPerPaper);

                for (const ref of refs) {
                    const key = `${ref.source}:${ref.source_id}`;

                    // Check if this paper is already in the DB
                    const existingPaper = db.getPaperBySourceId(ref.source, ref.source_id);

                    if (existingPaper && existingPaper.paper_id !== undefined) {
                        // Paper already in DB — just create edge
                        const edgeKey = `${paper.paper_id}->${existingPaper.paper_id}`;
                        if (!edgeSeen.has(edgeKey)) {
                            edgeSeen.add(edgeKey);
                            const edge: Omit<Edge, 'edge_id' | 'created_at'> = {
                                src_paper_id: paper.paper_id,
                                dst_paper_id: existingPaper.paper_id,
                                type: EdgeType.CITES,
                                weight: 1.0,
                                confidence: 1.0,
                                rationale: null,
                                evidence: null,
                                created_by: 'algo',
                                provenance_json: JSON.stringify({ source: paper.source, depth: d }),
                            };
                            db.insertEdges([edge]);
                            allEdges.push(edge);
                        }
                    } else if (!visited.has(key) && !atCapacity && db.getPaperCount() < maxPapers) {
                        // New paper and we have room — insert it + create edge
                        visited.add(key);
                        const [refId] = db.insertPapers([ref]);

                        if (refId !== undefined) {
                            const edgeKey = `${paper.paper_id}->${refId}`;
                            if (!edgeSeen.has(edgeKey)) {
                                edgeSeen.add(edgeKey);
                                const edge: Omit<Edge, 'edge_id' | 'created_at'> = {
                                    src_paper_id: paper.paper_id,
                                    dst_paper_id: refId,
                                    type: EdgeType.CITES,
                                    weight: 1.0,
                                    confidence: 1.0,
                                    rationale: null,
                                    evidence: null,
                                    created_by: 'algo',
                                    provenance_json: JSON.stringify({ source: paper.source, depth: d }),
                                };
                                db.insertEdges([edge]);
                                allEdges.push(edge);
                            }

                            nextFrontier.push({ ...ref, paper_id: refId });
                        }
                    }
                    // else: new paper but at capacity — skip (no room)
                }
            } catch (error) {
                logger.warn({ paperId: paper.source_id, error }, 'Failed to traverse paper');
            }
        }

        logger.info(
            { depth: d + 1, frontier: nextFrontier.length, totalPapers: db.getPaperCount(), edgesCreated: allEdges.length },
            'Citation depth traversed'
        );

        if (nextFrontier.length === 0) break;
        frontier = nextFrontier;
    }
}

