import { describe, it, expect } from 'vitest';
import { invertedIndexToText, stripDoiPrefix, extractArxivId, normalizeTitle, titleSimilarity } from '../sources/utils.js';
import { tokenize } from '../nlp/tokenizer.js';
import { buildCorpus, getTopTerms } from '../nlp/tfidf.js';
import { cosineSimilarity, findTopKSimilar, buildSimilarityEdges } from '../nlp/similarity.js';
import type { Paper } from '../types/index.js';

describe('Source Utils', () => {
    describe('invertedIndexToText', () => {
        it('should reconstruct simple text from inverted index', () => {
            const result = invertedIndexToText({ 'This': [0], 'is': [1], 'a': [2], 'test': [3] });
            expect(result).toBe('This is a test');
        });

        it('should handle out-of-order positions', () => {
            const result = invertedIndexToText({ 'world': [1], 'Hello': [0] });
            expect(result).toBe('Hello world');
        });

        it('should handle null input', () => {
            expect(invertedIndexToText(null)).toBeNull();
            expect(invertedIndexToText(undefined)).toBeNull();
        });

        it('should handle empty object', () => {
            expect(invertedIndexToText({})).toBeNull();
        });

        it('should handle repeated words', () => {
            const result = invertedIndexToText({ 'the': [0, 3], 'cat': [1], 'chased': [2], 'mouse': [4] });
            expect(result).toBe('the cat chased the mouse');
        });
    });

    describe('stripDoiPrefix', () => {
        it('should strip https://doi.org/ prefix', () => {
            expect(stripDoiPrefix('https://doi.org/10.1234/test')).toBe('10.1234/test');
        });

        it('should handle null', () => {
            expect(stripDoiPrefix(null)).toBeNull();
        });

        it('should handle plain DOI', () => {
            expect(stripDoiPrefix('10.1234/test')).toBe('10.1234/test');
        });
    });

    describe('extractArxivId', () => {
        it('should extract from URL', () => {
            expect(extractArxivId('https://arxiv.org/abs/2401.01234')).toBe('2401.01234');
        });

        it('should extract from arxiv: prefix', () => {
            expect(extractArxivId('arXiv:2401.01234')).toBe('2401.01234');
        });

        it('should extract with version', () => {
            expect(extractArxivId('2401.01234v2')).toBe('2401.01234v2');
        });

        it('should handle null', () => {
            expect(extractArxivId(null)).toBeNull();
        });
    });

    describe('titleSimilarity', () => {
        it('should return 1.0 for identical titles', () => {
            expect(titleSimilarity('Attention Is All You Need', 'Attention Is All You Need')).toBe(1.0);
        });

        it('should return 1.0 for case-insensitive match', () => {
            expect(titleSimilarity('attention is all you need', 'ATTENTION IS ALL YOU NEED')).toBe(1.0);
        });

        it('should return high similarity for near matches', () => {
            const sim = titleSimilarity('Attention Is All You Need', 'Attention Is All We Need');
            expect(sim).toBeGreaterThan(0.85);
        });

        it('should return low similarity for different titles', () => {
            const sim = titleSimilarity('Attention Is All You Need', 'ImageNet Classification with Deep CNNs');
            expect(sim).toBeLessThan(0.5);
        });
    });
});

describe('NLP Pipeline', () => {
    describe('tokenizer', () => {
        it('should tokenize and lowercase', () => {
            const tokens = tokenize('Hello World');
            expect(tokens).toEqual(['hello', 'world']);
        });

        it('should remove stopwords', () => {
            const tokens = tokenize('The quick brown fox jumps over the lazy dog');
            expect(tokens).not.toContain('the');
            expect(tokens).not.toContain('over');
            expect(tokens).toContain('quick');
            expect(tokens).toContain('brown');
        });

        it('should handle empty input', () => {
            expect(tokenize('')).toEqual([]);
        });

        it('should remove punctuation', () => {
            const tokens = tokenize("speech: extraction, (using) transformers!");
            expect(tokens).toContain('speech');
            expect(tokens).toContain('extraction');
            expect(tokens).toContain('transformers');
        });
    });

    describe('TF-IDF', () => {
        const testPapers: Paper[] = [
            { source: 'openalex', source_id: 'p1', doi: null, arxiv_id: null, title: 'Deep Learning for Speech Recognition', abstract: 'Neural networks improve speech recognition accuracy', year: 2020, venue: null, url: null, citation_count: 100, influence_score: null, keywords_json: null, concepts_json: null },
            { source: 'openalex', source_id: 'p2', doi: null, arxiv_id: null, title: 'Speech Enhancement Using Transformers', abstract: 'Transformer architecture enhances speech quality', year: 2021, venue: null, url: null, citation_count: 50, influence_score: null, keywords_json: null, concepts_json: null },
            { source: 'openalex', source_id: 'p3', doi: null, arxiv_id: null, title: 'Image Classification with CNNs', abstract: 'Convolutional networks for image recognition tasks', year: 2019, venue: null, url: null, citation_count: 200, influence_score: null, keywords_json: null, concepts_json: null },
        ];

        it('should build a corpus from papers', () => {
            const corpus = buildCorpus(testPapers);
            expect(corpus.size).toBe(3);
            expect(corpus.documents.size).toBe(3);
        });

        it('should handle papers with null abstracts', () => {
            const papersWithNull = [
                ...testPapers,
                { source: 'openalex' as const, source_id: 'p4', doi: null, arxiv_id: null, title: 'Null Abstract Paper', abstract: null, year: 2022, venue: null, url: null, citation_count: 10, influence_score: null, keywords_json: null, concepts_json: null },
            ];
            const corpus = buildCorpus(papersWithNull);
            expect(corpus.size).toBe(4);
        });

        it('should produce deterministic results', () => {
            const corpus1 = buildCorpus(testPapers);
            const corpus2 = buildCorpus(testPapers);

            // Vectors should be identical
            for (const [docId, vec1] of corpus1.documents) {
                const vec2 = corpus2.documents.get(docId)!;
                for (const [term, weight1] of vec1) {
                    expect(vec2.get(term)).toBe(weight1);
                }
            }
        });

        it('should extract meaningful top terms', () => {
            const corpus = buildCorpus(testPapers);
            const terms = getTopTerms(corpus, ['p1', 'p2'], 5);
            expect(terms.length).toBeGreaterThan(0);
            expect(terms).toContain('speech');
        });
    });

    describe('Cosine Similarity', () => {
        it('should return 1.0 for identical vectors', () => {
            const vec = new Map([['a', 1.0], ['b', 2.0]]);
            expect(cosineSimilarity(vec, vec)).toBeCloseTo(1.0);
        });

        it('should return 0 for orthogonal vectors', () => {
            const vecA = new Map([['a', 1.0]]);
            const vecB = new Map([['b', 1.0]]);
            expect(cosineSimilarity(vecA, vecB)).toBe(0);
        });

        it('should be between 0 and 1', () => {
            const vecA = new Map([['a', 1.0], ['b', 2.0]]);
            const vecB = new Map([['a', 0.5], ['c', 1.0]]);
            const sim = cosineSimilarity(vecA, vecB);
            expect(sim).toBeGreaterThanOrEqual(0);
            expect(sim).toBeLessThanOrEqual(1);
        });

        it('should return 0 for empty vectors', () => {
            expect(cosineSimilarity(new Map(), new Map())).toBe(0);
        });
    });

    describe('Similarity Edges', () => {
        it('should build edges above threshold', () => {
            const testPapers: Paper[] = [
                { source: 'openalex', source_id: 'p1', doi: null, arxiv_id: null, title: 'Deep Learning Speech', abstract: 'Neural network speech recognition', year: 2020, venue: null, url: null, citation_count: 10, influence_score: null, keywords_json: null, concepts_json: null },
                { source: 'openalex', source_id: 'p2', doi: null, arxiv_id: null, title: 'Deep Learning Speech Enhancement', abstract: 'Neural network speech enhancement', year: 2021, venue: null, url: null, citation_count: 20, influence_score: null, keywords_json: null, concepts_json: null },
                { source: 'openalex', source_id: 'p3', doi: null, arxiv_id: null, title: 'Quantum Computing Overview', abstract: 'Qubits and quantum gates', year: 2022, venue: null, url: null, citation_count: 5, influence_score: null, keywords_json: null, concepts_json: null },
            ];

            const corpus = buildCorpus(testPapers);
            const paperIdMap = new Map([['p1', 1], ['p2', 2], ['p3', 3]]);

            const edges = buildSimilarityEdges(paperIdMap, corpus, 5, 0.1);
            // Speech papers should be connected; quantum should be separate
            expect(edges.length).toBeGreaterThan(0);
            expect(edges.every((e) => e.type === 'SIMILAR_TEXT')).toBe(true);
            expect(edges.every((e) => e.weight >= 0.1)).toBe(true);
        });
    });
});
