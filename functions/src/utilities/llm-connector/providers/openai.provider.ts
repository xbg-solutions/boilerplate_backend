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
 * OpenAI provider implementation
 * Supports GPT models for text generation
 */
export class OpenAIProvider extends BaseProvider {
  constructor(config: ProviderConfig) {
    super('openai', config);
  }

  async generateText(request: TextGenerationRequest): Promise<TextGenerationResponse> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();
    
    try {
      this.validateRequest(request);
      await this.applyRateLimit();

      // Import OpenAI SDK dynamically
      const OpenAI = await this.getOpenAISDK();
      
      // Use user API key if provided, otherwise platform key
      const apiKey = this.getApiKey(request.userApiKey);
      const client = new OpenAI({ apiKey });

      const messages: any[] = [];
      
      // Add system message if provided
      if (request.systemPrompt) {
        messages.push({ role: 'system', content: request.systemPrompt });
      }
      
      messages.push({ role: 'user', content: request.prompt });

      const response = await client.chat.completions.create({
        model: request.model,
        messages,
        max_tokens: request.maxTokens || 1000,
        temperature: request.temperature || 0.7,
        stop: request.stopSequences || undefined
      });

      const processingTime = Date.now() - startTime;
      const choice = response.choices[0];
      
      const usage: UsageMetrics = {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
        estimatedCost: this.calculateCost(response.usage, request.model),
        processingTimeMs: processingTime
      };

      return {
        ...this.createBaseResponse(requestId, usage),
        model: request.model,
        text: choice.message?.content || '',
        finishReason: this.mapFinishReason(choice.finish_reason)
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

      // Import OpenAI SDK dynamically
      const OpenAI = await this.getOpenAISDK();
      
      // Use user API key if provided, otherwise platform key
      const apiKey = this.getApiKey(request.userApiKey);
      const client = new OpenAI({ apiKey });

      // Prepare image content
      let imageContent: any;
      if (request.imageUrl) {
        imageContent = {
          type: "image_url",
          image_url: { url: request.imageUrl }
        };
      } else if (request.imageBase64) {
        imageContent = {
          type: "image_url",
          image_url: { url: `data:image/jpeg;base64,${request.imageBase64}` }
        };
      } else {
        throw new Error('Either imageUrl or imageBase64 is required');
      }

      const prompt = request.prompt || this.getDefaultImagePrompt(request.analysisType);

      const response = await client.chat.completions.create({
        model: request.model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              imageContent
            ]
          }
        ],
        max_tokens: 1000
      });

      const processingTime = Date.now() - startTime;
      const choice = response.choices[0];
      
      const usage: UsageMetrics = {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
        estimatedCost: this.calculateCost(response.usage, request.model),
        processingTimeMs: processingTime
      };

      return {
        ...this.createBaseResponse(requestId, usage),
        model: request.model,
        analysis: {
          description: choice.message?.content || '',
          confidence: 0.8, // OpenAI doesn't provide confidence scores
          detectedObjects: [], // Would need additional processing
          extractedText: '', // Would need OCR-specific prompt
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
      name: 'openai',
      displayName: 'OpenAI',
      availableModels: [
        {
          id: 'gpt-4o',
          displayName: 'GPT-4o',
          contextWindow: 128000,
          costPer1kTokens: { input: 0.005, output: 0.015 }
        },
        {
          id: 'gpt-4o-mini',
          displayName: 'GPT-4o Mini',
          contextWindow: 128000,
          costPer1kTokens: { input: 0.00015, output: 0.0006 }
        },
        {
          id: 'gpt-4-turbo',
          displayName: 'GPT-4 Turbo',
          contextWindow: 128000,
          costPer1kTokens: { input: 0.01, output: 0.03 }
        },
        {
          id: 'gpt-3.5-turbo',
          displayName: 'GPT-3.5 Turbo',
          contextWindow: 16385,
          costPer1kTokens: { input: 0.0005, output: 0.0015 }
        }
      ],
      supportedFeatures: ['text-generation', 'image-analysis']
    };
  }

  protected getApiKeyEnvVar(): string {
    return 'OPENAI_API_KEY';
  }

  /**
   * Calculate estimated cost based on usage and model
   */
  private calculateCost(usage: { prompt_tokens: number; completion_tokens: number } | undefined, model: string): number {
    if (!usage) return 0;

    const modelInfo = this.getInfo().availableModels.find((m: { id: string }) => m.id === model);
    if (!modelInfo?.costPer1kTokens) return 0;

    const inputCost = (usage.prompt_tokens / 1000) * modelInfo.costPer1kTokens.input;
    const outputCost = (usage.completion_tokens / 1000) * modelInfo.costPer1kTokens.output;
    
    return Math.round((inputCost + outputCost) * 100000) / 100000; // Round to 5 decimal places
  }

  /**
   * Map OpenAI's finish reasons to our standard format
   */
  private mapFinishReason(reason: string | null): 'completed' | 'length' | 'stop' | 'error' {
    switch (reason) {
      case 'stop':
        return 'completed';
      case 'length':
        return 'length';
      case 'content_filter':
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
        return 'Please identify the product in this image. Describe what it is, any visible brand names, and key features.';
      case 'text-extraction':
        return 'Please extract all visible text from this image.';
      case 'general-description':
        return 'Please describe what you see in this image in detail.';
      default:
        return 'Please analyze this image and describe what you see.';
    }
  }

  /**
   * Dynamically import OpenAI SDK
   */
  private async getOpenAISDK(): Promise<any> {
    try {
      const module = await import('openai');
      return module.default || module;
    } catch (error) {
      throw new Error('OpenAI SDK not found. Please install openai: npm install openai');
    }
  }
}
