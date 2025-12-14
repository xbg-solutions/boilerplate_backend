# LLM-Connector Utility

A reusable TypeScript utility for abstracting LLM provider interactions across multiple AI services. Provides a unified interface while supporting provider-specific features and user API keys.

## Features

- **Provider Agnostic**: Unified interface for Claude, OpenAI, Gemini, Google Lens, and more
- **Flexible API Keys**: Support both platform keys (default) and user-provided keys
- **Detailed Metrics**: Token usage, costs, and performance data in every response
- **Type Safety**: Full TypeScript support with strict typing
- **Error Handling**: Graceful failures with detailed error information
- **Configurable**: Per-provider timeouts, retries, and model settings

## Quick Start

```typescript
import { llmConnector } from './utilities/llm-connector';

// Text generation
const response = await llmConnector.generateText({
  provider: 'claude',
  model: 'claude-3-5-sonnet-20241022',
  prompt: 'Write a birthday message for Sarah',
  maxTokens: 200
});

console.log(response.text);
console.log(`Cost: $${response.usage.estimatedCost}`);

// Image analysis
const analysis = await llmConnector.analyzeImage({
  provider: 'google-lens',
  model: 'vision-product-search',
  imageUrl: 'https://example.com/product.jpg',
  analysisType: 'product-identification'
});

console.log(analysis.analysis.productInfo);
```

## Installation & Setup

### 1. Add to Your Project

Copy the `llm-connector` directory to your utilities folder:
```
src/utilities/llm-connector/
```

### 2. Create Provider Configuration

Create a configuration file in your project's config directory:

```typescript
// src/config/llm-providers.config.ts
import { ProviderConfig } from '../utilities/llm-connector/types';

export const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  claude: {
    name: 'claude',
    enabled: true,
    defaultModel: 'claude-3-5-sonnet-20241022',
    timeout: 30000,
    maxRetries: 2
  },
  // Add other providers as needed
};
```

### 3. Set Environment Variables

```bash
# API Keys
ANTHROPIC_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here
GOOGLE_CLOUD_API_KEY=your_key_here
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
```

### 4. Install Dependencies

```bash
npm install @anthropic-ai/sdk openai @google-cloud/vision
```

## Configuration Examples

### Basic Configuration
```typescript
export const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  claude: {
    name: 'claude',
    enabled: true,
    defaultModel: 'claude-3-5-sonnet-20241022',
    timeout: 30000,
    maxRetries: 2
  },
  openai: {
    name: 'openai',
    enabled: true,
    defaultModel: 'gpt-4o',
    timeout: 30000,
    maxRetries: 2
  }
};
```

### Production Configuration with Rate Limits
```typescript
export const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  claude: {
    name: 'claude',
    enabled: true,
    defaultModel: 'claude-3-5-sonnet-20241022',
    timeout: 45000,
    maxRetries: 3,
    rateLimits: {
      requestsPerMinute: 100,
      tokensPerMinute: 100000
    }
  },
  openai: {
    name: 'openai',
    enabled: true,
    defaultModel: 'gpt-4o',
    timeout: 60000,
    maxRetries: 3,
    rateLimits: {
      requestsPerMinute: 50,
      tokensPerMinute: 150000
    }
  },
  'openai-cheap': {
    name: 'openai',
    enabled: true,
    defaultModel: 'gpt-4o-mini',
    timeout: 30000,
    maxRetries: 2,
    rateLimits: {
      requestsPerMinute: 200,
      tokensPerMinute: 2000000
    }
  }
};
```

### Development Configuration
```typescript
export const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  claude: {
    name: 'claude',
    enabled: true,
    defaultModel: 'claude-3-haiku-20240307', // Cheaper for development
    timeout: 15000,
    maxRetries: 1
  },
  openai: {
    name: 'openai',
    enabled: false, // Disable in development
    defaultModel: 'gpt-4o-mini',
    timeout: 15000,
    maxRetries: 1
  }
};
```

### Multi-Environment Configuration
```typescript
const isDevelopment = process.env.NODE_ENV === 'development';
const isProduction = process.env.NODE_ENV === 'production';

export const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  claude: {
    name: 'claude',
    enabled: true,
    defaultModel: isDevelopment 
      ? 'claude-3-haiku-20240307'  // Cheaper for dev
      : 'claude-3-5-sonnet-20241022', // Best for production
    timeout: isDevelopment ? 15000 : 45000,
    maxRetries: isDevelopment ? 1 : 3,
    rateLimits: isProduction ? {
      requestsPerMinute: 100,
      tokensPerMinute: 100000
    } : undefined
  },
  openai: {
    name: 'openai',
    enabled: !isDevelopment, // Only in staging/production
    defaultModel: 'gpt-4o',
    timeout: 30000,
    maxRetries: 2
  }
};
```

## Usage Patterns

### Service Integration
```typescript
// services/ai-content.service.ts
import { llmConnector } from '../utilities/llm-connector';

export class AIContentService {
  async generateContent(prompt: string, userApiKey?: string): Promise<string> {
    const response = await llmConnector.generateText({
      provider: 'claude',
      model: 'claude-3-5-sonnet-20241022',
      prompt,
      userApiKey // Optional user-provided key
    });

    if (!response.success) {
      throw new Error(`Content generation failed: ${response.error}`);
    }

    // Log usage for cost tracking
    this.logUsage(response.usage);
    
    return response.text;
  }

  private logUsage(usage: any): void {
    // Store usage metrics for billing/analytics
    console.log('LLM Usage:', usage);
  }
}
```

### Event-Driven Usage (Subscribers)
```typescript
// subscribers/image-analysis.subscriber.ts
import { llmConnector } from '../utilities/llm-connector';

export class ImageAnalysisSubscriber {
  async handleImageUpload(imageUrl: string, metadata: any): Promise<void> {
    if (metadata.needsProductIdentification) {
      const response = await llmConnector.analyzeImage({
        provider: 'google-lens',
        model: 'vision-product-search',
        imageUrl,
        analysisType: 'product-identification'
      });

      if (response.success) {
        await this.updateProduct(metadata.itemId, response.analysis.productInfo);
      }
    }
  }
}
```

### Custom Provider Configurations
```typescript
// For projects needing custom configurations
import { LLMConnector } from './utilities/llm-connector';

const customConfig = {
  claude: {
    name: 'claude',
    enabled: true,
    defaultModel: 'claude-3-opus-20240229', // Custom model choice
    timeout: 60000, // Longer timeout for complex tasks
    maxRetries: 5
  }
};

const customConnector = new LLMConnector(customConfig);
```

## Error Handling

```typescript
const response = await llmConnector.generateText({
  provider: 'claude',
  model: 'claude-3-5-sonnet-20241022',
  prompt: 'Generate text'
});

if (!response.success) {
  switch (response.error) {
    case 'Rate limit exceeded for provider':
      // Handle rate limiting
      await this.retryLater();
      break;
    case 'Invalid API key provided':
      // Handle auth errors
      this.notifyAdminOfKeyIssue();
      break;
    default:
      // Handle generic errors
      this.logError(response.error);
  }
}
```

## Testing

### Unit Tests
```typescript
// tests/llm-connector.test.ts
import { LLMConnector } from '../src/utilities/llm-connector';

const testConfig = {
  claude: {
    name: 'claude',
    enabled: true,
    defaultModel: 'claude-3-haiku-20240307',
    timeout: 5000,
    maxRetries: 1
  }
};

describe('LLMConnector', () => {
  let connector: LLMConnector;

  beforeEach(() => {
    connector = new LLMConnector(testConfig);
  });

  it('should generate text successfully', async () => {
    const response = await connector.generateText({
      provider: 'claude',
      model: 'claude-3-haiku-20240307',
      prompt: 'Hello world'
    });

    expect(response.success).toBe(true);
    expect(response.text).toBeDefined();
    expect(response.usage.totalTokens).toBeGreaterThan(0);
  });
});
```

### Mock Configuration for Tests
```typescript
export const MOCK_PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  'mock-claude': {
    name: 'claude',
    enabled: true,
    defaultModel: 'claude-3-haiku-20240307',
    timeout: 1000,
    maxRetries: 0 // No retries in tests
  }
};
```

## Cost Management

### Usage Tracking
```typescript
// Track costs per service/user
const response = await llmConnector.generateText(request);

await usageTracker.recordUsage({
  service: 'well-wishes',
  userId: request.userId,
  provider: response.provider,
  model: response.model,
  inputTokens: response.usage.inputTokens,
  outputTokens: response.usage.outputTokens,
  estimatedCost: response.usage.estimatedCost,
  requestId: response.requestId
});
```

### Budget Controls
```typescript
// Check budget before expensive operations
const userBudget = await budgetService.getRemainingBudget(userId);
const estimatedCost = this.estimateRequestCost(request);

if (estimatedCost > userBudget) {
  throw new Error('Insufficient budget for request');
}

const response = await llmConnector.generateText(request);
```

## Environment-Specific Configurations

### Development
```bash
# .env.development
ANTHROPIC_API_KEY=sk-ant-dev-key
NODE_ENV=development
LLM_CONNECTOR_TIMEOUT=15000
```

### Production
```bash
# .env.production
ANTHROPIC_API_KEY=sk-ant-prod-key
OPENAI_API_KEY=sk-prod-key
GOOGLE_CLOUD_API_KEY=prod-key
NODE_ENV=production
LLM_CONNECTOR_TIMEOUT=45000
LLM_CONNECTOR_MAX_RETRIES=3
```

## Migration Guide

### From Direct Provider SDKs

**Before:**
```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const response = await client.messages.create({
  model: 'claude-3-5-sonnet-20241022',
  messages: [{ role: 'user', content: prompt }],
  max_tokens: 1000
});
```

**After:**
```typescript
import { llmConnector } from './utilities/llm-connector';

const response = await llmConnector.generateText({
  provider: 'claude',
  model: 'claude-3-5-sonnet-20241022',
  prompt,
  maxTokens: 1000
});
```

### Adding New Providers

1. Create provider class extending `BaseProvider`
2. Add to providers directory
3. Update connector initialization
4. Add to configuration interface
5. Update documentation

## Troubleshooting

### Common Issues

**Provider not found:**
```typescript
// Ensure provider is enabled in config
const config = PROVIDER_CONFIGS['claude'];
console.log('Enabled:', config.enabled);
```

**API key errors:**
```bash
# Check environment variables
echo $ANTHROPIC_API_KEY
```

**Timeout issues:**
```typescript
// Increase timeout in config
claude: {
  // ...
  timeout: 60000 // 60 seconds
}
```

### Debug Mode
```typescript
// Enable detailed logging
process.env.LLM_CONNECTOR_DEBUG = 'true';
```

## Roadmap

- [ ] Caching layer for repeated prompts
- [ ] Load balancing across multiple API keys
- [ ] Automatic cost optimization routing
- [ ] Provider health monitoring
- [ ] Centralized prompt management
- [ ] A/B testing framework

## Contributing

When adding new providers:
1. Follow the `BaseProvider` interface
2. Add comprehensive error handling
3. Include usage metrics calculation
4. Update configuration examples
5. Add unit tests

## License

This utility is designed to be reusable across projects. Copy and modify as needed for your use cases.
