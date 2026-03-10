/**
 * Survey Connector Barrel Export
 */

export * from './types';
export * from './survey-connector';
export * from './providers/surveymonkey-provider';
export * from './providers/typeform-provider';

import { SurveyConnector } from './survey-connector';
import { SurveyMonkeyProvider } from './providers/surveymonkey-provider';
import { TypeformProvider } from './providers/typeform-provider';

// Config is provided via initializeSurveyConnector() at app startup
let connectorConfig: any = null;

export function initializeSurveyConnector(config: any): void {
  connectorConfig = config;
  // Reset singleton so it gets re-created with new config
  surveyConnectorInstance = undefined;
}

export function createSurveyConnector(): SurveyConnector | null {
  if (!connectorConfig) {
    throw new Error('Survey connector not initialized. Call initializeSurveyConnector() first.');
  }

  if (!connectorConfig.survey.enabled) {
    return null;
  }

  const provider = connectorConfig.survey.provider;

  if (provider === 'surveymonkey') {
    const config = connectorConfig.survey.providers.surveymonkey;
    if (!config?.accessToken) {
      throw new Error('SurveyMonkey access token is required');
    }
    return new SurveyConnector(new SurveyMonkeyProvider(config));
  }

  if (provider === 'typeform') {
    const config = connectorConfig.survey.providers.typeform;
    if (!config?.accessToken) {
      throw new Error('Typeform access token is required');
    }
    return new SurveyConnector(new TypeformProvider(config));
  }

  throw new Error(`Unsupported survey provider: ${provider}`);
}

let surveyConnectorInstance: SurveyConnector | null | undefined;

export function getSurveyConnector(): SurveyConnector | null {
  if (surveyConnectorInstance === undefined) {
    surveyConnectorInstance = createSurveyConnector();
  }
  return surveyConnectorInstance;
}
