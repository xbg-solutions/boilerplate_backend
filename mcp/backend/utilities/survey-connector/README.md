# Survey Connector

> Create and manage surveys via SurveyMonkey, Typeform, and Google Forms

## Overview

The Survey Connector provides integration with survey platforms to create, distribute, and collect survey responses. Supports SurveyMonkey, Typeform, Google Forms, and other platforms.

## Features

- **Survey creation** from templates
- **Question management**
- **Survey distribution** via email/link
- **Response collection**
- **Analytics and reporting**
- **Multiple providers** support
- **Provider abstraction**

## Configuration

```typescript
export const COMMUNICATIONS_CONFIG = {
  survey: {
    enabled: true,
    provider: 'surveymonkey', // 'typeform' | 'google-forms'
    providers: {
      surveymonkey: {
        apiKey: process.env.SURVEYMONKEY_API_KEY || '',
      },
      typeform: {
        apiKey: process.env.TYPEFORM_API_KEY || '',
      },
    },
  },
};
```

## Usage

```typescript
const surveyConnector = getSurveyConnector();

// Create survey
const survey = await surveyConnector.createSurvey({
  title: 'Customer Satisfaction Survey',
  questions: [
    {
      type: 'rating',
      text: 'How satisfied are you with our service?',
      scale: { min: 1, max: 5 },
    },
    {
      type: 'text',
      text: 'What could we improve?',
    },
  ],
});

// Get responses
const responses = await surveyConnector.getResponses(survey.id);
```

## Known Gaps & Future Enhancements

### Missing Providers
- [ ] **SurveyMonkey** provider implementation
- [ ] **Typeform** provider implementation
- [ ] **Google Forms** provider implementation
- [ ] **Qualtrics** provider
- [ ] **Jotform** provider

### Missing Features
- [ ] **Survey templates** library
- [ ] **Conditional logic** for questions
- [ ] **Skip patterns** based on answers
- [ ] **Multi-language** surveys
- [ ] **Survey scheduling**
- [ ] **Reminder** notifications
- [ ] **Partial response** saving
- [ ] **Response validation** rules
- [ ] **Export** capabilities (CSV, PDF)
- [ ] **Dashboard** integration
- [ ] **NPS calculation** automation

## References

- [SurveyMonkey API](https://developer.surveymonkey.com/)
- [Typeform API](https://developer.typeform.com/)
