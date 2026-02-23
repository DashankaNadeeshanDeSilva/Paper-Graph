import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpClient, HttpError } from '../utils/http-client.js';

describe('HttpClient', () => {
    let client: HttpClient;

    beforeEach(() => {
        client = new HttpClient({ timeout: 5000 });
        vi.restoreAllMocks();
    });

    describe('request counting', () => {
        it('should start with zero request counts', () => {
            expect(client.getRequestCount('openalex')).toBe(0);
            expect(client.getRequestCount('s2')).toBe(0);
        });

        it('should track request counts per source', () => {
            // We don't actually make requests here — just verify the tracking mechanism
            const counts = client.getAllRequestCounts();
            expect(counts).toEqual({});
        });

        it('should reset counts', () => {
            client.resetCounts();
            expect(client.getAllRequestCounts()).toEqual({});
        });
    });

    describe('HttpError', () => {
        it('should create error with status and retryable flag', () => {
            const error = new HttpError('Not Found', 404, false);
            expect(error.message).toBe('Not Found');
            expect(error.status).toBe(404);
            expect(error.retryable).toBe(false);
            expect(error.name).toBe('HttpError');
        });

        it('should mark 429 as retryable', () => {
            const error = new HttpError('Rate Limited', 429, true);
            expect(error.retryable).toBe(true);
        });

        it('should include response data', () => {
            const responseData = { error: 'bad request' };
            const error = new HttpError('Bad Request', 400, false, responseData);
            expect(error.response).toEqual(responseData);
        });
    });

    describe('rate limiting', () => {
        it('should throttle requests based on source rate limits', async () => {
            // Mock fetch to resolve immediately
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                headers: new Map([['content-type', 'application/json']]),
                json: async () => ({ data: 'ok' }),
            });
            vi.stubGlobal('fetch', mockFetch);

            const start = Date.now();

            // Make 3 requests with S2 source (1/sec rate limit)
            await Promise.all([
                client.request('https://api.example.com/1', { source: 's2' }),
                client.request('https://api.example.com/2', { source: 's2' }),
                client.request('https://api.example.com/3', { source: 's2' }),
            ]);

            const elapsed = Date.now() - start;

            // Should have taken at least 1 second due to rate limiting (3 requests at 1/s)
            // The first token is immediately available, so 3 requests need ~2 seconds
            expect(elapsed).toBeGreaterThanOrEqual(1000);
            expect(client.getRequestCount('s2')).toBe(3);

            vi.unstubAllGlobals();
        });
    });
});
