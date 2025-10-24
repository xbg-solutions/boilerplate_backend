/**
 * Survey Connector
 * Survey questions and responses management
 */

import {
  Survey,
  SurveyResponse,
  CreateSurveyRequest,
  UpdateSurveyRequest,
  SubmitResponseRequest,
  SurveyQueryOptions,
  SurveyConnectorResponse,
} from './types';
import { logger } from '../logger';

/**
 * Survey Provider Interface
 */
export interface SurveyProvider {
  /**
   * Get survey by ID with questions
   */
  getSurvey(surveyId: string): Promise<Survey>;

  /**
   * Get all surveys
   */
  getSurveys(options?: SurveyQueryOptions): Promise<Survey[]>;

  /**
   * Create new survey
   */
  createSurvey(request: CreateSurveyRequest): Promise<Survey>;

  /**
   * Update survey
   */
  updateSurvey(surveyId: string, updates: UpdateSurveyRequest): Promise<Survey>;

  /**
   * Delete survey
   */
  deleteSurvey(surveyId: string): Promise<void>;

  /**
   * Get responses for a survey
   */
  getResponses(surveyId: string, options?: SurveyQueryOptions): Promise<SurveyResponse[]>;

  /**
   * Get single response
   */
  getResponse(responseId: string): Promise<SurveyResponse>;

  /**
   * Submit response to survey
   */
  submitResponse(request: SubmitResponseRequest): Promise<SurveyResponse>;
}

/**
 * Survey Connector
 * Unified interface for survey platforms
 */
export class SurveyConnector {
  private provider: SurveyProvider;

  constructor(provider: SurveyProvider) {
    this.provider = provider;
  }

  /**
   * Get survey by ID
   */
  async getSurvey(surveyId: string): Promise<SurveyConnectorResponse<Survey>> {
    logger.info('Fetching survey', { surveyId });

    try {
      const survey = await this.provider.getSurvey(surveyId);
      return { success: true, data: survey };
    } catch (error) {
      logger.error('Error fetching survey', {
        surveyId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: {
          code: 'FETCH_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Get all surveys
   */
  async getSurveys(options?: SurveyQueryOptions): Promise<SurveyConnectorResponse<Survey[]>> {
    logger.info('Fetching surveys', { options });

    try {
      const surveys = await this.provider.getSurveys(options);
      return { success: true, data: surveys };
    } catch (error) {
      logger.error('Error fetching surveys', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: {
          code: 'FETCH_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Create new survey
   */
  async createSurvey(request: CreateSurveyRequest): Promise<SurveyConnectorResponse<Survey>> {
    logger.info('Creating survey', {
      title: request.title,
      questionCount: request.questions.length,
    });

    try {
      const survey = await this.provider.createSurvey(request);
      return { success: true, data: survey };
    } catch (error) {
      logger.error('Error creating survey', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: {
          code: 'CREATE_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Update survey
   */
  async updateSurvey(surveyId: string, updates: UpdateSurveyRequest): Promise<SurveyConnectorResponse<Survey>> {
    logger.info('Updating survey', { surveyId, updates });

    try {
      const survey = await this.provider.updateSurvey(surveyId, updates);
      return { success: true, data: survey };
    } catch (error) {
      logger.error('Error updating survey', {
        surveyId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: {
          code: 'UPDATE_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Delete survey
   */
  async deleteSurvey(surveyId: string): Promise<SurveyConnectorResponse<void>> {
    logger.info('Deleting survey', { surveyId });

    try {
      await this.provider.deleteSurvey(surveyId);
      return { success: true };
    } catch (error) {
      logger.error('Error deleting survey', {
        surveyId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: {
          code: 'DELETE_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Get responses for a survey
   */
  async getResponses(surveyId: string, options?: SurveyQueryOptions): Promise<SurveyConnectorResponse<SurveyResponse[]>> {
    logger.info('Fetching survey responses', { surveyId, options });

    try {
      const responses = await this.provider.getResponses(surveyId, options);
      return { success: true, data: responses };
    } catch (error) {
      logger.error('Error fetching responses', {
        surveyId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: {
          code: 'FETCH_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Get single response
   */
  async getResponse(responseId: string): Promise<SurveyConnectorResponse<SurveyResponse>> {
    logger.info('Fetching response', { responseId });

    try {
      const response = await this.provider.getResponse(responseId);
      return { success: true, data: response };
    } catch (error) {
      logger.error('Error fetching response', {
        responseId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: {
          code: 'FETCH_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Submit response to survey
   */
  async submitResponse(request: SubmitResponseRequest): Promise<SurveyConnectorResponse<SurveyResponse>> {
    logger.info('Submitting survey response', {
      surveyId: request.surveyId,
      answerCount: request.answers.length,
    });

    try {
      const response = await this.provider.submitResponse(request);
      return { success: true, data: response };
    } catch (error) {
      logger.error('Error submitting response', {
        surveyId: request.surveyId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: {
          code: 'SUBMIT_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
}
