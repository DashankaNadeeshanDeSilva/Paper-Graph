import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { getLogger } from '../utils/logger.js';

const logger = getLogger();

/**
 * Simple file-system cache for API responses.
 * Stores JSON files in a configurable cache directory.
 *
 * Cache key = SHA-256 of URL + params.
 * TTL = 24 hours by default.
 */
export class ResponseCache {
    private cacheDir: string;
    private ttlMs: number;
    private enabled: boolean;

    constructor(options: {
        cacheDir?: string;
        ttlHours?: number;
        enabled?: boolean;
    } = {}) {
        this.cacheDir = options.cacheDir ?? '.papergraph-cache';
        this.ttlMs = (options.ttlHours ?? 24) * 60 * 60 * 1000;
        this.enabled = options.enabled ?? true;

        if (this.enabled) {
            mkdirSync(this.cacheDir, { recursive: true });
            logger.debug({ cacheDir: this.cacheDir }, 'Cache initialized');
        }
    }

    /**
     * Generate a deterministic cache key from a URL.
     */
    private makeKey(url: string): string {
        return createHash('sha256').update(url).digest('hex');
    }

    /**
     * Get a cached response, or null if not found/expired.
     */
    get<T>(url: string): T | null {
        if (!this.enabled) return null;

        const key = this.makeKey(url);
        const filePath = join(this.cacheDir, `${key}.json`);

        if (!existsSync(filePath)) return null;

        try {
            const raw = readFileSync(filePath, 'utf-8');
            const entry = JSON.parse(raw) as { timestamp: number; data: T };

            // Check TTL
            if (Date.now() - entry.timestamp > this.ttlMs) {
                logger.debug({ url: url.slice(0, 80) }, 'Cache expired');
                return null;
            }

            logger.debug({ url: url.slice(0, 80) }, 'Cache hit');
            return entry.data;
        } catch {
            return null;
        }
    }

    /**
     * Store a response in the cache.
     */
    set<T>(url: string, data: T): void {
        if (!this.enabled) return;

        const key = this.makeKey(url);
        const filePath = join(this.cacheDir, `${key}.json`);

        try {
            const entry = {
                timestamp: Date.now(),
                url: url.slice(0, 200), // Store truncated URL for debugging
                data,
            };
            writeFileSync(filePath, JSON.stringify(entry), 'utf-8');
        } catch (error) {
            logger.warn({ error }, 'Failed to write cache entry');
        }
    }

    /**
     * Check if a URL is cached and not expired.
     */
    has(url: string): boolean {
        return this.get(url) !== null;
    }

    /**
     * Get cache stats.
     */
    getStats(): { enabled: boolean; directory: string } {
        return {
            enabled: this.enabled,
            directory: this.cacheDir,
        };
    }
}
