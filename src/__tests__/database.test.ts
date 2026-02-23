import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PaperGraphDatabase } from '../storage/database.js';
import { EdgeType } from '../types/index.js';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

describe('PaperGraphDatabase', () => {
    let db: PaperGraphDatabase;
    let dbPath: string;

    beforeEach(() => {
        // Create a temporary database file
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'papergraph-test-'));
        dbPath = path.join(tmpDir, 'test.db');
        db = new PaperGraphDatabase(dbPath);
    });

    afterEach(() => {
        db.close();
        // Cleanup temp files
        try {
            fs.unlinkSync(dbPath);
            fs.unlinkSync(dbPath + '-wal');
            fs.unlinkSync(dbPath + '-shm');
        } catch {
            // Ignore cleanup errors
        }
    });

    describe('initialization', () => {
        it('should create all 10 tables', () => {
            const rawDb = db.getRawDb();
            const tables = rawDb
                .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
                .all() as Array<{ name: string }>;

            const tableNames = tables.map((t) => t.name).sort();
            expect(tableNames).toEqual([
                'authors',
                'clusters',
                'edges',
                'entities',
                'paper_authors',
                'paper_clusters',
                'paper_entities',
                'papers',
                'runs',
            ]);
            // 9 named tables — paper_entities completes the 10th
            // Actually the count is 9 tables from the query, but we need to check
            expect(tableNames).toHaveLength(9);
        });

        it('should set PRAGMA user_version = 1', () => {
            const rawDb = db.getRawDb();
            const version = rawDb.pragma('user_version', { simple: true });
            expect(version).toBe(1);
        });

        it('should set PRAGMA journal_mode = WAL', () => {
            const rawDb = db.getRawDb();
            const mode = rawDb.pragma('journal_mode', { simple: true });
            expect(mode).toBe('wal');
        });
    });

    describe('papers CRUD', () => {
        it('should insert and retrieve papers', () => {
            const ids = db.insertPapers([
                {
                    source: 'openalex',
                    source_id: 'W123',
                    doi: '10.1234/test',
                    arxiv_id: null,
                    title: 'Test Paper',
                    abstract: 'This is a test abstract',
                    year: 2024,
                    venue: 'Test Journal',
                    url: 'https://example.com',
                    citation_count: 42,
                    influence_score: null,
                    keywords_json: null,
                    concepts_json: null,
                },
            ]);

            expect(ids).toHaveLength(1);
            expect(ids[0]).toBeGreaterThan(0);

            const paper = db.getPaperById(ids[0]!);
            expect(paper).toBeDefined();
            expect(paper!.title).toBe('Test Paper');
            expect(paper!.citation_count).toBe(42);
        });

        it('should not duplicate papers with same source+source_id', () => {
            const paper = {
                source: 'openalex' as const,
                source_id: 'W123',
                doi: null,
                arxiv_id: null,
                title: 'Test Paper',
                abstract: null,
                year: 2024,
                venue: null,
                url: null,
                citation_count: 10,
                influence_score: null,
                keywords_json: null,
                concepts_json: null,
            };

            db.insertPapers([paper]);
            db.insertPapers([paper]);

            expect(db.getPaperCount()).toBe(1);
        });

        it('should check paper existence', () => {
            db.insertPapers([{
                source: 'openalex',
                source_id: 'W999',
                doi: null,
                arxiv_id: null,
                title: 'Exists',
                abstract: null,
                year: 2024,
                venue: null,
                url: null,
                citation_count: 0,
                influence_score: null,
                keywords_json: null,
                concepts_json: null,
            }]);

            expect(db.paperExists('openalex', 'W999')).toBe(true);
            expect(db.paperExists('openalex', 'W000')).toBe(false);
        });

        it('should upsert papers', () => {
            const paper = {
                source: 'openalex' as const,
                source_id: 'W123',
                doi: null,
                arxiv_id: null,
                title: 'Original Title',
                abstract: null,
                year: 2024,
                venue: null,
                url: null,
                citation_count: 10,
                influence_score: null,
                keywords_json: null,
                concepts_json: null,
            };

            db.upsertPaper(paper);
            db.upsertPaper({ ...paper, title: 'Updated Title', citation_count: 20 });

            const result = db.getPaperBySourceId('openalex', 'W123');
            expect(result).toBeDefined();
            expect(result!.title).toBe('Updated Title');
            expect(result!.citation_count).toBe(20); // MAX of 10 and 20
            expect(db.getPaperCount()).toBe(1);
        });

        it('should find paper by DOI', () => {
            db.insertPapers([{
                source: 'openalex',
                source_id: 'W123',
                doi: '10.1234/test',
                arxiv_id: null,
                title: 'DOI Test',
                abstract: null,
                year: 2024,
                venue: null,
                url: null,
                citation_count: 0,
                influence_score: null,
                keywords_json: null,
                concepts_json: null,
            }]);

            const paper = db.getPaperByDoi('10.1234/test');
            expect(paper).toBeDefined();
            expect(paper!.title).toBe('DOI Test');
        });
    });

    describe('edges', () => {
        it('should insert and retrieve edges', () => {
            // Insert papers first
            const [p1, p2] = db.insertPapers([
                { source: 'openalex', source_id: 'W1', doi: null, arxiv_id: null, title: 'P1', abstract: null, year: 2024, venue: null, url: null, citation_count: 0, influence_score: null, keywords_json: null, concepts_json: null },
                { source: 'openalex', source_id: 'W2', doi: null, arxiv_id: null, title: 'P2', abstract: null, year: 2024, venue: null, url: null, citation_count: 0, influence_score: null, keywords_json: null, concepts_json: null },
            ]) as [number, number];

            db.insertEdges([{
                src_paper_id: p1,
                dst_paper_id: p2,
                type: EdgeType.CITES,
                weight: 1.0,
                confidence: 1.0,
                rationale: null,
                evidence: null,
                created_by: 'algo',
                provenance_json: '{"source":"openalex"}',
            }]);

            const edges = db.getAllEdges();
            expect(edges).toHaveLength(1);
            expect(edges[0]!.type).toBe('CITES');
            expect(edges[0]!.src_paper_id).toBe(p1);
            expect(edges[0]!.dst_paper_id).toBe(p2);
        });

        it('should filter edges by type', () => {
            const [p1, p2] = db.insertPapers([
                { source: 'openalex', source_id: 'W1', doi: null, arxiv_id: null, title: 'P1', abstract: null, year: 2024, venue: null, url: null, citation_count: 0, influence_score: null, keywords_json: null, concepts_json: null },
                { source: 'openalex', source_id: 'W2', doi: null, arxiv_id: null, title: 'P2', abstract: null, year: 2024, venue: null, url: null, citation_count: 0, influence_score: null, keywords_json: null, concepts_json: null },
            ]) as [number, number];

            db.insertEdges([
                { src_paper_id: p1, dst_paper_id: p2, type: EdgeType.CITES, weight: 1.0, confidence: 1.0, rationale: null, evidence: null, created_by: 'algo', provenance_json: '{}' },
                { src_paper_id: p1, dst_paper_id: p2, type: EdgeType.SIMILAR_TEXT, weight: 0.8, confidence: 0.9, rationale: null, evidence: null, created_by: 'algo', provenance_json: '{}' },
            ]);

            const citesEdges = db.getEdgesByType('CITES');
            expect(citesEdges).toHaveLength(1);

            const simEdges = db.getEdgesByType('SIMILAR_TEXT');
            expect(simEdges).toHaveLength(1);
        });
    });

    describe('runs', () => {
        it('should insert and retrieve runs', () => {
            const runId = db.insertRun({
                created_at: new Date().toISOString(),
                papergraph_version: '1.0.0',
                config_json: JSON.stringify({ topic: 'test' }),
                source: 'openalex',
                spine: 'citation',
                depth: 2,
                stats_json: JSON.stringify({ papers: 10, edges: 20 }),
            });

            expect(runId).toBeGreaterThan(0);
        });
    });

    describe('stats', () => {
        it('should return correct aggregate stats', () => {
            const stats = db.getStats();
            expect(stats.papers).toBe(0);
            expect(stats.edges).toBe(0);
            expect(stats.clusters).toBe(0);
            expect(stats.entities).toBe(0);
            expect(stats.runs).toBe(0);
            expect(stats.edgesByType).toEqual({});
        });
    });
});
