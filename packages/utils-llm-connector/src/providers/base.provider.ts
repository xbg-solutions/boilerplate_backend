import {
  TextGenerationRequest,
  TextGenerationResponse,
  ImageAnalysisRequest,
  ImageAnalysisResponse,
  BaseResponse,
  UsageMetrics,
  ProviderInfo,
  ProviderConfig
} from '../types';

/**
 * Abstract base class for all LLM providers
 * Provides common functionality and enforces consistent interface
 */
export abstract class BaseProvider {
  protected name: string;
  protected config: ProviderConfig;

  constructor(name: string, config: ProviderConfig) {
    this.name = name;
    this.config = config;
  }

  /**
   * Generate text completion
   */
  abstract generateText(request: TextGenerationRequest): Promise<TextGenerationResponse>;

  /**
   * Analyze image content
   */
  abstract analyzeImage(request: ImageAnalysisRequest): Promise<ImageAnalysisResponse>;

  /**
   * Get provider information
   */
  abstract getInfo(): ProviderInfo;

  /**
   * Get API key - user provided or environment variable
   */
  protected getApiKey(userProvidedKey?: string): string {
    // Use user-provided key if available, otherwise platform key
    if (userProvidedKey) {
      return userProvidedKey;
    }
    
    const envKey = process.env[this.getApiKeyEnvVar()];
    if (!envKey) {
      throw new Error(`API key not found for provider '${this.name}'. Set ${this.getApiKeyEnvVar()} environment variable.`);
    }
    return envKey;
  }

  /**
   * Get the environment variable name for this provider's API key
   */
  protected abstract getApiKeyEnvVar(): string;

  /**
   * Create a standardized base response
   */
  protected createBaseResponse(requestId: string, usage: UsageMetrics): BaseResponse {
    return {
      success: true,
      usage,
      provider: this.name,
      model: '', // Will be set by concrete implementation
      requestId
    };
  }

  /**
   * Generate a unique request ID for tracking
   */
  protected generateRequestId(): string {
    return `${this.name}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Handle provider-specific errors with common error mapping
   */
  protected handleProviderError(error: any, requestId: string, model: string): BaseResponse {
    const errorMap: Record<string, string> = {
      'rate_limit_exceeded': 'Rate limit exceeded for provider',
      'invalid_api_key': 'Invalid API key provided',
      'quota_exceeded': 'API quota exceeded',
      'model_not_found': 'Requested model not available',
      'timeout': 'Request timeout',
      'insufficient_quota': 'Insufficient API quota',
      'invalid_request': 'Invalid request format'
    };

    const mappedError = errorMap[error.code] || error.message || 'Unknown provider error';

    return {
      success: false,
      error: mappedError,
      usage: { 
        inputTokens: 0, 
        outputTokens: 0, 
        totalTokens: 0, 
        processingTimeMs: 0 
      },
      provider: this.name,
      model,
      requestId
    };
  }

  /**
   * Validate request before processing
   */
  protected validateRequest(request: TextGenerationRequest | ImageAnalysisRequest): void {
    if (!request.provider || request.provider !== this.name) {
      throw new Error(`Invalid provider. Expected '${this.name}', got '${request.provider}'`);
    }

    if (!request.model) {
      throw new Error('Model is required');
    }

    // Text generation: require either a non-empty `messages` array or a non-empty `prompt`.
    // ImageAnalysisRequest carries `analysisType` and isn't subject to this check.
    if ('analysisType' in request) {
      if (!request.imageUrl && !request.imageBase64) {
        throw new Error('Either imageUrl or imageBase64 is required for image analysis');
      }
    } else {
      const textRequest = request as TextGenerationRequest;
      const hasMessages = Array.isArray(textRequest.messages) && textRequest.messages.length > 0;
      const hasPrompt = typeof textRequest.prompt === 'string' && textRequest.prompt.trim().length > 0;
      if (!hasMessages && !hasPrompt) {
        throw new Error('Either `messages` or `prompt` is required for text generation');
      }
      if (hasMessages) {
        for (const m of textRequest.messages!) {
          if (m.role !== 'user' && m.role !== 'assistant') {
            throw new Error(`Invalid message role '${m.role}'. Only 'user' and 'assistant' are valid; use the top-level 'system' field for system prompts.`);
          }
          if (typeof m.content !== 'string' || m.content.length === 0) {
            throw new Error('Each message must have non-empty string content');
          }
        }
      }
    }
  }

  /**
   * Apply rate limiting if configured
   */
  protected async applyRateLimit(): Promise<void> {
    if (this.config.rateLimits) {
      // Basic rate limiting implementation
      // In production, this would use Redis or similar for distributed rate limiting
      console.log(`Rate limits configured for ${this.name}:`, this.config.rateLimits);
    }
  }
}
