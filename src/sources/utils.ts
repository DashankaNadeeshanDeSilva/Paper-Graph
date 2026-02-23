/**
 * Shared utilities for source adapters.
 */

/**
 * Reconstruct abstract text from OpenAlex inverted index format.
 *
 * OpenAlex stores abstracts as inverted indexes: { "word": [position1, position2], ... }
 * This function reconstructs the original text.
 *
 * @param invertedIndex - The inverted index object or null
 * @returns Reconstructed abstract text or null
 */
export function invertedIndexToText(
    invertedIndex: Record<string, number[]> | null | undefined
): string | null {
    if (!invertedIndex || typeof invertedIndex !== 'object') {
        return null;
    }

    try {
        const words: Array<[number, string]> = [];

        for (const [word, positions] of Object.entries(invertedIndex)) {
            if (!Array.isArray(positions)) continue;
            for (const pos of positions) {
                if (typeof pos === 'number' && pos >= 0) {
                    words.push([pos, word]);
                }
            }
        }

        if (words.length === 0) return null;

        // Sort by position
        words.sort((a, b) => a[0] - b[0]);

        return words.map(([, word]) => word).join(' ');
    } catch {
        return null;
    }
}

/**
 * Strip DOI prefix URLs to get just the DOI identifier.
 * "https://doi.org/10.1234/test" → "10.1234/test"
 */
export function stripDoiPrefix(doi: string | null | undefined): string | null {
    if (!doi) return null;
    return doi
        .replace('https://doi.org/', '')
        .replace('http://doi.org/', '')
        .trim() || null;
}

/**
 * Extract arXiv ID from various formats.
 * "https://arxiv.org/abs/2401.01234" → "2401.01234"
 * "arXiv:2401.01234" → "2401.01234"
 * "2401.01234v2" → "2401.01234v2"
 */
export function extractArxivId(input: string | null | undefined): string | null {
    if (!input) return null;

    const patterns = [
        /arxiv\.org\/abs\/(\d{4}\.\d{4,5}(?:v\d+)?)/i,
        /arxiv:(\d{4}\.\d{4,5}(?:v\d+)?)/i,
        /^(\d{4}\.\d{4,5}(?:v\d+)?)$/,
    ];

    for (const pattern of patterns) {
        const match = input.match(pattern);
        if (match?.[1]) return match[1];
    }

    return null;
}

/**
 * Clean and normalize a paper title for comparison.
 */
export function normalizeTitle(title: string): string {
    return title
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')  // Remove punctuation
        .replace(/\s+/g, ' ')      // Collapse whitespace
        .trim();
}

/**
 * Simple Levenshtein distance for title matching.
 */
export function levenshteinDistance(a: string, b: string): number {
    const m = a.length;
    const n = b.length;

    if (m === 0) return n;
    if (n === 0) return m;

    const dp: number[][] = Array.from({ length: m + 1 }, () =>
        Array.from({ length: n + 1 }, () => 0)
    );

    for (let i = 0; i <= m; i++) dp[i]![0] = i;
    for (let j = 0; j <= n; j++) dp[0]![j] = j;

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i]![j] = Math.min(
                dp[i - 1]![j]! + 1,      // deletion
                dp[i]![j - 1]! + 1,      // insertion
                dp[i - 1]![j - 1]! + cost // substitution
            );
        }
    }

    return dp[m]![n]!;
}

/**
 * Compute normalized Levenshtein similarity (0.0 to 1.0).
 * 1.0 = identical, 0.0 = completely different.
 */
export function titleSimilarity(a: string, b: string): number {
    const normA = normalizeTitle(a);
    const normB = normalizeTitle(b);

    if (normA === normB) return 1.0;

    const maxLen = Math.max(normA.length, normB.length);
    if (maxLen === 0) return 1.0;

    const distance = levenshteinDistance(normA, normB);
    return 1.0 - distance / maxLen;
}
