# Codebase Analysis

## High-level architecture
- **Runtime configuration** is centralized in `src/config.ts`, which loads `.env` variables via `dotenv`, enforces required keys (`BOT_TOKEN`, `API_BASE_URL`), and exposes a normalized configuration object consumed across the bot runtime.【F:src/config.ts†L1-L26】
- **Domain modelling** lives in `src/types.ts`, defining language support, payload contracts for registration/login, filing data schemas, per-chat session structures, and REST response shapes used throughout the bot logic.【F:src/types.ts†L1-L121】
- **Session management** relies on an in-memory `SessionStore` (`src/session.ts`) that tracks Telegram chat sessions, applies a 12-hour TTL, and keeps profile/language data in sync as the user progresses through different conversational modes.【F:src/session.ts†L3-L56】

## Core conversational flow (`src/index.ts`)
- The entry point wires the Telegram bot, i18n helpers, validators, constants, and the REST API client, while defining the registration, filing, and login step metadata that drive the guided workflows.【F:src/index.ts†L1-L88】
- `handleStartCommand` bootstraps a chat session, attempts to hydrate returning users via `GET /auth/telegram/:id`, and either restores their profile/language or kicks off the registration wizard after presenting the language picker.【F:src/index.ts†L95-L190】
- Guided registration and filing flows are implemented as step machines: each prompt advances through the `registrationSteps`/`filingSteps` arrays, validates inputs with helper functions, and persists progress through the API client to keep the backend synchronized (e.g., `startOrResumeFiling`, `saveFilingStep`).【F:src/index.ts†L47-L200】【F:src/services/apiClient.ts†L153-L176】
- The main menu construction showcases the multilingual UX: inline keyboard buttons are dynamically translated using `t(...)`, and callback prefix namespaces (`LANG`, `MENU`, `FILING`, etc.) route postbacks to the correct handler for filings, PDFs, AI chat, profile editing, and reminders.【F:src/index.ts†L83-L150】

## API integration layer
- `src/services/apiClient.ts` wraps backend communication with a lightweight fetch-based client that handles JWT persistence, query serialization, standardized JSON parsing, and error propagation through a custom `ApiError` type with status codes.【F:src/services/apiClient.ts†L19-L93】
- The client exposes cohesive methods for every backend capability—auth flows, profile updates, filing lifecycle, document retrieval, payments, AI queries, reminders, and calendar links—mirroring the TaxHelp API surface area consumed by the bot.【F:src/services/apiClient.ts†L95-L223】

## Localization and constants
- Filing statuses, income types, and reminder options are enumerated in `src/constants.ts` alongside translation helpers (`formatOptionLabel`, `formatStatus`) that provide localized labels for each supported language code, ensuring consistent multi-language messaging across menus and summaries.【F:src/constants.ts†L3-L134】
- The bot’s language catalog (`LANGUAGES`, `languageLabel`) and translator `t(...)` (defined in `src/i18n.ts`, not shown here) feed the dynamic prompt generation referenced throughout the conversational handlers, tying together locale selection with content delivery.【F:src/index.ts†L5-L148】

## Observations & potential follow-ups
- Sessions are purely in-memory with a 12-hour TTL; scaling beyond a single process will require an external store (Redis/etc.) or webhook affinity to prevent user context loss.【F:src/session.ts†L3-L56】
- Error handling already distinguishes 404 lookups for Telegram IDs, but broader resilience (retry/backoff, user-facing error messaging) could be enhanced when downstream APIs are unavailable.【F:src/index.ts†L159-L177】【F:src/services/apiClient.ts†L85-L134】
- Expanding payment providers or reminder channels can be achieved by extending the API client methods, which are already organized around specific endpoint actions for easy augmentation.【F:src/services/apiClient.ts†L197-L223】
