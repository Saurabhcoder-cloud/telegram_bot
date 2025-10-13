# TaxHelp AI Telegram Bot

A production-ready, multilingual Telegram assistant for TaxHelp AI customers. The bot is built with Node.js, TypeScript, and a lightweight `node-telegram-bot-api` integration that supports both webhook and long-polling deployments. It orchestrates the full taxpayer journey – onboarding, filing wizard, AI Q&A, payments, reminders, and document delivery – while synchronising profile data with the central TaxHelp AI platform.

## ✨ Features
- **In-chat onboarding** with language picker (English, Spanish, Russian, Chinese, Arabic, Farsi) and fully validated registration/login flows.
- **JWT-authenticated API client** for user, filing, payment, PDF, AI, and reminder endpoints with instant cross-platform profile sync.
- **Step-by-step filing wizard** covering W‑2, 1099, Schedule C, deductions, dependents, education, medical, and mileage data with save/resume support.
- **Localized main menu** (inline keyboard) for starting filings, viewing forms, downloading PDFs, paying invoices, chatting with AI, changing language, managing reminders, and editing profile details.
- **AI tax assistant** that answers free-form questions in the user’s language and returns IRS references when available.
- **Payment handoff** via secure Stripe Checkout sessions provided by the backend and stored in a shared TaxHelp AI database.
- **Smart reminders** for deadlines, incomplete tasks, and payments including optional calendar links.
- **PDF delivery** for completed 1040/Schedule forms retrieved directly from the backend.
- **Webhook or polling runtime** with configurable secrets, port, and admin notifications.

## 📁 Project structure
```
├── src
│   ├── config.ts            # Environment loading & runtime metadata
│   ├── constants.ts         # Filing statuses, income types, reminder options
│   ├── i18n.ts              # Localised copy & helpers
│   ├── index.ts             # Main bot implementation
│   ├── logger.ts            # Winston logger configuration
│   ├── services/apiClient.ts# REST client with JWT support
│   ├── session.ts           # In-memory session manager
│   ├── types.ts             # Shared domain types
│   └── utils/validators.ts  # Basic input validation helpers
├── vendor/node-telegram-bot-api
│   ├── index.js             # Minimal Telegram Bot API client
│   └── index.d.ts           # Type definitions for TypeScript
├── ecosystem.config.js      # PM2 deployment profile
├── package.json             # Scripts & dependencies
├── tsconfig.json            # TypeScript compiler settings
└── .env.example             # Environment variable template
```

## ⚙️ Prerequisites
- Node.js 18+
- npm 9+
- A Telegram bot token generated via [@BotFather](https://t.me/BotFather)
- TaxHelp AI REST API credentials and HTTPS endpoint

## 🚀 Getting started
1. Install dependencies
   ```bash
   npm install
   ```
2. Copy the environment template and fill in values
   ```bash
   cp .env.example .env
   ```
3. Run in watch mode with polling (ideal for local development)
   ```bash
   npm run dev
   ```
4. Build and run in production mode
   ```bash
   npm run build
   npm run start
   ```

### Webhook deployment
1. Set `WEBHOOK_URL` and optional `WEBHOOK_SECRET` in `.env`.
2. Expose port `PORT` (default `3000`) behind HTTPS (e.g., Nginx reverse proxy or serverless edge function).
3. The bot automatically registers the webhook and verifies incoming requests using the secret header `x-telegram-bot-api-secret-token` when provided.

### PM2 process manager
```
npm run build
pm2 start ecosystem.config.js
```

## 🔐 Environment variables
| Variable | Description |
| --- | --- |
| `BOT_TOKEN` | Telegram bot token from BotFather |
| `API_BASE_URL` | Base URL for the TaxHelp AI REST API (HTTPS) |
| `STRIPE_KEY` | Publishable key used for contextual messaging (backend handles checkout session creation) |
| `AI_API_KEY` | OpenAI-compatible key used for direct AI fallback when the backend is unavailable |
| `OPENAI_API_KEY` | Optional alias for `AI_API_KEY` to ease local setups |
| `AI_MODEL` | Model identifier for the direct AI fallback. Defaults to `gpt-4o-mini`, or `deepseek/deepseek-chat-v3.1:free` when an OpenRouter key (`sk-or-*`) is detected |
| `AI_BASE_URL` | Override the OpenAI-compatible base URL. Defaults to OpenAI, or `https://openrouter.ai/api/v1` for OpenRouter keys |
| `AI_REFERER` | Optional HTTP Referer header for providers such as OpenRouter (defaults to `https://taxhelp.ai`) |
| `AI_TITLE` | Friendly application title sent to OpenRouter via the `X-Title` header |
| `ADMIN_CHAT_ID` | Optional Telegram chat ID for startup notifications |
| `WEBHOOK_URL` | Public HTTPS webhook endpoint (leave empty to use long polling) |
| `WEBHOOK_SECRET` | Optional secret validated against `x-telegram-bot-api-secret-token` |
| `PORT` | Webhook HTTP server port |
| `BOT_NAME`, `BOT_VERSION`, `BOT_AUTHOR` | Metadata used in logs and admin notifications |

Either `AI_API_KEY` or `OPENAI_API_KEY` must be populated with your provider secret to enable the multilingual “Ask a Tax Question” flow. The assistant automatically replies in the user’s chosen language when the key is present.

> **Using OpenRouter / DeepSeek.** Paste your `sk-or-…` key into `AI_API_KEY`. The bot automatically switches to the OpenRouter base URL and model defaults. For the free DeepSeek V3.1 tier we default to `AI_MODEL=deepseek/deepseek-chat-v3.1:free`, but you can override the slug if OpenRouter advertises a newer alias. Optionally customise `AI_REFERER` and `AI_TITLE` to match your deployment domain and product name, as OpenRouter requires these headers.

## 🙅‍♀️ Admin panel availability

This repository does **not** include an admin dashboard, front-end, or dedicated API route for managing bot operators. The only administrator-specific configuration is the optional `ADMIN_CHAT_ID` environment variable, which the bot uses to send startup and error notifications to a Telegram user or channel. If your deployment requires an admin interface, you will need to build or integrate one separately and provision its credentials through your own infrastructure (for example, a password manager or secrets vault).

## 🔗 API integration cheatsheet
The bot relies on TaxHelp AI’s REST API. Below are representative payloads used in the workflows.

```http
POST /auth/register
{
  "fullName": "Avery Johnson",
  "email": "avery@example.com",
  "phone": "+14085550123",
  "dob": "1990-02-17",
  "filingStatus": "single",
  "incomeType": "w2",
  "state": "CA",
  "language": "en",
  "telegramId": 123456789
}

POST /auth/login
{
  "email": "avery@example.com",
  "password": "one-time-code",
  "telegramId": 123456789
}

PATCH /users/me
{
  "fullName": "Avery J. Johnson",
  "phone": "+14085550678",
  "filingStatus": "married_joint"
}

POST /tax/filings
{ "action": "start_or_resume" }

PUT /tax/filings/{filingId}/steps/{step}
{
  "w2Income": "Employer ABC – $82,500 wages, $10,400 federal withholding"
}

POST /tax/filings/{filingId}/submit
{}

GET /tax/forms
→ returns array of form metadata used for display buttons

GET /tax/forms/{formId}/pdf
→ binary PDF payload returned to the user

POST /payments/checkout
{ "provider": "stripe" }
→ returns `{ "checkoutUrl": "https://checkout.stripe.com/...", "sessionId": "cs_test_..." }`

POST /ai/query
{
  "question": "How do I claim the Lifetime Learning Credit?",
  "language": "es"
}

POST /reminders
{
  "type": "filing_deadline",
  "dueDate": "2025-04-15"
}

POST /integrations/calendar
{
  "dueDate": "2025-04-15",
  "title": "Federal Tax Filing Deadline"
}
```

## 🧪 Quality checks
- Type-check the project:
  ```bash
  npm run build
  ```
- Linting is available via `npm run lint` if an ESLint configuration is added.

## 🛡️ Security considerations
- All API calls are HTTPS and authenticated with user-specific JWT tokens returned by the backend.
- Language updates and profile edits immediately sync with the central database, ensuring consistency across the website and mobile app.
- Stripe payment links are generated server-side; the bot never handles card data.
- Optional webhook secret prevents spoofed Telegram requests.

## 🆘 Support commands
- `/start` – restart onboarding and language selection
- `/menu` – open the main menu at any time
- `/help` – display a quick reference guide

## 📄 License
Internal use for TaxHelp AI – update to match your organisation’s policies before release.
