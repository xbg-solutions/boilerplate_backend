# LLM Provider API Keys Setup Guide

Complete guide for setting up API keys for the LLM-Connector utility across different environments.

## 🔐 Environment Files Overview

Your project uses different `.env` files for different environments:

```
wishlister/
├── .env.local.example       # Template with placeholder keys (safe to commit)
├── .env.local              # Your actual local dev keys (gitignored)
├── .env.development        # Development environment (gitignored)
└── .env.production         # Production environment (gitignored)
```

## 🚀 Quick Setup for Local Development

### Step 1: Create Your Local Environment File

```bash
# From project root
cp .env.local.example .env.local
```

### Step 2: Add Your API Keys

Edit `.env.local` and replace the placeholder values with your actual keys:

```bash
# Anthropic Claude (Primary provider)
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxxxxxxxxxx

# OpenAI (Secondary provider - optional)
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxx

# Google AI / Gemini (Optional)
GOOGLE_AI_API_KEY=xxxxxxxxxxxxxxxxxxxxx

# Google Cloud Vision (Optional - for product identification)
# Either use your service account OR set an API key:
# GOOGLE_CLOUD_API_KEY=xxxxxxxxxxxxxxxxxxxxx
```

### Step 3: Restart Your Development Server

```bash
# Kill any running processes and restart
npm run serve
```

## 🔑 Getting Your API Keys

### Anthropic Claude
1. Go to: https://console.anthropic.com/
2. Sign up or log in
3. Navigate to "API Keys"
4. Click "Create Key"
5. Copy your key (starts with `sk-ant-api03-`)

**Pricing:** Claude Haiku is ~$0.25 per million input tokens, very affordable for development.

### OpenAI (Optional)
1. Go to: https://platform.openai.com/api-keys
2. Sign up or log in
3. Click "Create new secret key"
4. Copy your key (starts with `sk-`)

**Pricing:** GPT-4o-mini is ~$0.15 per million input tokens.

### Google AI (Gemini) (Optional)
1. Go to: https://makersuite.google.com/app/apikey
2. Sign in with your Google account
3. Click "Create API Key"
4. Copy your key

**Pricing:** Gemini Flash is free for up to 15 requests per minute.

### Google Cloud Vision (Optional)
For product identification features, you can either:

**Option A: Use your existing service account** (recommended)
- Already configured via `GOOGLE_APPLICATION_CREDENTIALS`
- No additional setup needed

**Option B: Use a separate API key**
1. Go to: https://console.cloud.google.com/apis/credentials
2. Create credentials → API Key
3. Restrict the key to "Cloud Vision API"
4. Set `GOOGLE_CLOUD_API_KEY` in your `.env.development`

### Google Maps (For Address Validation)
For Feature #25 address validation:

1. Go to: https://console.cloud.google.com/google/maps-apis
2. Enable these APIs:
   - **Places API**
   - **Geocoding API**
   - **Maps JavaScript API**
3. Create credentials → API Key
4. Set `GOOGLE_MAPS_API_KEY` in your `.env.development`

**Note:** You can use the same API key for both Cloud Vision and Maps if you enable all required APIs on a single key.

## 🏢 Production Deployment

### ⚠️ IMPORTANT: Never commit production keys to Git

For production, use one of these secure methods:

### Option 1: Firebase Secret Manager (Recommended)

Firebase Functions supports secure secret management:

```bash
# Set secrets via Firebase CLI
firebase functions:secrets:set ANTHROPIC_API_KEY
firebase functions:secrets:set OPENAI_API_KEY
firebase functions:secrets:set GOOGLE_AI_API_KEY

# Deploy with secrets
firebase deploy --only functions
```

In your code, secrets are accessed the same way as environment variables.

### Option 2: GitHub Actions Secrets

If deploying via GitHub Actions:

1. Go to: Repository → Settings → Secrets and variables → Actions
2. Add secrets:
   - `ANTHROPIC_API_KEY`
   - `OPENAI_API_KEY`
   - `GOOGLE_AI_API_KEY`
3. Reference in your workflow:

```yaml
- name: Deploy to Firebase
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
    GOOGLE_AI_API_KEY: ${{ secrets.GOOGLE_AI_API_KEY }}
  run: firebase deploy --only functions
```

### Option 3: Cloud Provider Secret Management

For other cloud providers (AWS, Azure, GCP), use their respective secret management services.

## 📋 Provider Configuration

Your provider configuration is in:
```
functions/src/config/llm-providers.config.ts
```

It automatically detects which providers are enabled based on available API keys:

```typescript
export const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  claude: {
    name: 'claude',
    enabled: !!process.env.ANTHROPIC_API_KEY,  // Only enabled if key present
    // ...
  },
  openai: {
    name: 'openai',
    enabled: !!process.env.OPENAI_API_KEY,     // Only enabled if key present
    // ...
  }
};
```

## 🧪 Testing with Real APIs

By default, integration tests are skipped to avoid API costs. To enable them:

```bash
# In your .env.local
RUN_LLM_INTEGRATION_TESTS=true

# Run integration tests
npm run test:integration -- llm-connector
```

**Cost Estimate:** ~$0.01 per full test run (23 tests with minimal tokens)

## 🔍 Verifying Your Setup

### Check Provider Status

```typescript
import { llmConnector } from './utilities/llm-connector';

// Check which providers are available
const enabledProviders = llmConnector.getEnabledProviders();
console.log('Enabled providers:', enabledProviders);
// Expected: ['claude', 'openai', 'gemini'] (depending on your keys)

// Get provider details
const claudeInfo = llmConnector.getProviderInfo('claude');
console.log('Claude models:', claudeInfo.availableModels);
```

### Test a Simple Request

```typescript
import { llmConnector } from './utilities/llm-connector';

async function testProvider() {
  const response = await llmConnector.generateText({
    provider: 'claude',
    model: 'claude-3-haiku-20240307',
    prompt: 'Say hello in one word',
    maxTokens: 10
  });

  if (response.success) {
    console.log('✅ Provider working!');
    console.log('Response:', response.text);
    console.log('Cost:', `$${response.usage.estimatedCost}`);
  } else {
    console.error('❌ Provider error:', response.error);
  }
}
```

## 🛡️ Security Best Practices

1. **Never commit API keys to Git**
   - Always use `.env.local` for local development
   - Verify `.gitignore` includes `.env.local` and `.env*.local`

2. **Use environment-specific keys**
   - Development keys with lower limits
   - Production keys with higher quotas

3. **Rotate keys regularly**
   - Especially if a key is accidentally exposed
   - Set up key expiration reminders

4. **Monitor usage**
   - Set up billing alerts on provider dashboards
   - Track costs per environment

5. **Restrict API keys**
   - Limit keys to specific APIs
   - Set IP restrictions if possible
   - Use rate limits

## 🚨 Troubleshooting

### "API key not found" Error

**Problem:** Provider returns "API key not found for provider 'claude'"

**Solution:**
1. Check `.env.local` has the key: `echo $ANTHROPIC_API_KEY`
2. Restart your dev server after adding keys
3. Verify no typos in the environment variable name
4. Check the key starts with the correct prefix (`sk-ant-api03-` for Claude)

### Provider Shows as Disabled

**Problem:** `getEnabledProviders()` doesn't include your provider

**Solution:**
1. Verify API key is set in environment
2. Check `llm-providers.config.ts` - provider is enabled when key is present
3. Restart your application

### Integration Tests Skip

**Problem:** All integration tests show as "skipped"

**Solution:**
This is expected behavior to avoid API costs. To run them:
```bash
export RUN_LLM_INTEGRATION_TESTS=true
npm run test:integration -- llm-connector
```

### Rate Limit Errors

**Problem:** "Rate limit exceeded" errors

**Solution:**
1. Check your usage on the provider's dashboard
2. Wait a few minutes and retry
3. Adjust rate limits in `llm-providers.config.ts`:
   ```typescript
   rateLimits: {
     requestsPerMinute: 50,  // Lower this
     tokensPerMinute: 50000
   }
   ```

### High Costs

**Problem:** Unexpected API bills

**Solution:**
1. Use cheaper models for development:
   - Claude: Use `claude-3-haiku-20240307` instead of Sonnet/Opus
   - OpenAI: Use `gpt-4o-mini` instead of `gpt-4o`
   - Gemini: Use `gemini-1.5-flash` instead of Pro
2. Set `maxTokens` limits on requests
3. Disable integration tests: `RUN_LLM_INTEGRATION_TESTS=false`
4. Set up billing alerts on provider dashboards

## 📊 Cost Management

### Development Mode Cost Controls

Your `llm-providers.config.ts` already includes cost-saving measures:

```typescript
const isDevelopment = process.env.NODE_ENV === 'development';

export const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  claude: {
    defaultModel: isDevelopment
      ? 'claude-3-haiku-20240307'        // 💰 Cheap
      : 'claude-3-5-sonnet-20241022',    // 💎 Expensive
    timeout: isDevelopment ? 15000 : 45000,
    maxRetries: isDevelopment ? 1 : 3
  }
};
```

### Estimated Costs (Development)

| Task | Provider | Model | Cost |
|------|----------|-------|------|
| Well wishes (200 tokens) | Claude | Haiku | $0.00005 |
| Thank you note (150 tokens) | Claude | Haiku | $0.00004 |
| Product ID (300 tokens) | Gemini | Flash | Free |
| Test suite run (all 23 tests) | Claude | Haiku | $0.01 |

**Daily development estimate:** $0.50 - $2.00 depending on usage

## 📚 Additional Resources

- [Anthropic API Documentation](https://docs.anthropic.com/claude/reference/getting-started-with-the-api)
- [OpenAI API Documentation](https://platform.openai.com/docs/api-reference)
- [Google AI Studio](https://ai.google.dev/)
- [Firebase Functions Environment Configuration](https://firebase.google.com/docs/functions/config-env)
- [LLM-Connector README](./README.md)

## 🆘 Need Help?

If you encounter issues:

1. Check this guide's troubleshooting section
2. Review the [LLM-Connector README](./README.md)
3. Check provider status pages:
   - [Anthropic Status](https://status.anthropic.com/)
   - [OpenAI Status](https://status.openai.com/)
   - [Google Cloud Status](https://status.cloud.google.com/)
4. Open an issue in the project repository

---

**Last Updated:** October 2025
**Next Review:** When adding new LLM providers
