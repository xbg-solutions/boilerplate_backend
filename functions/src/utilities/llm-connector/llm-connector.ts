import {
  TextGenerationRequest,
  TextGenerationResponse,
  ImageAnalysisRequest,
  ImageAnalysisResponse,
  ProviderInfo,
  ProviderConfig
} from './types';

import {
  BaseProvider,
  ClaudeProvider,
  OpenAIProvider,
  GeminiProvider,
  GoogleLensProvider
} from './providers';

/**
 * Main LLM Connector class that orchestrates multiple providers
 * Provides a unified interface for text generation and image analysis
 */
export class LLMConnector {
  private providers: Map<string, BaseProvider>;
  private config: Record<string, ProviderConfig>;

  constructor(config?: Record<string, ProviderConfig>) {
    this.providers = new Map();
    
    // Use provided config or import default config
    if (config) {
      this.config = config;
    } else {
      // Import default config dynamically to avoid circular dependencies
      this.config = this.getDefaultConfig();
    }
    
    this.initializeProviders();
  }

  /**
   * Generate text completion using specified provider
   */
  async generateText(request: TextGenerationRequest): Promise<TextGenerationResponse> {
    const provider = this.getProvider(request.provider);
    
    if (!this.supportsFeature(request.provider, 'text-generation')) {
      throw new Error(`Provider '${request.provider}' does not support text generation`);
    }
    
    return await provider.generateText(request);
  }

  /**
   * Analyze image content using specified provider
   */
  async analyzeImage(request: ImageAnalysisRequest): Promise<ImageAnalysisResponse> {
    const provider = this.getProvider(request.provider);
    
    if (!this.supportsFeature(request.provider, 'image-analysis')) {
      throw new Error(`Provider '${request.provider}' does not support image analysis`);
    }
    
    return await provider.analyzeImage(request);
  }

  /**
   * Get information about all available providers
   */
  getAvailableProviders(): ProviderInfo[] {
    return Array.from(this.providers.values()).map(provider => provider.getInfo());
  }

  /**
   * Get information about a specific provider
   */
  getProviderInfo(providerName: string): ProviderInfo {
    const provider = this.getProvider(providerName);
    return provider.getInfo();
  }

  /**
   * Check if a provider supports a specific feature
   */
  supportsFeature(providerName: string, feature: 'text-generation' | 'image-analysis'): boolean {
    try {
      const provider = this.getProvider(providerName);
      const info = provider.getInfo();
      return info.supportedFeatures.includes(feature);
    } catch (error) {
      return false;
    }
  }

  /**
   * Get enabled provider names
   */
  getEnabledProviders(): string[] {
    return Object.entries(this.config)
      .filter(([, config]) => config.enabled)
      .map(([name]) => name);
  }

  /**
   * Get provider configuration
   */
  getProviderConfig(providerName: string): ProviderConfig | undefined {
    return this.config[providerName];
  }

  /**
   * Update provider configuration (runtime reconfiguration)
   */
  updateProviderConfig(providerName: string, newConfig: Partial<ProviderConfig>): void {
    const currentConfig = this.config[providerName];
    if (!currentConfig) {
      throw new Error(`Provider '${providerName}' not found in configuration`);
    }

    // Update config
    this.config[providerName] = { ...currentConfig, ...newConfig };

    // Reinitialize provider if it exists and is still enabled
    if (this.config[providerName].enabled) {
      this.initializeProvider(providerName, this.config[providerName]);
    } else {
      // Remove provider if disabled
      this.providers.delete(providerName);
    }
  }

  /**
   * Add a new provider dynamically
   */
  addProvider(name: string, config: ProviderConfig): void {
    this.config[name] = config;
    if (config.enabled) {
      this.initializeProvider(name, config);
    }
  }

  /**
   * Remove a provider
   */
  removeProvider(providerName: string): void {
    this.providers.delete(providerName);
    delete this.config[providerName];
  }

  /**
   * Get a provider instance
   */
  private getProvider(providerName: string): BaseProvider {
    const provider = this.providers.get(providerName);
    if (!provider) {
      const availableProviders = Array.from(this.providers.keys()).join(', ');
      throw new Error(
        `Provider '${providerName}' not found or not enabled. Available providers: ${availableProviders}`
      );
    }
    return provider;
  }

  /**
   * Initialize all enabled providers
   */
  private initializeProviders(): void {
    Object.entries(this.config).forEach(([name, config]) => {
      if (config.enabled) {
        try {
          this.initializeProvider(name, config);
        } catch (error) {
          console.warn(`Failed to initialize provider '${name}':`, error);
        }
      }
    });

    if (this.providers.size === 0) {
      console.warn('No LLM providers were successfully initialized');
    }
  }

  /**
   * Initialize a single provider
   */
  private initializeProvider(name: string, config: ProviderConfig): void {
    switch (name) {
      case 'claude':
        this.providers.set(name, new ClaudeProvider(config));
        break;
      case 'openai':
        this.providers.set(name, new OpenAIProvider(config));
        break;
      case 'gemini':
        this.providers.set(name, new GeminiProvider(config));
        break;
      case 'google-lens':
        this.providers.set(name, new GoogleLensProvider(config));
        break;
      default:
        console.warn(`Unknown provider: ${name}. Skipping initialization.`);
        break;
    }
  }

  /**
   * Get default configuration (fallback when no config provided)
   */
  private getDefaultConfig(): Record<string, ProviderConfig> {
    // Minimal default configuration
    return {
      claude: {
        name: 'claude',
        enabled: !!process.env.ANTHROPIC_API_KEY,
        defaultModel: 'claude-3-5-sonnet-20241022',
        timeout: 30000,
        maxRetries: 2
      },
      openai: {
        name: 'openai',
        enabled: !!process.env.OPENAI_API_KEY,
        defaultModel: 'gpt-4o',
        timeout: 30000,
        maxRetries: 2
      },
      gemini: {
        name: 'gemini',
        enabled: !!process.env.GOOGLE_AI_API_KEY,
        defaultModel: 'gemini-1.5-pro',
        timeout: 30000,
        maxRetries: 2
      },
      'google-lens': {
        name: 'google-lens',
        enabled: !!process.env.GOOGLE_CLOUD_API_KEY || !!process.env.GOOGLE_APPLICATION_CREDENTIALS,
        defaultModel: 'vision-product-search',
        timeout: 15000,
        maxRetries: 1
      }
    };
  }
}
