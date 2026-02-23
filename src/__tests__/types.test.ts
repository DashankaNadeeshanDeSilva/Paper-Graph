import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, EdgeType, CORE_EDGE_TYPES, LLM_EDGE_TYPES } from '../types/index.js';

describe('Types', () => {
    describe('EdgeType', () => {
        it('should have 16 edge types', () => {
            const allTypes = Object.values(EdgeType);
            expect(allTypes).toHaveLength(16);
        });

        it('should have 8 core edge types', () => {
            expect(CORE_EDGE_TYPES.size).toBe(8);
        });

        it('should have 8 LLM edge types', () => {
            expect(LLM_EDGE_TYPES.size).toBe(8);
        });

        it('core and LLM edge types should not overlap', () => {
            for (const t of CORE_EDGE_TYPES) {
                expect(LLM_EDGE_TYPES.has(t)).toBe(false);
            }
        });

        it('core + LLM edge types should cover all EdgeType values', () => {
            const allTypes = new Set(Object.values(EdgeType));
            const combined = new Set([...CORE_EDGE_TYPES, ...LLM_EDGE_TYPES]);
            expect(combined).toEqual(allTypes);
        });
    });

    describe('DEFAULT_CONFIG', () => {
        it('should have default source as openalex', () => {
            expect(DEFAULT_CONFIG.source).toBe('openalex');
        });

        it('should have default spine as citation', () => {
            expect(DEFAULT_CONFIG.spine).toBe('citation');
        });

        it('should have depth 2 by default', () => {
            expect(DEFAULT_CONFIG.depth).toBe(2);
        });

        it('should have maxPapers 150 by default', () => {
            expect(DEFAULT_CONFIG.maxPapers).toBe(150);
        });

        it('should have LLM disabled by default', () => {
            expect(DEFAULT_CONFIG.llm.enabled).toBe(false);
        });

        it('ranking weights should sum to 1.0', () => {
            const { pagerankWeight, relevanceWeight, recencyWeight } = DEFAULT_CONFIG.ranking;
            expect(pagerankWeight + relevanceWeight + recencyWeight).toBeCloseTo(1.0);
        });
    });
});
