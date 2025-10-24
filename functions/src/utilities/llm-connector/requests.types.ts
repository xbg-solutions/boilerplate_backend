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
 * Text generation request
 */
export interface TextGenerationRequest extends BaseRequest {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
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
