import { DetectedObject, ProductInfo } from './providers/providers.types';

/**
 * Base request interface for all LLM operations
 */
export interface BaseRequest {
  provider: string;
  model: string;
  userApiKey?: string; // Optional user-provided API key
}

/**
 * A single role-tagged turn in a conversation. Mirrors the shape used by
 * Anthropic and OpenAI message arrays — system is NOT a valid role here;
 * it goes in the top-level `system` field on the request.
 */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Text generation request.
 *
 * Two input shapes are supported:
 *   1. Preferred: `messages` (role-tagged turns) plus optional top-level `system`.
 *      This matches the native Anthropic/OpenAI shape and supports multi-turn dialogue.
 *   2. Legacy: `prompt` (a single user turn) plus optional `systemPrompt`.
 *      Retained for back-compat; new code should use `messages`.
 *
 * Exactly one of `messages` or `prompt` must be provided.
 */
export interface TextGenerationRequest extends BaseRequest {
  messages?: ChatMessage[];
  system?: string;
  /** @deprecated use `messages` */
  prompt?: string;
  /** @deprecated use `system` */
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
}

/**
 * Image analysis request
 */
export interface ImageAnalysisRequest extends BaseRequest {
  imageUrl?: string;
  imageBase64?: string;
  analysisType: 'product-identification' | 'general-description' | 'text-extraction';
  prompt?: string; // Optional context for analysis
}

/**
 * Usage metrics for cost tracking
 */
export interface UsageMetrics {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost?: number; // In USD if calculable
  processingTimeMs: number;
}

/**
 * Base response interface
 */
export interface BaseResponse {
  success: boolean;
  error?: string;
  usage: UsageMetrics;
  provider: string;
  model: string;
  requestId: string;
}

/**
 * Text generation response
 */
export interface TextGenerationResponse extends BaseResponse {
  text: string;
  finishReason: 'completed' | 'length' | 'stop' | 'error';
}

/**
 * Image analysis response
 */
export interface ImageAnalysisResponse extends BaseResponse {
  analysis: {
    description: string;
    confidence?: number;
    detectedObjects?: DetectedObject[];
    extractedText?: string;
    productInfo?: ProductInfo;
  };
}
