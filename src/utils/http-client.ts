import { getLogger } from './logger.js';

const logger = getLogger();

/**
 * Error classification for HTTP responses.
 */
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const RETRYABLE_ERROR_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT']);

/**
 * Token bucket rate limiter.
 * Allows `tokensPerSecond` requests per second with burst capacity.
 */
class TokenBucket {
    private tokens: number;
    private lastRefill: number;

    constructor(
        private readonly tokensPerSecond: number,
        private readonly maxTokens: number
    ) {
        this.tokens = maxTokens;
        this.lastRefill = Date.now();
    }

    async acquire(): Promise<void> {
        this.refill();

        if (this.tokens >= 1) {
            this.tokens -= 1;
            return;
        }

        // Wait until a token is available
        const waitMs = ((1 - this.tokens) / this.tokensPerSecond) * 1000;
        await sleep(waitMs);
        this.refill();
        this.tokens -= 1;
    }

    private refill(): void {
        const now = Date.now();
        const elapsed = (now - this.lastRefill) / 1000;
        this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.tokensPerSecond);
        this.lastRefill = now;
    }
}

/**
 * Per-source rate limit configurations.
 */
const RATE_LIMITS: Record<string, { tokensPerSecond: number; maxBurst: number }> = {
    openalex: { tokensPerSecond: 10, maxBurst: 10 },  // 10/s with polite pool
    s2: { tokensPerSecond: 1, maxBurst: 1 },           // 1/s without API key, 10/s with
    openai: { tokensPerSecond: 5, maxBurst: 5 },
    ollama: { tokensPerSecond: 100, maxBurst: 100 },   // Local — effectively unlimited
    default: { tokensPerSecond: 5, maxBurst: 5 },
};

/**
 * HTTP request options.
 */
export interface HttpRequestOptions {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    headers?: Record<string, string>;
    body?: string | object;
    timeout?: number;
    source?: string;  // For per-source rate limiting
}

/**
 * HTTP response wrapper.
 */
export interface HttpResponse<T = unknown> {
    status: number;
    headers: Record<string, string>;
    data: T;
    ok: boolean;
}

/**
 * HTTP error with classification.
 */
export class HttpError extends Error {
    constructor(
        message: string,
        public readonly status: number,
        public readonly retryable: boolean,
        public readonly response?: unknown
    ) {
        super(message);
        this.name = 'HttpError';
    }
}

/**
 * Centralized HTTP client with per-source rate limiting and retry logic.
 */
export class HttpClient {
    private buckets = new Map<string, TokenBucket>();
    private requestCounts = new Map<string, number>();
    private readonly defaultTimeout: number;
    private readonly userAgent: string;

    constructor(options?: { timeout?: number; version?: string; email?: string }) {
        this.defaultTimeout = options?.timeout ?? 30000;
        const version = options?.version ?? '1.0.0';
        const email = options?.email ?? 'papergraph@example.com';
        this.userAgent = `PaperGraph/${version} (mailto:${email})`;
    }

    /**
     * Make an HTTP request with rate limiting and retry.
     */
    async request<T = unknown>(url: string, options: HttpRequestOptions = {}): Promise<HttpResponse<T>> {
        const {
            method = 'GET',
            headers = {},
            body,
            timeout = this.defaultTimeout,
            source = 'default',
        } = options;

        // Acquire rate limit token
        const bucket = this.getBucket(source);
        await bucket.acquire();

        // Track request count
        this.requestCounts.set(source, (this.requestCounts.get(source) ?? 0) + 1);

        // Build request options
        const requestHeaders: Record<string, string> = {
            'User-Agent': this.userAgent,
            ...headers,
        };

        let requestBody: string | undefined;
        if (body) {
            if (typeof body === 'object') {
                requestBody = JSON.stringify(body);
                requestHeaders['Content-Type'] = requestHeaders['Content-Type'] ?? 'application/json';
            } else {
                requestBody = body;
            }
        }

        // Retry loop
        const maxRetries = 3;
        const initialBackoff = 1000;
        const maxBackoff = 30000;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), timeout);

                const response = await fetch(url, {
                    method,
                    headers: requestHeaders,
                    body: requestBody,
                    signal: controller.signal,
                });

                clearTimeout(timeoutId);

                // Parse response
                const contentType = response.headers.get('content-type') ?? '';
                let data: T;
                if (contentType.includes('application/json')) {
                    data = (await response.json()) as T;
                } else {
                    data = (await response.text()) as T;
                }

                // Build headers map
                const responseHeaders: Record<string, string> = {};
                response.headers.forEach((value, key) => {
                    responseHeaders[key] = value;
                });

                // Check for errors
                if (!response.ok) {
                    const retryable = RETRYABLE_STATUS_CODES.has(response.status);

                    if (retryable && attempt < maxRetries) {
                        const retryAfter = this.parseRetryAfter(response.headers.get('retry-after'));
                        const backoff = retryAfter ?? this.calculateBackoff(attempt, initialBackoff, maxBackoff);

                        logger.warn(
                            { status: response.status, attempt: attempt + 1, backoffMs: backoff, url },
                            `Retryable HTTP error, backing off`
                        );
                        await sleep(backoff);
                        continue;
                    }

                    throw new HttpError(
                        `HTTP ${response.status}: ${response.statusText}`,
                        response.status,
                        retryable,
                        data
                    );
                }

                return { status: response.status, headers: responseHeaders, data, ok: true };
            } catch (error) {
                if (error instanceof HttpError) throw error;

                const errorCode = (error as NodeJS.ErrnoException).code;
                const retryable = errorCode ? RETRYABLE_ERROR_CODES.has(errorCode) : false;

                if (retryable && attempt < maxRetries) {
                    const backoff = this.calculateBackoff(attempt, initialBackoff, maxBackoff);
                    logger.warn(
                        { errorCode, attempt: attempt + 1, backoffMs: backoff, url },
                        `Retryable network error, backing off`
                    );
                    await sleep(backoff);
                    continue;
                }

                if (error instanceof Error && error.name === 'AbortError') {
                    throw new HttpError(`Request timeout after ${timeout}ms: ${url}`, 0, true);
                }

                throw new HttpError(
                    `Network error: ${error instanceof Error ? error.message : String(error)}`,
                    0,
                    retryable
                );
            }
        }

        // Should never reach here, but TypeScript needs it
        throw new HttpError(`Max retries exceeded for ${url}`, 0, false);
    }

    /**
     * Convenience method for GET requests.
     */
    async get<T = unknown>(url: string, options?: Omit<HttpRequestOptions, 'method'>): Promise<HttpResponse<T>> {
        return this.request<T>(url, { ...options, method: 'GET' });
    }

    /**
     * Convenience method for POST requests.
     */
    async post<T = unknown>(url: string, body: unknown, options?: Omit<HttpRequestOptions, 'method' | 'body'>): Promise<HttpResponse<T>> {
        return this.request<T>(url, { ...options, method: 'POST', body: body as string | object });
    }

    /**
     * Get request count for a source.
     */
    getRequestCount(source: string): number {
        return this.requestCounts.get(source) ?? 0;
    }

    /**
     * Get all request counts.
     */
    getAllRequestCounts(): Record<string, number> {
        return Object.fromEntries(this.requestCounts.entries());
    }

    /**
     * Reset request counts.
     */
    resetCounts(): void {
        this.requestCounts.clear();
    }

    private getBucket(source: string): TokenBucket {
        if (!this.buckets.has(source)) {
            const config = RATE_LIMITS[source] ?? RATE_LIMITS['default']!;
            this.buckets.set(source, new TokenBucket(config.tokensPerSecond, config.maxBurst));
        }
        return this.buckets.get(source)!;
    }

    private parseRetryAfter(header: string | null): number | null {
        if (!header) return null;

        // Try parsing as seconds
        const seconds = parseInt(header, 10);
        if (!isNaN(seconds)) return seconds * 1000;

        // Try parsing as HTTP date
        const date = new Date(header);
        if (!isNaN(date.getTime())) {
            return Math.max(0, date.getTime() - Date.now());
        }

        return null;
    }

    private calculateBackoff(attempt: number, initial: number, max: number): number {
        // Exponential backoff with jitter
        const exponential = initial * Math.pow(2, attempt);
        const jitter = Math.random() * exponential * 0.5;
        return Math.min(max, exponential + jitter);
    }
}

/**
 * Sleep for the specified number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Singleton HTTP client instance.
 */
let clientInstance: HttpClient | null = null;

/**
 * Get the shared HTTP client instance.
 */
export function getHttpClient(options?: { timeout?: number; version?: string; email?: string }): HttpClient {
    if (!clientInstance) {
        clientInstance = new HttpClient(options);
    }
    return clientInstance;
}

/**
 * Create a new HTTP client (for testing or custom configuration).
 */
export function createHttpClient(options?: { timeout?: number; version?: string; email?: string }): HttpClient {
    return new HttpClient(options);
}
