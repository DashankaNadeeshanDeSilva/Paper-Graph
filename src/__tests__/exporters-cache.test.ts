import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { PaperGraphDatabase } from '../storage/database.js';
import { exportGraph } from '../exporters/export.js';
import { generateViewer } from '../viewer/html-viewer.js';
import { extractEntities, extractAllEntities } from '../nlp/entity-extraction.js';
import { ResponseCache } from '../cache/response-cache.js';
import { EdgeType, type Paper } from '../types/index.js';

const TEST_DIR = '/tmp/papergraph-test-wave5';
const TEST_DB = `${TEST_DIR}/test.db`;
const TEST_CACHE = `${TEST_DIR}/cache`;

function seedTestDb(): PaperGraphDatabase {
    mkdirSync(TEST_DIR, { recursive: true });
    const db = new PaperGraphDatabase(TEST_DB);

    db.insertPapers([
        {
            source: 'openalex', source_id: 'W1', doi: '10.1234/test1',
            arxiv_id: null, title: 'Attention Is All You Need',
            abstract: 'We propose a new simple Transformer architecture based on attention mechanisms.',
            year: 2017, venue: 'NeurIPS', url: 'https://example.com/1',
            citation_count: 100000, influence_score: 0.95,
            keywords_json: '["attention","transformer"]', concepts_json: '[]',
        },
        {
            source: 'openalex', source_id: 'W2', doi: '10.1234/test2',
            arxiv_id: null, title: 'BERT: Pre-training of Deep Bidirectional Transformers',
            abstract: 'We train BERT, a bidirectional Transformer for language understanding. Evaluated on GLUE, SQuAD, and SNLI benchmarks.',
            year: 2019, venue: 'NAACL', url: 'https://example.com/2',
            citation_count: 80000, influence_score: 0.9,
            keywords_json: '["bert","nlp"]', concepts_json: '[]',
        },
        {
            source: 'openalex', source_id: 'W3', doi: null,
            arxiv_id: '2010.12345', title: 'WaveNet: A Generative Model for Raw Audio',
            abstract: 'WaveNet produces raw audio with PESQ scores exceeding baselines on LibriSpeech.',
            year: 2016, venue: 'ICML', url: null,
            citation_count: 5000, influence_score: 0.5,
            keywords_json: null, concepts_json: null,
        },
    ]);

    db.insertEdges([
        {
            src_paper_id: 1, dst_paper_id: 2, type: EdgeType.CITES,
            weight: 1.0, confidence: 1.0, rationale: null, evidence: null,
            created_by: 'algo', provenance_json: '{}',
        },
        {
            src_paper_id: 2, dst_paper_id: 3, type: EdgeType.SIMILAR_TEXT,
            weight: 0.85, confidence: 0.85, rationale: null, evidence: null,
            created_by: 'algo', provenance_json: '{}',
        },
    ]);

    db.insertClusters(
        [
            { method: 'louvain', name: 'NLP Cluster', description: 'NLP papers', stats_json: '{}' },
        ],
        new Map([[0, [1, 2]]])
    );

    return db;
}

describe('Exporters', () => {
    let db: PaperGraphDatabase;

    beforeEach(() => {
        db = seedTestDb();
        db.close();
    });

    afterEach(() => {
        rmSync(TEST_DIR, { recursive: true, force: true });
    });

    it('should export to JSON', () => {
        const outPath = `${TEST_DIR}/out.json`;
        exportGraph(TEST_DB, outPath, 'json');
        expect(existsSync(outPath)).toBe(true);

        const data = JSON.parse(readFileSync(outPath, 'utf-8'));
        expect(data.papers).toHaveLength(3);
        expect(data.edges).toHaveLength(2);
        expect(data.clusters).toHaveLength(1);
        expect(data.papergraph.version).toBe('1.0.0');
    });

    it('should export to GraphML', () => {
        const outPath = `${TEST_DIR}/out.graphml`;
        exportGraph(TEST_DB, outPath, 'graphml');
        expect(existsSync(outPath)).toBe(true);

        const content = readFileSync(outPath, 'utf-8');
        expect(content).toContain('<graphml');
        expect(content).toContain('Attention Is All You Need');
        expect(content).toContain('<edge');
    });

    it('should export to GEXF', () => {
        const outPath = `${TEST_DIR}/out.gexf`;
        exportGraph(TEST_DB, outPath, 'gexf');
        expect(existsSync(outPath)).toBe(true);

        const content = readFileSync(outPath, 'utf-8');
        expect(content).toContain('<gexf');
        expect(content).toContain('PaperGraph');
        expect(content).toContain('<node');
    });

    it('should export to CSV', () => {
        const outPath = `${TEST_DIR}/out.csv`;
        exportGraph(TEST_DB, outPath, 'csv');
        expect(existsSync(outPath)).toBe(true);

        const content = readFileSync(outPath, 'utf-8');
        expect(content).toContain('paper_id,source,source_id');
        expect(content).toContain('Attention Is All You Need');
        expect(content).toContain('# EDGES');
    });

    it('should export to Mermaid', () => {
        const outPath = `${TEST_DIR}/out.md`;
        exportGraph(TEST_DB, outPath, 'mermaid');
        expect(existsSync(outPath)).toBe(true);

        const content = readFileSync(outPath, 'utf-8');
        expect(content).toContain('graph TD');
        expect(content).toContain('-->');
    });
});

describe('HTML Viewer', () => {
    let db: PaperGraphDatabase;

    beforeEach(() => {
        db = seedTestDb();
        db.close();
    });

    afterEach(() => {
        rmSync(TEST_DIR, { recursive: true, force: true });
    });

    it('should generate a self-contained HTML file', () => {
        const outPath = `${TEST_DIR}/viewer.html`;
        generateViewer(TEST_DB, outPath);
        expect(existsSync(outPath)).toBe(true);

        const content = readFileSync(outPath, 'utf-8');
        expect(content).toContain('<!DOCTYPE html>');
        expect(content).toContain('cytoscape');
        expect(content).toContain('PaperGraph');
        expect(content).toContain('3 papers');
        expect(content).toContain('2 edges');
    });
});

describe('Entity Extraction', () => {
    it('should extract known entities from paper text', () => {
        const paper: Paper = {
            paper_id: 1,
            source: 'openalex', source_id: 'W1', doi: null, arxiv_id: null,
            title: 'BERT: Pre-training of Deep Bidirectional Transformers',
            abstract: 'We evaluate BERT on GLUE and SQuAD benchmarks, achieving state-of-the-art F1 scores.',
            year: 2019, venue: 'NAACL', url: null,
            citation_count: 80000, influence_score: 0.9,
            keywords_json: null, concepts_json: null,
            created_at: '',
        };

        const results = extractEntities(paper);
        const names = results.map(r => r.entity.name);

        expect(names).toContain('BERT');
        expect(names).toContain('GLUE');
        expect(names).toContain('SQuAD');
        expect(names).toContain('F1');
        // Note: 'Transformer' is not matched because the title has 'Transformers' (plural)
        // and our regex uses word boundaries for exact matching
    });

    it('should extract dataset entities', () => {
        const paper: Paper = {
            paper_id: 2,
            source: 'openalex', source_id: 'W2', doi: null, arxiv_id: null,
            title: 'Speech Enhancement on LibriSpeech using WaveNet',
            abstract: 'We train on LibriSpeech and evaluate PESQ and STOI metrics.',
            year: 2020, venue: 'ICASSP', url: null,
            citation_count: 100, influence_score: 0.1,
            keywords_json: null, concepts_json: null,
            created_at: '',
        };

        const results = extractEntities(paper);
        const names = results.map(r => r.entity.name);

        expect(names).toContain('LibriSpeech');
        expect(names).toContain('WaveNet');
        expect(names).toContain('PESQ');
        expect(names).toContain('STOI');
    });

    it('should not duplicate extracted entities', () => {
        const paper: Paper = {
            paper_id: 3,
            source: 'openalex', source_id: 'W3', doi: null, arxiv_id: null,
            title: 'BERT for BERT tasks',
            abstract: 'We use BERT with BERT embeddings.',
            year: 2020, venue: '', url: null,
            citation_count: 0, influence_score: 0,
            keywords_json: null, concepts_json: null,
            created_at: '',
        };

        const results = extractEntities(paper);
        const bertCount = results.filter(r => r.entity.name === 'BERT').length;
        expect(bertCount).toBe(1);
    });

    it('should extract entities from multiple papers for batch insertion', () => {
        const papers: Paper[] = [
            {
                paper_id: 1, source: 'openalex', source_id: 'W1', doi: null, arxiv_id: null,
                title: 'ResNet for ImageNet Classification',
                abstract: 'We train ResNet on ImageNet and achieve top-1 accuracy.',
                year: 2015, venue: 'CVPR', url: null,
                citation_count: 50000, influence_score: 0.8,
                keywords_json: null, concepts_json: null, created_at: '',
            },
            {
                paper_id: 2, source: 'openalex', source_id: 'W2', doi: null, arxiv_id: null,
                title: 'ViT: Vision Transformer on CIFAR-10',
                abstract: 'Visual Transformer evaluated with Accuracy and mAP.',
                year: 2021, venue: 'ICLR', url: null,
                citation_count: 20000, influence_score: 0.7,
                keywords_json: null, concepts_json: null, created_at: '',
            },
        ];

        const { entities, paperLinks } = extractAllEntities(papers);

        expect(entities.length).toBeGreaterThan(0);
        expect(paperLinks.length).toBeGreaterThan(0);

        // Check that both papers have links
        const paper1Links = paperLinks.filter(l => l.paperId === 1);
        const paper2Links = paperLinks.filter(l => l.paperId === 2);
        expect(paper1Links.length).toBeGreaterThan(0);
        expect(paper2Links.length).toBeGreaterThan(0);
    });
});

describe('Response Cache', () => {
    let cache: ResponseCache;

    beforeEach(() => {
        mkdirSync(TEST_DIR, { recursive: true });
        cache = new ResponseCache({ cacheDir: TEST_CACHE, enabled: true, ttlHours: 1 });
    });

    afterEach(() => {
        rmSync(TEST_DIR, { recursive: true, force: true });
    });

    it('should store and retrieve cached data', () => {
        const url = 'https://api.example.com/test';
        const data = { papers: [{ id: 1, title: 'Test Paper' }] };

        cache.set(url, data);
        const result = cache.get<typeof data>(url);

        expect(result).toEqual(data);
    });

    it('should return null for cache miss', () => {
        const result = cache.get('https://api.example.com/missing');
        expect(result).toBeNull();
    });

    it('should report cache stats', () => {
        const stats = cache.getStats();
        expect(stats.enabled).toBe(true);
        expect(stats.directory).toBe(TEST_CACHE);
    });

    it('should return null when disabled', () => {
        const disabledCache = new ResponseCache({ enabled: false });
        disabledCache.set('https://test.com', { data: 1 });
        expect(disabledCache.get('https://test.com')).toBeNull();
    });

    it('should report has() correctly', () => {
        const url = 'https://api.example.com/has-test';
        expect(cache.has(url)).toBe(false);
        cache.set(url, 'test-data');
        expect(cache.has(url)).toBe(true);
    });
});

describe('Database - updatePaperScore', () => {
    let db: PaperGraphDatabase;

    beforeEach(() => {
        db = seedTestDb();
    });

    afterEach(() => {
        db.close();
        rmSync(TEST_DIR, { recursive: true, force: true });
    });

    it('should update paper influence score', () => {
        db.updatePaperScore(1, 0.999);
        const paper = db.getPaperById(1);
        expect(paper?.influence_score).toBe(0.999);
    });

    it('should not affect other papers', () => {
        db.updatePaperScore(1, 0.123);
        const paper2 = db.getPaperById(2);
        expect(paper2?.influence_score).toBe(0.9); // Original value
    });
});
