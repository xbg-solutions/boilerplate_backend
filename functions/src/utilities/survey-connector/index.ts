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
import { COMMUNICATIONS_CONFIG } from '../../config/communications.config';

export function createSurveyConnector(): SurveyConnector | null {
  if (!COMMUNICATIONS_CONFIG.survey.enabled) {
    return null;
  }

  const provider = COMMUNICATIONS_CONFIG.survey.provider;

  if (provider === 'surveymonkey') {
    const config = COMMUNICATIONS_CONFIG.survey.providers.surveymonkey;
    if (!config?.accessToken) {
      throw new Error('SurveyMonkey access token is required');
    }
    return new SurveyConnector(new SurveyMonkeyProvider(config));
  }

  if (provider === 'typeform') {
    const config = COMMUNICATIONS_CONFIG.survey.providers.typeform;
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
