/**
 * Survey Connector Types
 * Survey questions and responses management
 */

/**
 * Survey question types
 */
export type QuestionType =
  | 'multiple_choice'
  | 'single_choice'
  | 'text'
  | 'email'
  | 'number'
  | 'rating'
  | 'matrix'
  | 'date';

/**
 * Survey question
 */
export interface SurveyQuestion {
  id: string;
  text: string;
  type: QuestionType;
  required?: boolean;
  choices?: Array<{
    id: string;
    text: string;
  }>;
  properties?: Record<string, any>;
}

/**
 * Survey structure
 */
export interface Survey {
  id: string;
  title: string;
  description?: string;
  status?: 'draft' | 'active' | 'closed';
  questions: SurveyQuestion[];
  responseCount?: number;
  createdAt?: Date;
  updatedAt?: Date;
  url?: string;
}

/**
 * Survey response answer
 */
export interface SurveyAnswer {
  questionId: string;
  value: any; // Can be string, number, array of strings, etc.
  text?: string; // For text answers
  choiceIds?: string[]; // For multiple choice
}

/**
 * Survey response
 */
export interface SurveyResponse {
  id: string;
  surveyId: string;
  respondentId?: string;
  answers: SurveyAnswer[];
  completedAt?: Date;
  metadata?: Record<string, any>;
}

/**
 * Create survey request
 */
export interface CreateSurveyRequest {
  title: string;
  description?: string;
  questions: Array<{
    text: string;
    type: QuestionType;
    required?: boolean;
    choices?: string[];
  }>;
}

/**
 * Update survey request
 */
export interface UpdateSurveyRequest {
  title?: string;
  description?: string;
  status?: 'draft' | 'active' | 'closed';
}

/**
 * Submit response request
 */
export interface SubmitResponseRequest {
  surveyId: string;
  answers: SurveyAnswer[];
  respondentId?: string;
}

/**
 * Survey query options
 */
export interface SurveyQueryOptions {
  page?: number;
  limit?: number;
  status?: 'draft' | 'active' | 'closed';
  sort?: {
    field: string;
    order: 'asc' | 'desc';
  };
}

/**
 * Survey response wrapper
 */
export interface SurveyConnectorResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}
