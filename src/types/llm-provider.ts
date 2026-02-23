/**
 * Interface for LLM provider adapters (OpenAI, Ollama, etc.).
 */
export interface LlmProvider {
    /** Provider name */
    readonly name: string;

    /** Whether this provider supports structured JSON output */
    readonly supportsStructuredOutput: boolean;

    /**
     * Send a completion request to the LLM.
     * @param prompt - The prompt to send
     * @param params - Additional parameters (temperature, max_tokens, etc.)
     * @returns The completion text or parsed JSON
     */
    complete(prompt: string, params?: LlmCompletionParams): Promise<LlmCompletionResult>;

    /**
     * Check if the provider is available (e.g., Ollama server is running).
     */
    isAvailable(): Promise<boolean>;
}

/**
 * Parameters for LLM completion requests.
 */
export interface LlmCompletionParams {
    /** Model to use (overrides default) */
    model?: string;
    /** Temperature (0.0 to 2.0) */
    temperature?: number;
    /** Maximum tokens in response */
    maxTokens?: number;
    /** Whether to request JSON response format */
    jsonMode?: boolean;
    /** System prompt */
    systemPrompt?: string;
}

/**
 * Result from an LLM completion request.
 */
export interface LlmCompletionResult {
    /** Raw response text */
    text: string;
    /** Parsed JSON (if json mode was used and parsing succeeded) */
    parsed?: unknown;
    /** Token usage */
    usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    /** Model used */
    model: string;
    /** Provider name */
    provider: string;
}

/**
 * LLM provider initialization options.
 */
export interface LlmProviderOptions {
    /** API key (for cloud providers like OpenAI) */
    apiKey?: string;
    /** Base URL (for Ollama or custom endpoints) */
    baseUrl?: string;
    /** Default model */
    model: string;
}
