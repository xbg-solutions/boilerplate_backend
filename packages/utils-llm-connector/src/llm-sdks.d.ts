/**
 * Type declarations for optional LLM SDK dependencies
 * These SDKs are loaded dynamically at runtime, so they are not required at compile time
 */

// Anthropic SDK
declare module '@anthropic-ai/sdk' {
  export default class Anthropic {
    constructor(config: { apiKey: string });
    messages: {
      create(params: any): Promise<any>;
    };
  }
}

// OpenAI SDK
declare module 'openai' {
  export default class OpenAI {
    constructor(config: { apiKey: string });
    chat: {
      completions: {
        create(params: any): Promise<any>;
      };
    };
  }
}

// Google Generative AI SDK
declare module '@google/generative-ai' {
  export class GoogleGenerativeAI {
    constructor(apiKey: string);
    getGenerativeModel(config: { model: string }): any;
  }
}

// Google Cloud Vision SDK
declare module '@google-cloud/vision' {
  export class ImageAnnotatorClient {
    constructor(config?: any);
    productSearch(request: any): Promise<any>;
    textDetection(request: any): Promise<any>;
    objectLocalization(request: any): Promise<any>;
  }
}
