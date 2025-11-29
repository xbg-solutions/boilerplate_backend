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
 * Anthropic Claude provider implementation
 * Supports text generation with Claude models
 */
export class ClaudeProvider extends BaseProvider {
  constructor(config: ProviderConfig) {
    super('claude', config);
  }

  async generateText(request: TextGenerationRequest): Promise<TextGenerationResponse> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();
    
    try {
      this.validateRequest(request);
      await this.applyRateLimit();

      // Import Anthropic SDK dynamically to avoid requiring it if not used
      const Anthropic = await this.getAnthropicSDK();
      
      // Use user API key if provided, otherwise platform key
      const apiKey = this.getApiKey(request.userApiKey);
      const client = new Anthropic({ apiKey });

      const messages: any[] = [];
      
      // Add system message if provided
      if (request.systemPrompt) {
        messages.push({ role: 'system', content: request.systemPrompt });
      }
      
      messages.push({ role: 'user', content: request.prompt });

      const response = await client.messages.create({
        model: request.model,
        messages,
        max_tokens: request.maxTokens || 1000,
        temperature: request.temperature || 0.7,
        stop_sequences: request.stopSequences || []
      });

      const processingTime = Date.now() - startTime;
      const usage: UsageMetrics = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
        estimatedCost: this.calculateCost(response.usage, request.model),
        processingTimeMs: processingTime
      };

      return {
        ...this.createBaseResponse(requestId, usage),
        model: request.model,
        text: response.content[0].text,
        finishReason: this.mapFinishReason(response.stop_reason)
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
    const requestId = this.generateRequestId();
    const processingTime = Date.now();
    
    return {
      ...this.handleProviderError(
        { message: 'Claude provider does not support image analysis' }, 
        requestId, 
        request.model
      ),
      analysis: {
        description: '',
        detectedObjects: [],
        extractedText: ''
      },
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        processingTimeMs: Date.now() - processingTime
      }
    };
  }

  getInfo(): ProviderInfo {
    return {
      name: 'claude',
      displayName: 'Anthropic Claude',
      availableModels: [
        {
          id: 'claude-3-5-sonnet-20241022',
          displayName: 'Claude 3.5 Sonnet',
          contextWindow: 200000,
          costPer1kTokens: { input: 0.003, output: 0.015 }
        },
        {
          id: 'claude-3-5-haiku-20241022',
          displayName: 'Claude 3.5 Haiku',
          contextWindow: 200000,
          costPer1kTokens: { input: 0.001, output: 0.005 }
        },
        {
          id: 'claude-3-haiku-20240307',
          displayName: 'Claude 3 Haiku',
          contextWindow: 200000,
          costPer1kTokens: { input: 0.00025, output: 0.00125 }
        },
        {
          id: 'claude-3-opus-20240229',
          displayName: 'Claude 3 Opus',
          contextWindow: 200000,
          costPer1kTokens: { input: 0.015, output: 0.075 }
        }
      ],
      supportedFeatures: ['text-generation']
    };
  }

  protected getApiKeyEnvVar(): string {
    return 'ANTHROPIC_API_KEY';
  }

  /**
   * Calculate estimated cost based on usage and model
   */
  private calculateCost(usage: { input_tokens: number; output_tokens: number }, model: string): number {
    const modelInfo = this.getInfo().availableModels.find((m: { id: string }) => m.id === model);
    if (!modelInfo?.costPer1kTokens) return 0;

    const inputCost = (usage.input_tokens / 1000) * modelInfo.costPer1kTokens.input;
    const outputCost = (usage.output_tokens / 1000) * modelInfo.costPer1kTokens.output;
    
    return Math.round((inputCost + outputCost) * 100000) / 100000; // Round to 5 decimal places
  }

  /**
   * Map Claude's finish reasons to our standard format
   */
  private mapFinishReason(reason: string | null): 'completed' | 'length' | 'stop' | 'error' {
    switch (reason) {
      case 'end_turn':
        return 'completed';
      case 'max_tokens':
        return 'length';
      case 'stop_sequence':
        return 'stop';
      default:
        return 'error';
    }
  }

  /**
   * Dynamically import Anthropic SDK
   */
  private async getAnthropicSDK(): Promise<any> {
    try {
      const module = await import('@anthropic-ai/sdk');
      return module.default || module;
    } catch (error) {
      throw new Error('Anthropic SDK not found. Please install @anthropic-ai/sdk: npm install @anthropic-ai/sdk');
    }
  }
}
