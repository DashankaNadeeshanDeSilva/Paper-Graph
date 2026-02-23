/**
 * Barrel export for all shared types.
 */
export type { Paper, PaperSource, Author, PaperAuthor, RawPaperData } from './paper.js';
export { EdgeType, CORE_EDGE_TYPES, LLM_EDGE_TYPES } from './edge.js';
export type { Edge, EdgeCreator } from './edge.js';
export type { Cluster, PaperCluster } from './cluster.js';
export type { Entity, PaperEntity, EntityType, EntityRole } from './entity.js';
export { DEFAULT_CONFIG } from './config.js';
export type {
    PaperGraphConfig,
    SpineType,
    LogLevel,
    LlmTask,
    LlmConfig,
    SimilarityConfig,
    ClusteringConfig,
    RankingConfig,
    RunRecord,
} from './config.js';
export type { SourceAdapter, SourceAdapterOptions } from './source-adapter.js';
export type {
    LlmProvider,
    LlmCompletionParams,
    LlmCompletionResult,
    LlmProviderOptions,
} from './llm-provider.js';
