# TaxHelp Assistant Monorepo

US-first tax intake assistant that blends a Telegram concierge with a secure Next.js web console. This MVP demonstrates the end-to-end workflow from OTP onboarding through payment, PDF delivery, and retention preferences.

## Monorepo layout

```
apps/
  web/           Next.js 14 application, APIs, and Telegram webhook
packages/
  db/            Prisma schema + migrations
  shared/        Shared DTOs and type helpers
```

## Getting started

### 1. Install dependencies

This project uses npm workspaces. Install all packages from the repo root:

```bash
npm install
```

### 2. Environment variables

Copy `.env.example` to `.env` at the repo root (create the file if it does not exist yet) and provide values for the following keys:

```
DATABASE_URL=postgres://...
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
S3_ENDPOINT=https://...
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_BUCKET=taxhelp-dev
TELEGRAM_BOT_TOKEN=123456:bot_token
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PRICE_ID_MVP=price_...
STRIPE_WEBHOOK_SECRET=whsec_...
APP_BASE_URL=http://localhost:3000
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser # optional when deploying to serverless
```

### 3. Database

Run Prisma migrations and generate the client:

```bash
npx prisma generate --schema packages/db/prisma/schema.prisma
npx prisma migrate dev --schema packages/db/prisma/schema.prisma
```

### 4. Local development

Start the Next.js development server (includes API routes and Telegram webhook handler):

```bash
npm run dev:web
```

Expose the webhook endpoint to Telegram (for example, using `ngrok http 3000`) and set the webhook to `https://<public-host>/api/telegram/webhook`.

### 5. Stripe webhook

Forward Stripe events locally:

```bash
stripe listen --forward-to localhost:3000/api/pay/webhook
```

### 6. Tests and linting

Placeholder commands are wired up:

```bash
npm run lint
npm test
```

(Add Vitest suites and Playwright scenarios as you expand the project.)

## API surface

All API routes live under `apps/web/app/api`. Key endpoints include:

- `POST /api/auth/phone/request-otp` — issue a 6-digit OTP stored in Upstash Redis.
- `POST /api/auth/phone/verify-otp` — verify OTP, create user, return base64 token.
- `POST /api/consent` — capture consent and persist to the draft return state.
- `POST /api/upload/presign` — presigned S3 upload URLs for PDF/JPEG/PNG up to 10 MB.
- `POST /api/ocr/run` → `POST /api/classify` → `POST /api/extract` → `POST /api/validate` — document pipeline stubs with sample responses.
- `POST /api/qa/next` — adaptive Q&A planner that only asks for missing fields.
- `POST /api/engine/compute` — lightweight computation of federal/state results.
- `POST /api/forms/render` — Puppeteer + S3 workflow that produces a 7-day signed URL.
- `POST /api/pay/checkout` + `POST /api/pay/webhook` — Stripe checkout and webhook integration.
- `POST /api/retention` & `DELETE /api/user/:id/data` — retention controls.
- `POST /api/telegram/webhook` — Telegraf webhook handler mounted inside Next.js.

## Telegram flow (MVP)

The bot prompts for language selection, US phone verification, uploads up to 10 MB, and bridges to the web console. Redis stores short-lived OTPs and locale preferences.

## Deployment notes

- Host the Next.js app on Vercel, Railway, or Render with the Node.js runtime.
- Use Cloudflare R2 or AWS S3 for storage; the included code assumes a compatible S3 API.
- Enable Stripe Checkout + webhook endpoint for payment capture.
- Configure Upstash Redis credentials in the environment to enable OTP caching.

## Roadmap

- Flesh out OCR integration with `sharp` preprocessing and `tesseract.js` recognition.
- Persist full return progress with audit events.
- Add Vitest unit coverage and Playwright E2E scenarios (upload → compute → pay → download).
- Build Postman collection and deployment scripts.
