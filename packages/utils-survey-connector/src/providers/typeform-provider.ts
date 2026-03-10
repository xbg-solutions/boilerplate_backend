/**
 * Typeform Provider for Survey Connector
 * https://developer.typeform.com/
 */

import axios, { AxiosInstance } from 'axios';
import { SurveyProvider } from '../survey-connector';
import {
  Survey,
  SurveyResponse,
  CreateSurveyRequest,
  UpdateSurveyRequest,
  SubmitResponseRequest,
  SurveyQueryOptions,
  QuestionType,
} from '../types';

export interface TypeformProviderConfig {
  accessToken: string;
}

export class TypeformProvider implements SurveyProvider {
  private client: AxiosInstance;

  constructor(config: TypeformProviderConfig) {
    this.client = axios.create({
      baseURL: 'https://api.typeform.com',
      headers: {
        'Authorization': `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
    });
  }

  async getSurvey(surveyId: string): Promise<Survey> {
    const response = await this.client.get(`/forms/${surveyId}`);
    return this.mapTypeformToSurvey(response.data);
  }

  async getSurveys(options?: SurveyQueryOptions): Promise<Survey[]> {
    const response = await this.client.get('/forms', {
      params: {
        page: options?.page || 1,
        page_size: options?.limit || 200,
      },
    });

    return response.data.items.map((form: any) => this.mapTypeformToSurvey(form));
  }

  async createSurvey(request: CreateSurveyRequest): Promise<Survey> {
    const payload = {
      title: request.title,
      type: 'quiz',
      fields: request.questions.map((q, idx) => ({
        title: q.text,
        type: this.mapQuestionTypeToTypeform(q.type),
        required: q.required,
        properties: q.choices ? {
          choices: q.choices.map(choice => ({ label: choice })),
        } : {},
        ref: `question_${idx + 1}`,
      })),
    };

    const response = await this.client.post('/forms', payload);
    return this.mapTypeformToSurvey(response.data);
  }

  async updateSurvey(surveyId: string, updates: UpdateSurveyRequest): Promise<Survey> {
    const payload: any = {};
    if (updates.title) payload.title = updates.title;

    await this.client.patch(`/forms/${surveyId}`, payload);
    return this.getSurvey(surveyId);
  }

  async deleteSurvey(surveyId: string): Promise<void> {
    await this.client.delete(`/forms/${surveyId}`);
  }

  async getResponses(surveyId: string, options?: SurveyQueryOptions): Promise<SurveyResponse[]> {
    const response = await this.client.get(`/forms/${surveyId}/responses`, {
      params: {
        page_size: options?.limit || 1000,
      },
    });

    return response.data.items.map((resp: any) => this.mapTypeformResponseToSurveyResponse(resp, surveyId));
  }

  async getResponse(responseId: string): Promise<SurveyResponse> {
    // Typeform doesn't have a direct endpoint for single response
    // Need to extract from form responses
    throw new Error('Typeform does not support fetching individual responses by ID');
  }

  async submitResponse(request: SubmitResponseRequest): Promise<SurveyResponse> {
    // Typeform doesn't support direct API submission - responses come through form submissions
    throw new Error('Typeform does not support API-based response submission. Use form links instead.');
  }

  private mapTypeformToSurvey(form: any): Survey {
    return {
      id: form.id,
      title: form.title,
      description: form.settings?.meta?.description,
      status: form.published_at ? 'active' : 'draft',
      questions: form.fields?.map((field: any) => ({
        id: field.id,
        text: field.title,
        type: this.mapTypeformQuestionType(field.type),
        required: field.validations?.required,
        choices: field.properties?.choices?.map((c: any) => ({
          id: c.id || c.label,
          text: c.label,
        })),
      })) || [],
      responseCount: form.response_count,
      createdAt: new Date(form.created_at),
      updatedAt: new Date(form.last_updated_at),
      url: form._links?.display,
    };
  }

  private mapTypeformResponseToSurveyResponse(response: any, surveyId: string): SurveyResponse {
    return {
      id: response.response_id || response.token,
      surveyId,
      respondentId: response.hidden?.respondent_id,
      answers: response.answers?.map((answer: any) => ({
        questionId: answer.field.id,
        value: answer[answer.type],
        text: typeof answer[answer.type] === 'string' ? answer[answer.type] : undefined,
        choiceIds: answer.choices ? answer.choices.labels || answer.choices.ids : undefined,
      })) || [],
      completedAt: new Date(response.submitted_at),
      metadata: response.hidden,
    };
  }

  private mapQuestionTypeToTypeform(type: QuestionType): string {
    const map: Record<QuestionType, string> = {
      'multiple_choice': 'multiple_choice',
      'single_choice': 'multiple_choice',
      'text': 'short_text',
      'email': 'email',
      'number': 'number',
      'rating': 'rating',
      'matrix': 'matrix',
      'date': 'date',
    };
    return map[type] || 'short_text';
  }

  private mapTypeformQuestionType(type: string): QuestionType {
    const map: Record<string, QuestionType> = {
      'multiple_choice': 'multiple_choice',
      'short_text': 'text',
      'long_text': 'text',
      'email': 'email',
      'number': 'number',
      'rating': 'rating',
      'opinion_scale': 'rating',
      'date': 'date',
    };
    return map[type] || 'text';
  }
}
