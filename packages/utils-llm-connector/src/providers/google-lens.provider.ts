import { BaseProvider } from './base.provider';
import {
  TextGenerationRequest,
  TextGenerationResponse,
  ImageAnalysisRequest,
  ImageAnalysisResponse,
  UsageMetrics,
  ProviderInfo,
  ProviderConfig,
  DetectedObject,
  ProductInfo,
  BoundingBox
} from '../types';

/**
 * Google Lens provider implementation using Cloud Vision API
 * Specialized for product identification and visual search
 */
export class GoogleLensProvider extends BaseProvider {
  constructor(config: ProviderConfig) {
    super('google-lens', config);
  }

  async generateText(request: TextGenerationRequest): Promise<TextGenerationResponse> {
    const requestId = this.generateRequestId();
    const processingTime = Date.now();
    
    return {
      ...this.handleProviderError(
        { message: 'Google Lens provider does not support text generation' }, 
        requestId, 
        request.model
      ),
      text: '',
      finishReason: 'error' as const,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        processingTimeMs: Date.now() - processingTime
      }
    };
  }

  async analyzeImage(request: ImageAnalysisRequest): Promise<ImageAnalysisResponse> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();

    try {
      this.validateRequest(request);
      await this.applyRateLimit();

      // Import Google Cloud Vision SDK dynamically
      const vision = await this.getVisionSDK();
      
      // Use user API key if provided, otherwise platform credentials
      const client = this.createVisionClient(vision, request.userApiKey);

      // Prepare image request
      const imageRequest = this.buildImageRequest(request);
      const features = this.getAnalysisFeatures(request.analysisType);

      const visionRequest = {
        image: imageRequest,
        features
      };

      const [result] = await client.annotateImage(visionRequest);
      const processingTime = Date.now() - startTime;

      // Google Vision API doesn't use tokens, pricing is per request
      const usage: UsageMetrics = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCost: this.calculateCost(request.analysisType),
        processingTimeMs: processingTime
      };

      const analysis = this.parseVisionResult(result, request.analysisType);

      return {
        ...this.createBaseResponse(requestId, usage),
        model: request.model,
        analysis
      };

    } catch (error: any) {
      const processingTime = Date.now() - startTime;
      
      return {
        ...this.handleProviderError(error, requestId, request.model),
        analysis: {
          description: '',
          detectedObjects: [],
          extractedText: ''
        },
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          processingTimeMs: processingTime
        }
      };
    }
  }

  getInfo(): ProviderInfo {
    return {
      name: 'google-lens',
      displayName: 'Google Lens (Vision API)',
      availableModels: [
        {
          id: 'vision-product-search',
          displayName: 'Vision Product Search',
          contextWindow: 0, // Not applicable for vision
          costPer1kTokens: undefined
        },
        {
          id: 'vision-object-detection',
          displayName: 'Vision Object Detection',
          contextWindow: 0,
          costPer1kTokens: undefined
        },
        {
          id: 'vision-text-detection',
          displayName: 'Vision Text Detection (OCR)',
          contextWindow: 0,
          costPer1kTokens: undefined
        }
      ],
      supportedFeatures: ['image-analysis']
    };
  }

  protected getApiKeyEnvVar(): string {
    return 'GOOGLE_CLOUD_API_KEY';
  }

  /**
   * Build the image request object for Vision API
   */
  private buildImageRequest(request: ImageAnalysisRequest): any {
    if (request.imageUrl) {
      return { source: { imageUri: request.imageUrl } };
    } else if (request.imageBase64) {
      return { content: request.imageBase64 };
    } else {
      throw new Error('Either imageUrl or imageBase64 is required');
    }
  }

  /**
   * Get the appropriate features for analysis type
   */
  private getAnalysisFeatures(analysisType: string): any[] {
    switch (analysisType) {
      case 'product-identification':
        return [
          { type: 'PRODUCT_SEARCH', maxResults: 10 },
          { type: 'OBJECT_LOCALIZATION', maxResults: 20 },
          { type: 'LABEL_DETECTION', maxResults: 20 },
          { type: 'TEXT_DETECTION' }
        ];
      case 'text-extraction':
        return [
          { type: 'TEXT_DETECTION' },
          { type: 'DOCUMENT_TEXT_DETECTION' }
        ];
      case 'general-description':
        return [
          { type: 'LABEL_DETECTION', maxResults: 20 },
          { type: 'OBJECT_LOCALIZATION', maxResults: 20 },
          { type: 'IMAGE_PROPERTIES' },
          { type: 'SAFE_SEARCH_DETECTION' }
        ];
      default:
        return [
          { type: 'LABEL_DETECTION', maxResults: 10 },
          { type: 'TEXT_DETECTION' }
        ];
    }
  }

  /**
   * Parse Vision API results into our standard format
   */
  private parseVisionResult(result: any, analysisType: string): any {
    const analysis: any = {
      description: this.buildDescription(result, analysisType),
      confidence: this.calculateOverallConfidence(result),
      detectedObjects: this.mapDetectedObjects(result.localizedObjectAnnotations || []),
      extractedText: result.textAnnotations?.[0]?.description || ''
    };

    // Add product info for product identification
    if (analysisType === 'product-identification' && result.productSearchResults) {
      analysis.productInfo = this.extractProductInfo(result.productSearchResults);
    }

    return analysis;
  }

  /**
   * Build a description from various Vision API results
   */
  private buildDescription(result: any, analysisType: string): string {
    const descriptions: string[] = [];

    // Add labels
    if (result.labelAnnotations?.length > 0) {
      const topLabels = result.labelAnnotations
        .slice(0, 5)
        .map((label: any) => label.description)
        .join(', ');
      descriptions.push(`Detected: ${topLabels}`);
    }

    // Add objects
    if (result.localizedObjectAnnotations?.length > 0) {
      const topObjects = result.localizedObjectAnnotations
        .slice(0, 3)
        .map((obj: any) => obj.name)
        .join(', ');
      descriptions.push(`Objects: ${topObjects}`);
    }

    // Add product information
    if (result.productSearchResults?.results?.length > 0) {
      const topProduct = result.productSearchResults.results[0];
      if (topProduct.product?.displayName) {
        descriptions.push(`Product: ${topProduct.product.displayName}`);
      }
    }

    // Add text if it's the main focus
    if (analysisType === 'text-extraction' && result.textAnnotations?.length > 0) {
      const text = result.textAnnotations[0].description;
      if (text && text.length > 0) {
        descriptions.push(`Text found: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);
      }
    }

    return descriptions.length > 0 ? descriptions.join('. ') : 'No significant features detected.';
  }

  /**
   * Calculate overall confidence from all detections
   */
  private calculateOverallConfidence(result: any): number {
    const confidences: number[] = [];

    // Add label confidences
    if (result.labelAnnotations?.length > 0) {
      confidences.push(...result.labelAnnotations.map((label: any) => label.score || 0));
    }

    // Add object detection confidences
    if (result.localizedObjectAnnotations?.length > 0) {
      confidences.push(...result.localizedObjectAnnotations.map((obj: any) => obj.score || 0));
    }

    if (confidences.length === 0) return 0;

    // Return average of top 3 confidences
    const topConfidences = confidences.sort((a, b) => b - a).slice(0, 3);
    return topConfidences.reduce((sum, conf) => sum + conf, 0) / topConfidences.length;
  }

  /**
   * Map Vision API objects to our standard format
   */
  private mapDetectedObjects(objects: any[]): DetectedObject[] {
    return objects.map(obj => ({
      name: obj.name,
      confidence: obj.score || 0,
      boundingBox: this.mapBoundingBox(obj.boundingPoly)
    }));
  }

  /**
   * Map Vision API bounding poly to our standard bounding box
   */
  private mapBoundingBox(boundingPoly: any): BoundingBox | undefined {
    if (!boundingPoly?.vertices?.length) return undefined;

    const vertices = boundingPoly.vertices;
    const xs = vertices.map((v: any) => v.x || 0);
    const ys = vertices.map((v: any) => v.y || 0);

    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    };
  }

  /**
   * Extract product information from product search results
   */
  private extractProductInfo(productResults: any): ProductInfo | undefined {
    if (!productResults?.results?.length) return undefined;

    const topResult = productResults.results[0];
    const product = topResult.product;

    if (!product) return undefined;

    return {
      name: product.displayName,
      brand: product.productLabels?.find((label: any) => 
        label.key?.toLowerCase().includes('brand')
      )?.value,
      description: product.description,
      price: product.productLabels?.find((label: any) => 
        label.key?.toLowerCase().includes('price')
      )?.value,
      availability: product.productLabels?.find((label: any) => 
        label.key?.toLowerCase().includes('availability')
      )?.value,
      urls: topResult.image ? [topResult.image.uri] : undefined
    };
  }

  /**
   * Calculate estimated cost based on analysis type
   */
  private calculateCost(analysisType: string): number {
    // Google Vision API pricing (as of 2024)
    switch (analysisType) {
      case 'product-identification':
        return 0.003; // Product Search is ~$3 per 1000 requests
      case 'text-extraction':
        return 0.0015; // OCR is ~$1.50 per 1000 requests
      case 'general-description':
        return 0.0015; // Label/Object detection is ~$1.50 per 1000 requests
      default:
        return 0.0015;
    }
  }

  /**
   * Create Vision client with appropriate authentication
   */
  private createVisionClient(vision: any, userApiKey?: string): any {
    if (userApiKey) {
      // Use provided API key
      return new vision.ImageAnnotatorClient({
        auth: userApiKey
      });
    } else {
      // Use service account or default credentials
      const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      if (credentialsPath) {
        return new vision.ImageAnnotatorClient({
          keyFilename: credentialsPath
        });
      } else {
        // Use default application credentials
        return new vision.ImageAnnotatorClient();
      }
    }
  }

  /**
   * Dynamically import Google Cloud Vision SDK
   */
  private async getVisionSDK(): Promise<any> {
    try {
      return await import('@google-cloud/vision');
    } catch (error) {
      throw new Error('Google Cloud Vision SDK not found. Please install @google-cloud/vision: npm install @google-cloud/vision');
    }
  }
}
