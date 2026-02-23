import { cosmiconfig } from 'cosmiconfig';
import { DEFAULT_CONFIG, type PaperGraphConfig } from '../types/index.js';
import { getLogger } from './logger.js';

/**
 * Load configuration from papergraph.config.json using cosmiconfig.
 * Returns null if no config file is found (which is fine — defaults are used).
 */
async function loadConfigFile(): Promise<Partial<PaperGraphConfig> | null> {
    const explorer = cosmiconfig('papergraph', {
        searchPlaces: ['papergraph.config.json'],
    });

    try {
        const result = await explorer.search();
        if (result && !result.isEmpty) {
            getLogger().debug({ path: result.filepath }, 'Loaded config file');
            return result.config as Partial<PaperGraphConfig>;
        }
    } catch (error) {
        getLogger().warn({ error }, 'Failed to load config file, using defaults');
    }

    return null;
}

/**
 * Read relevant environment variables.
 */
function loadEnvVars(): Partial<PaperGraphConfig> {
    const env: Partial<PaperGraphConfig> = {};

    // API keys are accessed directly where needed (not stored in config)
    // But LLM enabled state can be inferred from env
    if (process.env['OPENAI_API_KEY'] && !process.env['LLM_DISABLE']) {
        // OpenAI key available — don't auto-enable, just note it
        getLogger().debug('OPENAI_API_KEY detected in environment');
    }

    return env;
}

/**
 * Merge configuration from multiple sources.
 * Precedence: CLI flags > environment variables > config file > defaults
 */
export async function resolveConfig(
    cliFlags: Partial<PaperGraphConfig>
): Promise<PaperGraphConfig> {
    const fileConfig = await loadConfigFile();
    const envConfig = loadEnvVars();

    // Deep merge with precedence
    const merged: PaperGraphConfig = {
        ...DEFAULT_CONFIG,
        out: './papergraph.db',
        ...fileConfig,
        ...envConfig,
        ...cliFlags,
        // Deep merge nested objects
        similarity: {
            ...DEFAULT_CONFIG.similarity,
            ...fileConfig?.similarity,
            ...cliFlags.similarity,
        },
        clustering: {
            ...DEFAULT_CONFIG.clustering,
            ...fileConfig?.clustering,
            ...cliFlags.clustering,
        },
        ranking: {
            ...DEFAULT_CONFIG.ranking,
            ...fileConfig?.ranking,
            ...cliFlags.ranking,
        },
        llm: {
            ...DEFAULT_CONFIG.llm,
            ...fileConfig?.llm,
            ...cliFlags.llm,
        },
    };

    return merged;
}

/**
 * Get API key from environment variable.
 * @param name - Environment variable name
 * @returns The API key or undefined
 */
export function getApiKey(name: string): string | undefined {
    return process.env[name];
}
