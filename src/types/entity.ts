/**
 * Entity types that PaperGraph can extract.
 */
export type EntityType = 'dataset' | 'method' | 'task' | 'metric';

/**
 * Entity roles — how a paper relates to an entity.
 */
export type EntityRole = 'uses' | 'introduces' | 'benchmarks';

/**
 * Entity interface — represents an extracted named entity
 * (dataset, method, task, or metric).
 */
export interface Entity {
    /** Internal auto-increment ID (SQLite rowid) */
    entity_id?: number;

    /** Entity type */
    type: EntityType;

    /** Canonical entity name */
    name: string;

    /** Known aliases as JSON array string */
    aliases_json: string;
}

/**
 * Junction table: links a paper to an entity with a role.
 */
export interface PaperEntity {
    paper_id: number;
    entity_id: number;
    role: EntityRole;
}
