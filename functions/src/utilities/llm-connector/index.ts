// Main connector class
import { LLMConnector } from './llm-connector';
export { LLMConnector };

// Types
export * from './types';

// Providers (for advanced usage)
export * from './providers';

// Create singleton instance with project config
let defaultConnector: LLMConnector | null = null;

/**
 * Get the default LLM connector instance
 * Uses project configuration if available, otherwise falls back to environment-based config
 */
export function getLLMConnector(): LLMConnector {
  if (!defaultConnector) {
    try {
      // Try to import project-specific configuration
      const { PROVIDER_CONFIGS } = require('../../config/llm-providers.config');
      defaultConnector = new LLMConnector(PROVIDER_CONFIGS);
    } catch (error) {
      // Fall back to default configuration if project config not found
      console.warn('Project LLM configuration not found, using default configuration');
      defaultConnector = new LLMConnector();
    }
  }
  return defaultConnector;
}

/**
 * Singleton instance for convenience
 * This will use the project configuration automatically
 */
export const llmConnector = getLLMConnector();

// Re-export for convenience
export default llmConnector;
