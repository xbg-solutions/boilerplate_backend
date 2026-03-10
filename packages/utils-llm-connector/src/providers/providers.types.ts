/**
 * Provider configuration interface
 */
export interface ProviderConfig {
  name: string;
  enabled: boolean;
  defaultModel: string;
  timeout: number; // milliseconds
  maxRetries: number;
  rateLimits?: {
    requestsPerMinute: number;
    tokensPerMinute: number;
  };
}

/**
 * Provider information for client queries
 */
export interface ProviderInfo {
  name: string;
  displayName: string;
  availableModels: ModelInfo[];
  supportedFeatures: ('text-generation' | 'image-analysis')[];
}

/**
 * Model information
 */
export interface ModelInfo {
  id: string;
  displayName: string;
  contextWindow: number;
  costPer1kTokens?: {
    input: number;
    output: number;
  };
}

/**
 * Detected object in image analysis
 */
export interface DetectedObject {
  name: string;
  confidence: number;
  boundingBox?: BoundingBox;
}

/**
 * Product information from Google Lens
 */
export interface ProductInfo {
  name?: string;
  brand?: string;
  description?: string;
  price?: string;
  availability?: string;
  urls?: string[];
}

/**
 * Bounding box coordinates
 */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
