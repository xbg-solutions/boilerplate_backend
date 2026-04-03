/**
 * SurveyMonkey Provider for Survey Connector
 * https://developer.surveymonkey.com/api/v3/
 */

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

export interface SurveyMonkeyProviderConfig {
  accessToken: string;
}

export class SurveyMonkeyProvider implements SurveyProvider {
  private baseURL: string;
  private headers: Record<string, string>;

  constructor(config: SurveyMonkeyProviderConfig) {
    this.baseURL = 'https://api.surveymonkey.com/v3';
    this.headers = {
      'Authorization': `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json',
    };
  }

  private async request<T = any>(path: string, options: {
    method?: string;
    body?: any;
    params?: Record<string, any>;
  } = {}): Promise<{ data: T }> {
    const { method = 'GET', body, params } = options;
    let url = `${this.baseURL}${path}`;
    if (params) {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) query.append(key, String(value));
      }
      const qs = query.toString();
      if (qs) url += `?${qs}`;
    }
    const res = await fetch(url, {
      method,
      headers: this.headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => undefined);
      const error: any = new Error(`HTTP ${res.status}: ${res.statusText}`);
      error.response = { status: res.status, data: errorData };
      throw error;
    }
    const data = await res.json();
    return { data };
  }

  async getSurvey(surveyId: string): Promise<Survey> {
    const [surveyResp, detailsResp] = await Promise.all([
      this.request(`/surveys/${surveyId}`),
      this.request(`/surveys/${surveyId}/details`),
    ]);

    return this.mapSurveyMonkeySurveyToSurvey(surveyResp.data, detailsResp.data);
  }

  async getSurveys(options?: SurveyQueryOptions): Promise<Survey[]> {
    const response = await this.request('/surveys', {
      params: {
        page: options?.page || 1,
        per_page: options?.limit || 50,
      },
    });

    return Promise.all(
      response.data.data.map(async (survey: any) => {
        const details = await this.request(`/surveys/${survey.id}/details`);
        return this.mapSurveyMonkeySurveyToSurvey(survey, details.data);
      })
    );
  }

  async createSurvey(request: CreateSurveyRequest): Promise<Survey> {
    // Create survey
    const surveyResp = await this.request('/surveys', {
      method: 'POST',
      body: { title: request.title },
    });

    const surveyId = surveyResp.data.id;

    // Add pages and questions
    const pageResp = await this.request(`/surveys/${surveyId}/pages`, {
      method: 'POST',
      body: { title: 'Page 1' },
    });

    const pageId = pageResp.data.id;

    for (const question of request.questions) {
      await this.request(`/surveys/${surveyId}/pages/${pageId}/questions`, {
        method: 'POST',
        body: {
          heading: question.text,
          family: this.mapQuestionTypeToSurveyMonkey(question.type),
          subtype: 'single',
          answers: {
            choices: question.choices?.map(choice => ({ text: choice })),
          },
        },
      });
    }

    return this.getSurvey(surveyId);
  }

  async updateSurvey(surveyId: string, updates: UpdateSurveyRequest): Promise<Survey> {
    const payload: any = {};
    if (updates.title) payload.title = updates.title;

    await this.request(`/surveys/${surveyId}`, { method: 'PATCH', body: payload });
    return this.getSurvey(surveyId);
  }

  async deleteSurvey(surveyId: string): Promise<void> {
    await this.request(`/surveys/${surveyId}`, { method: 'DELETE' });
  }

  async getResponses(surveyId: string, options?: SurveyQueryOptions): Promise<SurveyResponse[]> {
    const response = await this.request(`/surveys/${surveyId}/responses/bulk`, {
      params: {
        page: options?.page || 1,
        per_page: options?.limit || 100,
      },
    });

    return response.data.data.map((resp: any) => this.mapSurveyMonkeyResponseToSurveyResponse(resp, surveyId));
  }

  async getResponse(responseId: string): Promise<SurveyResponse> {
    const response = await this.request(`/responses/${responseId}/details`);
    return this.mapSurveyMonkeyResponseToSurveyResponse(response.data, response.data.survey_id);
  }

  async submitResponse(request: SubmitResponseRequest): Promise<SurveyResponse> {
    // SurveyMonkey doesn't support direct API submission - responses come through web collectors
    throw new Error('SurveyMonkey does not support API-based response submission. Use web collectors instead.');
  }

  private mapSurveyMonkeySurveyToSurvey(survey: any, details: any): Survey {
    return {
      id: survey.id,
      title: survey.title,
      description: survey.description,
      status: survey.response_count > 0 ? 'active' : 'draft',
      questions: details.pages?.flatMap((page: any) =>
        page.questions?.map((q: any) => ({
          id: q.id,
          text: q.headings?.[0]?.heading || q.heading,
          type: this.mapSurveyMonkeyQuestionType(q.family),
          required: q.required?.text === 'required',
          choices: q.answers?.choices?.map((c: any) => ({
            id: c.id,
            text: c.text,
          })),
        })) || []
      ) || [],
      responseCount: survey.response_count,
      createdAt: new Date(survey.date_created),
      updatedAt: new Date(survey.date_modified),
      url: survey.href,
    };
  }

  private mapSurveyMonkeyResponseToSurveyResponse(response: any, surveyId: string): SurveyResponse {
    return {
      id: response.id,
      surveyId,
      respondentId: response.recipient_id,
      answers: response.pages?.flatMap((page: any) =>
        page.questions?.map((q: any) => ({
          questionId: q.id,
          value: q.answers?.[0]?.text || q.answers?.[0]?.choice_id,
          text: q.answers?.[0]?.text,
          choiceIds: q.answers?.map((a: any) => a.choice_id).filter(Boolean),
        })) || []
      ) || [],
      completedAt: new Date(response.date_modified),
    };
  }

  private mapQuestionTypeToSurveyMonkey(type: QuestionType): string {
    const map: Record<QuestionType, string> = {
      'multiple_choice': 'multiple_choice',
      'single_choice': 'single_choice',
      'text': 'open_ended',
      'email': 'open_ended',
      'number': 'open_ended',
      'rating': 'matrix',
      'matrix': 'matrix',
      'date': 'datetime',
    };
    return map[type] || 'open_ended';
  }

  private mapSurveyMonkeyQuestionType(family: string): QuestionType {
    const map: Record<string, QuestionType> = {
      'multiple_choice': 'multiple_choice',
      'single_choice': 'single_choice',
      'open_ended': 'text',
      'matrix': 'matrix',
      'datetime': 'date',
    };
    return map[family] || 'text';
  }
}
