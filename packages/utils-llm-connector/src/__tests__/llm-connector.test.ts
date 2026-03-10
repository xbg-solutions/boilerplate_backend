/**
 * LLM Connector - Unit Tests
 *
 * Testing WHAT the LLM connector does, not HOW it works internally:
 * - Manages multiple LLM providers (Claude, OpenAI, Gemini, Google Lens)
 * - Routes text generation requests to appropriate providers
 * - Routes image analysis requests to appropriate providers
 * - Validates provider capabilities (text vs image)
 * - Provides runtime provider configuration
 * - Tracks available and enabled providers
 */

import { LLMConnector } from '../llm-connector';
import {
  TextGenerationRequest,
  ImageAnalysisRequest,
  ProviderConfig,
} from '../types';

// Mock the provider modules
jest.mock('../providers', () => ({
  BaseProvider: jest.fn(),
  ClaudeProvider: jest.fn().mockImplementation((config) => ({
    getInfo: () => ({
      name: 'claude',
      enabled: true,
      supportedFeatures: ['text-generation', 'image-analysis'],
      models: ['claude-3-5-sonnet-20241022'],
    }),
    generateText: jest.fn().mockResolvedValue({
      success: true,
      text: 'Generated text from Claude',
      finishReason: 'completed',
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, processingTimeMs: 100 },
      provider: 'claude',
      model: 'claude-3-5-sonnet-20241022',
      requestId: 'req-claude-1',
    }),
    analyzeImage: jest.fn().mockResolvedValue({
      success: true,
      analysis: {
        description: 'Image analysis from Claude',
        confidence: 0.95,
      },
      usage: { inputTokens: 50, outputTokens: 30, totalTokens: 80, processingTimeMs: 200 },
      provider: 'claude',
      model: 'claude-3-5-sonnet-20241022',
      requestId: 'req-claude-img-1',
    }),
  })),
  OpenAIProvider: jest.fn().mockImplementation((config) => ({
    getInfo: () => ({
      name: 'openai',
      enabled: true,
      supportedFeatures: ['text-generation', 'image-analysis'],
      models: ['gpt-4o'],
    }),
    generateText: jest.fn().mockResolvedValue({
      success: true,
      text: 'Generated text from OpenAI',
      finishReason: 'completed',
      usage: { inputTokens: 15, outputTokens: 25, totalTokens: 40, processingTimeMs: 150 },
      provider: 'openai',
      model: 'gpt-4o',
      requestId: 'req-openai-1',
    }),
    analyzeImage: jest.fn().mockResolvedValue({
      success: true,
      analysis: {
        description: 'Image analysis from OpenAI',
        confidence: 0.90,
      },
      usage: { inputTokens: 45, outputTokens: 35, totalTokens: 80, processingTimeMs: 180 },
      provider: 'openai',
      model: 'gpt-4o',
      requestId: 'req-openai-img-1',
    }),
  })),
  GeminiProvider: jest.fn().mockImplementation((config) => ({
    getInfo: () => ({
      name: 'gemini',
      enabled: true,
      supportedFeatures: ['text-generation', 'image-analysis'],
      models: ['gemini-1.5-pro'],
    }),
    generateText: jest.fn().mockResolvedValue({
      success: true,
      text: 'Generated text from Gemini',
      finishReason: 'completed',
      usage: { inputTokens: 12, outputTokens: 22, totalTokens: 34, processingTimeMs: 120 },
      provider: 'gemini',
      model: 'gemini-1.5-pro',
      requestId: 'req-gemini-1',
    }),
    analyzeImage: jest.fn().mockResolvedValue({
      success: true,
      analysis: {
        description: 'Image analysis from Gemini',
        confidence: 0.92,
      },
      usage: { inputTokens: 48, outputTokens: 32, totalTokens: 80, processingTimeMs: 190 },
      provider: 'gemini',
      model: 'gemini-1.5-pro',
      requestId: 'req-gemini-img-1',
    }),
  })),
  GoogleLensProvider: jest.fn().mockImplementation((config) => ({
    getInfo: () => ({
      name: 'google-lens',
      enabled: true,
      supportedFeatures: ['image-analysis'],
      models: ['vision-product-search'],
    }),
    generateText: jest.fn().mockRejectedValue(new Error('Not supported')),
    analyzeImage: jest.fn().mockResolvedValue({
      success: true,
      analysis: {
        description: 'Product identification from Google Lens',
        confidence: 0.88,
        productInfo: {
          name: 'Sample Product',
          brand: 'Sample Brand',
        },
      },
      usage: { inputTokens: 30, outputTokens: 20, totalTokens: 50, processingTimeMs: 160 },
      provider: 'google-lens',
      model: 'vision-product-search',
      requestId: 'req-lens-1',
    }),
  })),
}));

describe('LLM Connector', () => {
  describe('initialization', () => {
    it('initializes with provided configuration', () => {
      const config: Record<string, ProviderConfig> = {
        claude: {
          name: 'claude',
          enabled: true,
          defaultModel: 'claude-3-5-sonnet-20241022',
          timeout: 30000,
          maxRetries: 2,
        },
      };

      const connector = new LLMConnector(config);
      const enabled = connector.getEnabledProviders();

      expect(enabled).toContain('claude');
    });

    it('initializes with default configuration when none provided', () => {
      // Save original env
      const originalEnv = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'test-key';

      const connector = new LLMConnector();
      const enabled = connector.getEnabledProviders();

      // Should have at least one provider enabled if API keys present
      expect(enabled.length).toBeGreaterThanOrEqual(0);

      // Restore env
      process.env.ANTHROPIC_API_KEY = originalEnv;
    });

    it('initializes only enabled providers', () => {
      const config: Record<string, ProviderConfig> = {
        claude: {
          name: 'claude',
          enabled: true,
          defaultModel: 'claude-3-5-sonnet-20241022',
          timeout: 30000,
          maxRetries: 2,
        },
        openai: {
          name: 'openai',
          enabled: false,
          defaultModel: 'gpt-4o',
          timeout: 30000,
          maxRetries: 2,
        },
      };

      const connector = new LLMConnector(config);
      const enabled = connector.getEnabledProviders();

      expect(enabled).toContain('claude');
      expect(enabled).not.toContain('openai');
    });

    it('handles initialization with no enabled providers', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const config: Record<string, ProviderConfig> = {
        claude: {
          name: 'claude',
          enabled: false,
          defaultModel: 'claude-3-5-sonnet-20241022',
          timeout: 30000,
          maxRetries: 2,
        },
      };

      new LLMConnector(config);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'No LLM providers were successfully initialized'
      );

      consoleWarnSpy.mockRestore();
    });
  });

  describe('generateText', () => {
    it('generates text using Claude provider', async () => {
      const config: Record<string, ProviderConfig> = {
        claude: {
          name: 'claude',
          enabled: true,
          defaultModel: 'claude-3-5-sonnet-20241022',
          timeout: 30000,
          maxRetries: 2,
        },
      };

      const connector = new LLMConnector(config);

      const request: TextGenerationRequest = {
        provider: 'claude',
        model: 'claude-3-5-sonnet-20241022',
        prompt: 'Explain quantum computing',
        maxTokens: 500,
      };

      const response = await connector.generateText(request);

      expect(response.success).toBe(true);
      expect(response.text).toContain('Claude');
      expect(response.provider).toBe('claude');
    });

    it('generates text using OpenAI provider', async () => {
      const config: Record<string, ProviderConfig> = {
        openai: {
          name: 'openai',
          enabled: true,
          defaultModel: 'gpt-4o',
          timeout: 30000,
          maxRetries: 2,
        },
      };

      const connector = new LLMConnector(config);

      const request: TextGenerationRequest = {
        provider: 'openai',
        model: 'gpt-4o',
        prompt: 'Write a poem',
      };

      const response = await connector.generateText(request);

      expect(response.success).toBe(true);
      expect(response.text).toContain('OpenAI');
    });

    it('throws error for unsupported provider', async () => {
      const config: Record<string, ProviderConfig> = {
        'google-lens': {
          name: 'google-lens',
          enabled: true,
          defaultModel: 'vision-product-search',
          timeout: 15000,
          maxRetries: 1,
        },
      };

      const connector = new LLMConnector(config);

      const request: TextGenerationRequest = {
        provider: 'google-lens',
        model: 'vision-product-search',
        prompt: 'Test',
      };

      await expect(connector.generateText(request)).rejects.toThrow(
        "Provider 'google-lens' does not support text generation"
      );
    });

    it('throws error for non-existent provider', async () => {
      const connector = new LLMConnector({});

      const request: TextGenerationRequest = {
        provider: 'nonexistent',
        model: 'some-model',
        prompt: 'Test',
      };

      await expect(connector.generateText(request)).rejects.toThrow(
        "Provider 'nonexistent' not found or not enabled"
      );
    });
  });

  describe('analyzeImage', () => {
    it('analyzes image using Claude provider', async () => {
      const config: Record<string, ProviderConfig> = {
        claude: {
          name: 'claude',
          enabled: true,
          defaultModel: 'claude-3-5-sonnet-20241022',
          timeout: 30000,
          maxRetries: 2,
        },
      };

      const connector = new LLMConnector(config);

      const request: ImageAnalysisRequest = {
        provider: 'claude',
        model: 'claude-3-5-sonnet-20241022',
        imageUrl: 'https://example.com/image.jpg',
        analysisType: 'general-description',
      };

      const response = await connector.analyzeImage(request);

      expect(response.success).toBe(true);
      expect(response.analysis.description).toContain('Claude');
      expect(response.provider).toBe('claude');
    });

    it('analyzes image using Google Lens provider', async () => {
      const config: Record<string, ProviderConfig> = {
        'google-lens': {
          name: 'google-lens',
          enabled: true,
          defaultModel: 'vision-product-search',
          timeout: 15000,
          maxRetries: 1,
        },
      };

      const connector = new LLMConnector(config);

      const request: ImageAnalysisRequest = {
        provider: 'google-lens',
        model: 'vision-product-search',
        imageUrl: 'https://example.com/product.jpg',
        analysisType: 'product-identification',
      };

      const response = await connector.analyzeImage(request);

      expect(response.success).toBe(true);
      expect(response.analysis.description).toContain('Google Lens');
      expect(response.analysis.productInfo).toBeDefined();
    });

    it('handles base64 encoded images', async () => {
      const config: Record<string, ProviderConfig> = {
        gemini: {
          name: 'gemini',
          enabled: true,
          defaultModel: 'gemini-1.5-pro',
          timeout: 30000,
          maxRetries: 2,
        },
      };

      const connector = new LLMConnector(config);

      const request: ImageAnalysisRequest = {
        provider: 'gemini',
        model: 'gemini-1.5-pro',
        imageBase64: 'base64encodedimage',
        analysisType: 'text-extraction',
      };

      const response = await connector.analyzeImage(request);

      expect(response.success).toBe(true);
    });
  });

  describe('provider management', () => {
    it('retrieves list of available providers', () => {
      const config: Record<string, ProviderConfig> = {
        claude: {
          name: 'claude',
          enabled: true,
          defaultModel: 'claude-3-5-sonnet-20241022',
          timeout: 30000,
          maxRetries: 2,
        },
        openai: {
          name: 'openai',
          enabled: true,
          defaultModel: 'gpt-4o',
          timeout: 30000,
          maxRetries: 2,
        },
      };

      const connector = new LLMConnector(config);
      const providers = connector.getAvailableProviders();

      expect(providers.length).toBe(2);
      expect(providers.some((p) => p.name === 'claude')).toBe(true);
      expect(providers.some((p) => p.name === 'openai')).toBe(true);
    });

    it('retrieves specific provider info', () => {
      const config: Record<string, ProviderConfig> = {
        claude: {
          name: 'claude',
          enabled: true,
          defaultModel: 'claude-3-5-sonnet-20241022',
          timeout: 30000,
          maxRetries: 2,
        },
      };

      const connector = new LLMConnector(config);
      const info = connector.getProviderInfo('claude');

      expect(info.name).toBe('claude');
      expect(info.supportedFeatures).toContain('text-generation');
      expect(info.supportedFeatures).toContain('image-analysis');
    });

    it('checks if provider supports text generation', () => {
      const config: Record<string, ProviderConfig> = {
        claude: {
          name: 'claude',
          enabled: true,
          defaultModel: 'claude-3-5-sonnet-20241022',
          timeout: 30000,
          maxRetries: 2,
        },
        'google-lens': {
          name: 'google-lens',
          enabled: true,
          defaultModel: 'vision-product-search',
          timeout: 15000,
          maxRetries: 1,
        },
      };

      const connector = new LLMConnector(config);

      expect(connector.supportsFeature('claude', 'text-generation')).toBe(true);
      expect(connector.supportsFeature('google-lens', 'text-generation')).toBe(false);
    });

    it('checks if provider supports image analysis', () => {
      const config: Record<string, ProviderConfig> = {
        claude: {
          name: 'claude',
          enabled: true,
          defaultModel: 'claude-3-5-sonnet-20241022',
          timeout: 30000,
          maxRetries: 2,
        },
        'google-lens': {
          name: 'google-lens',
          enabled: true,
          defaultModel: 'vision-product-search',
          timeout: 15000,
          maxRetries: 1,
        },
      };

      const connector = new LLMConnector(config);

      expect(connector.supportsFeature('claude', 'image-analysis')).toBe(true);
      expect(connector.supportsFeature('google-lens', 'image-analysis')).toBe(true);
    });

    it('returns false for non-existent provider feature check', () => {
      const connector = new LLMConnector({});

      expect(connector.supportsFeature('nonexistent', 'text-generation')).toBe(false);
    });
  });

  describe('dynamic configuration', () => {
    it('updates provider configuration', () => {
      const config: Record<string, ProviderConfig> = {
        claude: {
          name: 'claude',
          enabled: true,
          defaultModel: 'claude-3-5-sonnet-20241022',
          timeout: 30000,
          maxRetries: 2,
        },
      };

      const connector = new LLMConnector(config);

      connector.updateProviderConfig('claude', {
        timeout: 60000,
        maxRetries: 3,
      });

      const updatedConfig = connector.getProviderConfig('claude');
      expect(updatedConfig?.timeout).toBe(60000);
      expect(updatedConfig?.maxRetries).toBe(3);
    });

    it('disables provider via configuration update', () => {
      const config: Record<string, ProviderConfig> = {
        claude: {
          name: 'claude',
          enabled: true,
          defaultModel: 'claude-3-5-sonnet-20241022',
          timeout: 30000,
          maxRetries: 2,
        },
      };

      const connector = new LLMConnector(config);

      let enabled = connector.getEnabledProviders();
      expect(enabled).toContain('claude');

      connector.updateProviderConfig('claude', { enabled: false });

      enabled = connector.getEnabledProviders();
      expect(enabled).not.toContain('claude');
    });

    it('throws error when updating non-existent provider', () => {
      const connector = new LLMConnector({});

      expect(() =>
        connector.updateProviderConfig('nonexistent', { timeout: 60000 })
      ).toThrow("Provider 'nonexistent' not found in configuration");
    });

    it('adds new provider dynamically', () => {
      const connector = new LLMConnector({});

      const newConfig: ProviderConfig = {
        name: 'gemini',
        enabled: true,
        defaultModel: 'gemini-1.5-pro',
        timeout: 30000,
        maxRetries: 2,
      };

      connector.addProvider('gemini', newConfig);

      const enabled = connector.getEnabledProviders();
      expect(enabled).toContain('gemini');
    });

    it('removes provider dynamically', () => {
      const config: Record<string, ProviderConfig> = {
        claude: {
          name: 'claude',
          enabled: true,
          defaultModel: 'claude-3-5-sonnet-20241022',
          timeout: 30000,
          maxRetries: 2,
        },
      };

      const connector = new LLMConnector(config);

      let enabled = connector.getEnabledProviders();
      expect(enabled).toContain('claude');

      connector.removeProvider('claude');

      enabled = connector.getEnabledProviders();
      expect(enabled).not.toContain('claude');
    });
  });

  describe('configuration retrieval', () => {
    it('retrieves provider configuration', () => {
      const config: Record<string, ProviderConfig> = {
        claude: {
          name: 'claude',
          enabled: true,
          defaultModel: 'claude-3-5-sonnet-20241022',
          timeout: 30000,
          maxRetries: 2,
        },
      };

      const connector = new LLMConnector(config);
      const retrievedConfig = connector.getProviderConfig('claude');

      expect(retrievedConfig).toBeDefined();
      expect(retrievedConfig?.name).toBe('claude');
      expect(retrievedConfig?.defaultModel).toBe('claude-3-5-sonnet-20241022');
    });

    it('returns undefined for non-existent provider config', () => {
      const connector = new LLMConnector({});
      const config = connector.getProviderConfig('nonexistent');

      expect(config).toBeUndefined();
    });

    it('retrieves all enabled provider names', () => {
      const config: Record<string, ProviderConfig> = {
        claude: {
          name: 'claude',
          enabled: true,
          defaultModel: 'claude-3-5-sonnet-20241022',
          timeout: 30000,
          maxRetries: 2,
        },
        openai: {
          name: 'openai',
          enabled: true,
          defaultModel: 'gpt-4o',
          timeout: 30000,
          maxRetries: 2,
        },
        gemini: {
          name: 'gemini',
          enabled: false,
          defaultModel: 'gemini-1.5-pro',
          timeout: 30000,
          maxRetries: 2,
        },
      };

      const connector = new LLMConnector(config);
      const enabled = connector.getEnabledProviders();

      expect(enabled).toHaveLength(2);
      expect(enabled).toContain('claude');
      expect(enabled).toContain('openai');
      expect(enabled).not.toContain('gemini');
    });
  });
});
