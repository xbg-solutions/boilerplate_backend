/**
 * Survey Connector - Unit Tests
 *
 * Testing WHAT the survey connector does, not HOW it works internally:
 * - Creates and manages surveys with questions
 * - Updates and deletes surveys
 * - Collects and retrieves survey responses
 * - Filters and queries surveys and responses
 * - Provides provider abstraction for survey platforms (Typeform, SurveyMonkey, etc.)
 */

import { SurveyConnector, SurveyProvider } from '../survey-connector';
import {
  Survey,
  SurveyResponse,
  CreateSurveyRequest,
  UpdateSurveyRequest,
  SubmitResponseRequest,
  SurveyQueryOptions,
} from '../types';
import { logger } from '../../logger';

// Mock logger
jest.mock('../../logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('Survey Connector', () => {
  let mockProvider: jest.Mocked<SurveyProvider>;
  let connector: SurveyConnector;

  beforeEach(() => {
    jest.clearAllMocks();

    mockProvider = {
      getSurvey: jest.fn(),
      getSurveys: jest.fn(),
      createSurvey: jest.fn(),
      updateSurvey: jest.fn(),
      deleteSurvey: jest.fn(),
      getResponses: jest.fn(),
      getResponse: jest.fn(),
      submitResponse: jest.fn(),
    };

    connector = new SurveyConnector(mockProvider);
  });

  describe('getSurvey', () => {
    it('retrieves survey by ID', async () => {
      const survey: Survey = {
        id: 'survey-123',
        title: 'Customer Satisfaction Survey',
        description: 'Help us improve',
        status: 'active',
        questions: [
          {
            id: 'q1',
            text: 'How satisfied are you?',
            type: 'rating',
            required: true,
          },
        ],
        responseCount: 150,
        createdAt: new Date(),
      };

      mockProvider.getSurvey.mockResolvedValue(survey);

      const response = await connector.getSurvey('survey-123');

      expect(mockProvider.getSurvey).toHaveBeenCalledWith('survey-123');
      expect(response.success).toBe(true);
      expect(response.data?.id).toBe('survey-123');
      expect(response.data?.title).toBe('Customer Satisfaction Survey');
    });

    it('logs survey fetch', async () => {
      const survey: Survey = {
        id: 'survey-456',
        title: 'Feedback Form',
        questions: [],
      };

      mockProvider.getSurvey.mockResolvedValue(survey);

      await connector.getSurvey('survey-456');

      expect(logger.info).toHaveBeenCalledWith(
        'Fetching survey',
        expect.objectContaining({
          surveyId: 'survey-456',
        })
      );
    });

    it('handles survey not found', async () => {
      mockProvider.getSurvey.mockRejectedValue(new Error('Survey not found'));

      const response = await connector.getSurvey('nonexistent');

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('FETCH_ERROR');
      expect(response.error?.message).toBe('Failed to fetch survey');
    });
  });

  describe('getSurveys', () => {
    it('retrieves all surveys', async () => {
      const surveys: Survey[] = [
        {
          id: 'survey-1',
          title: 'Survey One',
          questions: [],
          status: 'active',
        },
        {
          id: 'survey-2',
          title: 'Survey Two',
          questions: [],
          status: 'draft',
        },
      ];

      mockProvider.getSurveys.mockResolvedValue(surveys);

      const response = await connector.getSurveys();

      expect(mockProvider.getSurveys).toHaveBeenCalledWith(undefined);
      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(2);
    });

    it('filters surveys by status', async () => {
      const options: SurveyQueryOptions = {
        status: 'active',
      };

      const surveys: Survey[] = [
        {
          id: 'survey-active',
          title: 'Active Survey',
          questions: [],
          status: 'active',
        },
      ];

      mockProvider.getSurveys.mockResolvedValue(surveys);

      const response = await connector.getSurveys(options);

      expect(mockProvider.getSurveys).toHaveBeenCalledWith(options);
      expect(response.success).toBe(true);
      expect(response.data?.[0].status).toBe('active');
    });

    it('paginates surveys', async () => {
      const options: SurveyQueryOptions = {
        page: 2,
        limit: 10,
      };

      mockProvider.getSurveys.mockResolvedValue([]);

      await connector.getSurveys(options);

      expect(mockProvider.getSurveys).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 2,
          limit: 10,
        })
      );
    });

    it('handles fetch errors', async () => {
      mockProvider.getSurveys.mockRejectedValue(new Error('API error'));

      const response = await connector.getSurveys();

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('FETCH_ERROR');
    });
  });

  describe('createSurvey', () => {
    it('creates survey successfully', async () => {
      const request: CreateSurveyRequest = {
        title: 'New Survey',
        description: 'Survey description',
        questions: [
          {
            text: 'What is your name?',
            type: 'text',
            required: true,
          },
          {
            text: 'How do you rate us?',
            type: 'rating',
            required: true,
          },
        ],
      };

      const survey: Survey = {
        id: 'survey-new',
        title: 'New Survey',
        description: 'Survey description',
        status: 'draft',
        questions: [
          {
            id: 'q1',
            text: 'What is your name?',
            type: 'text',
            required: true,
          },
          {
            id: 'q2',
            text: 'How do you rate us?',
            type: 'rating',
            required: true,
          },
        ],
        createdAt: new Date(),
      };

      mockProvider.createSurvey.mockResolvedValue(survey);

      const response = await connector.createSurvey(request);

      expect(mockProvider.createSurvey).toHaveBeenCalledWith(request);
      expect(response.success).toBe(true);
      expect(response.data?.id).toBe('survey-new');
    });

    it('logs survey creation', async () => {
      const request: CreateSurveyRequest = {
        title: 'Test Survey',
        questions: [
          { text: 'Q1', type: 'text' },
          { text: 'Q2', type: 'multiple_choice', choices: ['A', 'B'] },
        ],
      };

      const survey: Survey = {
        id: 'survey-test',
        title: 'Test Survey',
        questions: [],
      };

      mockProvider.createSurvey.mockResolvedValue(survey);

      await connector.createSurvey(request);

      expect(logger.info).toHaveBeenCalledWith(
        'Creating survey',
        expect.objectContaining({
          title: 'Test Survey',
          questionCount: 2,
        })
      );
    });

    it('handles creation errors', async () => {
      const request: CreateSurveyRequest = {
        title: 'Invalid Survey',
        questions: [],
      };

      mockProvider.createSurvey.mockRejectedValue(new Error('Invalid request'));

      const response = await connector.createSurvey(request);

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('CREATE_ERROR');
    });
  });

  describe('updateSurvey', () => {
    it('updates survey successfully', async () => {
      const updates: UpdateSurveyRequest = {
        title: 'Updated Title',
        status: 'active',
      };

      const survey: Survey = {
        id: 'survey-123',
        title: 'Updated Title',
        status: 'active',
        questions: [],
      };

      mockProvider.updateSurvey.mockResolvedValue(survey);

      const response = await connector.updateSurvey('survey-123', updates);

      expect(mockProvider.updateSurvey).toHaveBeenCalledWith('survey-123', updates);
      expect(response.success).toBe(true);
      expect(response.data?.title).toBe('Updated Title');
    });

    it('logs survey update', async () => {
      const updates: UpdateSurveyRequest = {
        status: 'closed',
      };

      const survey: Survey = {
        id: 'survey-456',
        title: 'Survey',
        status: 'closed',
        questions: [],
      };

      mockProvider.updateSurvey.mockResolvedValue(survey);

      await connector.updateSurvey('survey-456', updates);

      expect(logger.info).toHaveBeenCalledWith(
        'Updating survey',
        expect.objectContaining({
          surveyId: 'survey-456',
          updates,
        })
      );
    });

    it('handles update errors', async () => {
      const updates: UpdateSurveyRequest = {
        title: 'New Title',
      };

      mockProvider.updateSurvey.mockRejectedValue(new Error('Survey not found'));

      const response = await connector.updateSurvey('nonexistent', updates);

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('UPDATE_ERROR');
    });
  });

  describe('deleteSurvey', () => {
    it('deletes survey successfully', async () => {
      mockProvider.deleteSurvey.mockResolvedValue(undefined);

      const response = await connector.deleteSurvey('survey-123');

      expect(mockProvider.deleteSurvey).toHaveBeenCalledWith('survey-123');
      expect(response.success).toBe(true);
    });

    it('logs survey deletion', async () => {
      mockProvider.deleteSurvey.mockResolvedValue(undefined);

      await connector.deleteSurvey('survey-789');

      expect(logger.info).toHaveBeenCalledWith(
        'Deleting survey',
        expect.objectContaining({
          surveyId: 'survey-789',
        })
      );
    });

    it('handles deletion errors', async () => {
      mockProvider.deleteSurvey.mockRejectedValue(new Error('Cannot delete survey with responses'));

      const response = await connector.deleteSurvey('survey-active');

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('DELETE_ERROR');
    });
  });

  describe('getResponses', () => {
    it('retrieves all responses for survey', async () => {
      const responses: SurveyResponse[] = [
        {
          id: 'response-1',
          surveyId: 'survey-123',
          answers: [
            {
              questionId: 'q1',
              value: 5,
            },
          ],
          completedAt: new Date(),
        },
        {
          id: 'response-2',
          surveyId: 'survey-123',
          answers: [
            {
              questionId: 'q1',
              value: 4,
            },
          ],
          completedAt: new Date(),
        },
      ];

      mockProvider.getResponses.mockResolvedValue(responses);

      const response = await connector.getResponses('survey-123');

      expect(mockProvider.getResponses).toHaveBeenCalledWith('survey-123', undefined);
      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(2);
    });

    it('filters responses with options', async () => {
      const options: SurveyQueryOptions = {
        limit: 50,
        page: 1,
      };

      mockProvider.getResponses.mockResolvedValue([]);

      await connector.getResponses('survey-456', options);

      expect(mockProvider.getResponses).toHaveBeenCalledWith('survey-456', options);
    });

    it('logs response fetch', async () => {
      mockProvider.getResponses.mockResolvedValue([]);

      await connector.getResponses('survey-789');

      expect(logger.info).toHaveBeenCalledWith(
        'Fetching survey responses',
        expect.objectContaining({
          surveyId: 'survey-789',
        })
      );
    });

    it('handles fetch errors', async () => {
      mockProvider.getResponses.mockRejectedValue(new Error('Survey not found'));

      const response = await connector.getResponses('nonexistent');

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('FETCH_ERROR');
    });
  });

  describe('getResponse', () => {
    it('retrieves single response by ID', async () => {
      const surveyResponse: SurveyResponse = {
        id: 'response-123',
        surveyId: 'survey-456',
        answers: [
          {
            questionId: 'q1',
            value: 'Great service',
            text: 'Great service',
          },
          {
            questionId: 'q2',
            value: 5,
          },
        ],
        completedAt: new Date(),
        metadata: {
          browser: 'Chrome',
        },
      };

      mockProvider.getResponse.mockResolvedValue(surveyResponse);

      const response = await connector.getResponse('response-123');

      expect(mockProvider.getResponse).toHaveBeenCalledWith('response-123');
      expect(response.success).toBe(true);
      expect(response.data?.id).toBe('response-123');
      expect(response.data?.answers).toHaveLength(2);
    });

    it('logs response fetch', async () => {
      const surveyResponse: SurveyResponse = {
        id: 'response-456',
        surveyId: 'survey-123',
        answers: [],
      };

      mockProvider.getResponse.mockResolvedValue(surveyResponse);

      await connector.getResponse('response-456');

      expect(logger.info).toHaveBeenCalledWith(
        'Fetching response',
        expect.objectContaining({
          responseId: 'response-456',
        })
      );
    });

    it('handles response not found', async () => {
      mockProvider.getResponse.mockRejectedValue(new Error('Response not found'));

      const response = await connector.getResponse('nonexistent');

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('FETCH_ERROR');
    });
  });

  describe('submitResponse', () => {
    it('submits response successfully', async () => {
      const request: SubmitResponseRequest = {
        surveyId: 'survey-123',
        answers: [
          {
            questionId: 'q1',
            value: 'John Doe',
            text: 'John Doe',
          },
          {
            questionId: 'q2',
            value: 5,
          },
          {
            questionId: 'q3',
            value: ['choice-1', 'choice-3'],
            choiceIds: ['choice-1', 'choice-3'],
          },
        ],
        respondentId: 'user-789',
      };

      const surveyResponse: SurveyResponse = {
        id: 'response-new',
        surveyId: 'survey-123',
        respondentId: 'user-789',
        answers: request.answers,
        completedAt: new Date(),
      };

      mockProvider.submitResponse.mockResolvedValue(surveyResponse);

      const response = await connector.submitResponse(request);

      expect(mockProvider.submitResponse).toHaveBeenCalledWith(request);
      expect(response.success).toBe(true);
      expect(response.data?.id).toBe('response-new');
    });

    it('logs response submission', async () => {
      const request: SubmitResponseRequest = {
        surveyId: 'survey-456',
        answers: [
          { questionId: 'q1', value: 'answer' },
          { questionId: 'q2', value: 'answer' },
        ],
      };

      const surveyResponse: SurveyResponse = {
        id: 'response-test',
        surveyId: 'survey-456',
        answers: request.answers,
      };

      mockProvider.submitResponse.mockResolvedValue(surveyResponse);

      await connector.submitResponse(request);

      expect(logger.info).toHaveBeenCalledWith(
        'Submitting survey response',
        expect.objectContaining({
          surveyId: 'survey-456',
          answerCount: 2,
        })
      );
    });

    it('handles submission errors', async () => {
      const request: SubmitResponseRequest = {
        surveyId: 'survey-closed',
        answers: [],
      };

      mockProvider.submitResponse.mockRejectedValue(new Error('Survey is closed'));

      const response = await connector.submitResponse(request);

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('SUBMIT_ERROR');
    });
  });

  describe('error handling', () => {
    it('handles non-Error exceptions', async () => {
      mockProvider.getSurvey.mockRejectedValue('String error');

      const response = await connector.getSurvey('survey-123');

      expect(response.success).toBe(false);
      expect(logger.error).toHaveBeenCalled();
    });

    it('logs all errors appropriately', async () => {
      mockProvider.createSurvey.mockRejectedValue(new Error('Test error'));

      await connector.createSurvey({
        title: 'Test',
        questions: [],
      });

      expect(logger.error).toHaveBeenCalledWith(
        'Error creating survey',
        expect.any(Error)
      );
    });
  });
});
