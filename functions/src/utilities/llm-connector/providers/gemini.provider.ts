import { BaseProvider } from './base.provider';
import {
  TextGenerationRequest,
  TextGenerationResponse,
  ImageAnalysisRequest,
  ImageAnalysisResponse,
  UsageMetrics,
  ProviderInfo,
  ProviderConfig
} from '../types';

/**
 * Google Gemini provider implementation
 * Supports Gemini models for text generation and image analysis
 */
export class GeminiProvider extends BaseProvider {
  constructor(config: ProviderConfig) {
    super('gemini', config);
  }

  async generateText(request: TextGenerationRequest): Promise<TextGenerationResponse> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();
    
    try {
      this.validateRequest(request);
      await this.applyRateLimit();

      // Import Google Generative AI SDK dynamically
      const { GoogleGenerativeAI } = await this.getGeminiSDK();
      
      // Use user API key if provided, otherwise platform key
      const apiKey = this.getApiKey(request.userApiKey);
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: request.model });

      // Prepare prompt with system instruction if provided
      let fullPrompt = request.prompt;
      if (request.systemPrompt) {
        fullPrompt = `${request.systemPrompt}\n\n${request.prompt}`;
      }

      const generationConfig = {
        maxOutputTokens: request.maxTokens || 1000,
        temperature: request.temperature || 0.7,
        stopSequences: request.stopSequences || []
      };

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
        generationConfig
      });

      const response = result.response;
      const text = response.text();
      
      const processingTime = Date.now() - startTime;
      
      // Gemini usage info is limited, estimate tokens
      const estimatedInputTokens = Math.ceil(fullPrompt.length / 4);
      const estimatedOutputTokens = Math.ceil(text.length / 4);
      
      const usage: UsageMetrics = {
        inputTokens: estimatedInputTokens,
        outputTokens: estimatedOutputTokens,
        totalTokens: estimatedInputTokens + estimatedOutputTokens,
        estimatedCost: this.calculateCost(estimatedInputTokens, estimatedOutputTokens, request.model),
        processingTimeMs: processingTime
      };

      return {
        ...this.createBaseResponse(requestId, usage),
        model: request.model,
        text,
        finishReason: this.mapFinishReason(response.candidates?.[0]?.finishReason)
      };

    } catch (error: any) {
      const processingTime = Date.now() - startTime;
      
      return {
        ...this.handleProviderError(error, requestId, request.model),
        text: '',
        finishReason: 'error' as const,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          processingTimeMs: processingTime
        }
      };
    }
  }

  async analyzeImage(request: ImageAnalysisRequest): Promise<ImageAnalysisResponse> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();
    
    try {
      this.validateRequest(request);
      await this.applyRateLimit();

      // Import Google Generative AI SDK dynamically
      const { GoogleGenerativeAI } = await this.getGeminiSDK();
      
      // Use user API key if provided, otherwise platform key
      const apiKey = this.getApiKey(request.userApiKey);
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: request.model });

      const prompt = request.prompt || this.getDefaultImagePrompt(request.analysisType);
      
      let imagePart: any;
      if (request.imageUrl) {
        // For image URLs, we need to fetch the image data
        const imageData = await this.fetchImageAsBase64(request.imageUrl);
        imagePart = {
          inlineData: {
            data: imageData,
            mimeType: "image/jpeg"
          }
        };
      } else if (request.imageBase64) {
        imagePart = {
          inlineData: {
            data: request.imageBase64,
            mimeType: "image/jpeg"
          }
        };
      } else {
        throw new Error('Either imageUrl or imageBase64 is required');
      }

      const result = await model.generateContent({
        contents: [{ 
          role: 'user', 
          parts: [
            { text: prompt },
            imagePart
          ] 
        }],
        generationConfig: {
          maxOutputTokens: 1000
        }
      });

      const response = result.response;
      const text = response.text();
      
      const processingTime = Date.now() - startTime;
      
      // Estimate tokens for vision requests
      const estimatedInputTokens = Math.ceil(prompt.length / 4) + 500; // Add for image
      const estimatedOutputTokens = Math.ceil(text.length / 4);
      
      const usage: UsageMetrics = {
        inputTokens: estimatedInputTokens,
        outputTokens: estimatedOutputTokens,
        totalTokens: estimatedInputTokens + estimatedOutputTokens,
        estimatedCost: this.calculateCost(estimatedInputTokens, estimatedOutputTokens, request.model),
        processingTimeMs: processingTime
      };

      return {
        ...this.createBaseResponse(requestId, usage),
        model: request.model,
        analysis: {
          description: text,
          confidence: 0.8, // Gemini doesn't provide confidence scores
          detectedObjects: [], // Would need additional processing
          extractedText: request.analysisType === 'text-extraction' ? text : undefined
        }
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
      name: 'gemini',
      displayName: 'Google Gemini',
      availableModels: [
        {
          id: 'gemini-1.5-pro',
          displayName: 'Gemini 1.5 Pro',
          contextWindow: 2000000,
          costPer1kTokens: { input: 0.0035, output: 0.0105 }
        },
        {
          id: 'gemini-1.5-flash',
          displayName: 'Gemini 1.5 Flash',
          contextWindow: 1000000,
          costPer1kTokens: { input: 0.000075, output: 0.0003 }
        },
        {
          id: 'gemini-pro-vision',
          displayName: 'Gemini Pro Vision',
          contextWindow: 16384,
          costPer1kTokens: { input: 0.00025, output: 0.0005 }
        }
      ],
      supportedFeatures: ['text-generation', 'image-analysis']
    };
  }

  protected getApiKeyEnvVar(): string {
    return 'GOOGLE_AI_API_KEY';
  }

  /**
   * Calculate estimated cost based on tokens and model
   */
  private calculateCost(inputTokens: number, outputTokens: number, model: string): number {
    const modelInfo = this.getInfo().availableModels.find((m: { id: string }) => m.id === model);
    if (!modelInfo?.costPer1kTokens) return 0;

    const inputCost = (inputTokens / 1000) * modelInfo.costPer1kTokens.input;
    const outputCost = (outputTokens / 1000) * modelInfo.costPer1kTokens.output;
    
    return Math.round((inputCost + outputCost) * 100000) / 100000; // Round to 5 decimal places
  }

  /**
   * Map Gemini's finish reasons to our standard format
   */
  private mapFinishReason(reason: string | undefined): 'completed' | 'length' | 'stop' | 'error' {
    switch (reason) {
      case 'STOP':
        return 'completed';
      case 'MAX_TOKENS':
        return 'length';
      case 'SAFETY':
      case 'RECITATION':
        return 'stop';
      default:
        return 'error';
    }
  }

  /**
   * Get default prompt for image analysis type
   */
  private getDefaultImagePrompt(analysisType: string): string {
    switch (analysisType) {
      case 'product-identification':
        return 'Please identify the product in this image. Describe what it is, any visible brand names, key features, and specifications you can see.';
      case 'text-extraction':
        return 'Please extract all visible text from this image, maintaining the original formatting as much as possible.';
      case 'general-description':
        return 'Please provide a detailed description of what you see in this image.';
      default:
        return 'Please analyze this image and describe what you see.';
    }
  }

  /**
   * Fetch image from URL and convert to base64
   */
  private async fetchImageAsBase64(url: string): Promise<string> {
    try {
      // In Node.js environment
      if (typeof fetch !== 'undefined') {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        return buffer.toString('base64');
      } else {
        // Fallback for environments without fetch
        throw new Error('Image URL fetching not supported in this environment. Please use base64 instead.');
      }
    } catch (error) {
      throw new Error(`Failed to fetch image from URL: ${error}`);
    }
  }

  /**
   * Dynamically import Google Generative AI SDK
   */
  private async getGeminiSDK(): Promise<any> {
    try {
      return await import('@google/generative-ai');
    } catch (error) {
      throw new Error('Google Generative AI SDK not found. Please install @google/generative-ai: npm install @google/generative-ai');
    }
  }
}
