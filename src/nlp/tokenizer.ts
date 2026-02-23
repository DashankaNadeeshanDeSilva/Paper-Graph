import { STOPWORDS } from './stopwords.js';

/**
 * Tokenize text into an array of lowercase tokens.
 * - Lowercase
 * - Split on whitespace and punctuation
 * - Remove stopwords
 * - Remove single-character tokens
 * - No stemming (deterministic)
 */
export function tokenize(text: string): string[] {
    if (!text) return [];

    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')  // Remove non-alphanumeric except hyphens
        .split(/\s+/)
        .map((token) => token.replace(/^-+|-+$/g, ''))  // Trim hyphens at edges
        .filter((token) =>
            token.length > 1 &&
            !STOPWORDS.has(token) &&
            !/^\d+$/.test(token)  // Remove pure numbers
        );
}
