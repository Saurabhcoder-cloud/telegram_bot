import TelegramBot, { CallbackQuery, InlineKeyboardButton, Message } from "node-telegram-bot-api";
import { createServer } from "http";
import { config } from "./config";
import logger from "./logger";
import { LANGUAGES, languageLabel, t } from "./i18n";
import { sessionStore } from "./session";
import {
  FilingData,
  LanguageCode,
  PendingDisclaimerAction,
  RefundEstimatePayload,
  RegistrationPayload,
  SessionData,
  UserProfile,
} from "./types";
import { isValidDate, isValidEmail, normalizePhone } from "./utils/validators";
import {
  FILING_STATUSES,
  INCOME_TYPES,
  REMINDER_TYPES,
  formatOptionLabel,
  formatStatus,
} from "./constants";
import { ApiError, createApiClient } from "./services/apiClient";

const DEFAULT_LANGUAGE: LanguageCode = "en";

type RegistrationField = Exclude<keyof RegistrationPayload, "language" | "telegramId">;

type RegistrationStep = {
  field: RegistrationField;
  promptKey: string;
  type: "text" | "email" | "password" | "date" | "select" | "optional";
  options?: { value: string; labelKey: string }[];
};

type FilingStep = {
  field: keyof FilingData;
  promptKey: string;
  optional?: boolean;
};

type LoginStep = {
  field: "email" | "password";
  promptKey: string;
  type: "email" | "password";
};

type MessageWithContact = Message & { contact?: { phone_number?: string } };

type EstimatorField = keyof RefundEstimatePayload;

type EstimatorStep = {
  field: EstimatorField;
  promptKey: string;
  type: "select" | "number" | "currency";
  options?: { value: string; labelKey: string }[];
};

const registrationSteps: RegistrationStep[] = [
  { field: "fullName", promptKey: "registration.ask_full_name", type: "text" },
  { field: "email", promptKey: "registration.ask_email", type: "email" },
  { field: "password", promptKey: "registration.ask_password", type: "password" },
  { field: "phone", promptKey: "registration.ask_phone", type: "optional" },
  { field: "dob", promptKey: "registration.ask_dob", type: "date" },
  {
    field: "filingStatus",
    promptKey: "registration.ask_filing_status",
    type: "select",
    options: FILING_STATUSES,
  },
  {
    field: "incomeType",
    promptKey: "registration.ask_income_type",
    type: "select",
    options: INCOME_TYPES,
  },
  { field: "state", promptKey: "registration.ask_state", type: "text" },
];

const filingSteps: FilingStep[] = [
  { field: "w2Income", promptKey: "filing.prompt_w2" },
  { field: "form1099Income", promptKey: "filing.prompt_1099" },
  { field: "scheduleCDetails", promptKey: "filing.prompt_schedule_c" },
  { field: "deductions", promptKey: "filing.prompt_deductions" },
  { field: "dependents", promptKey: "filing.prompt_dependents" },
  { field: "educationCredits", promptKey: "filing.prompt_education", optional: true },
  { field: "medicalExpenses", promptKey: "filing.prompt_medical", optional: true },
  { field: "mileage", promptKey: "filing.prompt_mileage", optional: true },
];

const loginSteps: LoginStep[] = [
  { field: "email", promptKey: "login.ask_email", type: "email" },
  { field: "password", promptKey: "login.ask_password", type: "password" },
];

const refundSteps: EstimatorStep[] = [
  {
    field: "filingStatus",
    promptKey: "estimator.ask_status",
    type: "select",
    options: FILING_STATUSES,
  },
  { field: "dependents", promptKey: "estimator.ask_dependents", type: "number" },
  { field: "annualIncome", promptKey: "estimator.ask_income", type: "currency" },
];

const callbackPrefixes = {
  language: "LANG",
  registration: "REG",
  menu: "MENU",
  filing: "FILING",
  pdf: "PDF",
  profile: "PROFILE",
  reminder: "REMINDER",
  estimator: "EST",
  subscription: "PLAN",
};

let bot: TelegramBot;

function ensureSession(message: Message): SessionData | null {
  const chatId = message.chat?.id;
  const telegramId = message.from?.id;
  if (!chatId || !telegramId) {
    return null;
  }
  const existing = sessionStore.get(chatId);
  if (existing) {
    existing.telegramId = telegramId;
    sessionStore.update(chatId, existing);
    return existing;
  }
  return sessionStore.create(chatId, telegramId, DEFAULT_LANGUAGE);
}

function getLanguage(session?: SessionData): LanguageCode {
  return session?.language ?? DEFAULT_LANGUAGE;
}

function formatCurrency(language: LanguageCode, amount: number, currency = "USD"): string {
  try {
    const locale = LANGUAGES.find((lang) => lang.code === language)?.locale ?? "en-US";
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
  } catch (error) {
    logger.warn("Currency format failed %o", error);
    return `${currency} ${amount.toFixed(2)}`;
  }
}

const DISCLAIMER_ACK_WORDS: Record<LanguageCode, string[]> = {
  en: ["continue"],
  es: ["continuar", "continue"],
  ru: ["продолжить", "continue"],
  zh: ["继续", "繼續", "continue"],
  ar: ["استمرار", "continue"],
  fa: ["ادامه", "continue"],
};

const ALL_ACK_WORDS = Array.from(
  new Set(
    Object.values(DISCLAIMER_ACK_WORDS)
      .flat()
      .map((word) => word.toLocaleLowerCase())
  )
);

const QUOTE_TRIM_REGEX = /^["'“”«»„‟‹›「」『』]+|["'“”«»„‟‹›「」『』]+$/gu;
const EDGE_PUNCTUATION_REGEX = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

function getPrimaryAckWord(language: LanguageCode): string {
  const words = DISCLAIMER_ACK_WORDS[language];
  if (words && words.length > 0) {
    return words[0];
  }
  return DISCLAIMER_ACK_WORDS.en[0];
}

function buildAckCandidates(text: string): string[] {
  const trimmed = text.trim().toLocaleLowerCase();
  if (!trimmed) return [];
  const noQuotes = trimmed.replace(QUOTE_TRIM_REGEX, "");
  const noEdgePunctuation = noQuotes.replace(EDGE_PUNCTUATION_REGEX, "");
  const candidates = new Set<string>([trimmed, noQuotes, noEdgePunctuation]);
  for (const token of noQuotes.split(/\s+/)) {
    const cleaned = token.replace(EDGE_PUNCTUATION_REGEX, "");
    if (cleaned) {
      candidates.add(cleaned);
    }
  }
  return Array.from(candidates.values());
}

function isDisclaimerAcknowledgement(text: string): boolean {
  return buildAckCandidates(text).some((candidate) => ALL_ACK_WORDS.includes(candidate));
}

async function handlePostDisclaimerAction(
  session: SessionData,
  action?: PendingDisclaimerAction
): Promise<void> {
  const nextAction = action ?? session.pendingAfterDisclaimer;
  session.pendingAfterDisclaimer = undefined;
  if (!nextAction) {
    session.mode = "idle";
    sessionStore.update(session.chatId, session);
    return;
  }

  switch (nextAction) {
    case "showMenu": {
      session.mode = "idle";
      sessionStore.update(session.chatId, session);
      await sendMainMenu(session);
      break;
    }
    case "startRegistration": {
      if (!session.registration) {
        session.registration = {
          stepIndex: 0,
          data: { telegramId: session.telegramId, language: session.language } as Partial<RegistrationPayload>,
        };
      }
      session.mode = "registration";
      sessionStore.update(session.chatId, session);
      await bot.sendMessage(session.chatId, t(session.language, "registration.intro"));
      await promptRegistrationStep(session);
      break;
    }
    case "promptLogin": {
      if (!session.login) {
        session.login = { stepIndex: 0 };
      }
      session.mode = "login";
      sessionStore.update(session.chatId, session);
      if (session.login?.greetingName) {
        await bot.sendMessage(
          session.chatId,
          t(session.language, "login.prompt_returning", { name: session.login.greetingName })
        );
      }
      await promptLoginStep(session);
      break;
    }
    default: {
      session.mode = "idle";
      sessionStore.update(session.chatId, session);
    }
  }
}

async function sendDisclaimer(session: SessionData, nextAction: PendingDisclaimerAction) {
  if (session.disclaimerAcknowledged) {
    await handlePostDisclaimerAction(session, nextAction);
    return;
  }

  if (session.mode === "disclaimer" && session.pendingAfterDisclaimer === nextAction) {
    return;
  }

  const language = getLanguage(session);
  const title = t(language, "start.disclaimer_title");
  const body = t(language, "start.disclaimer_body");
  await bot.sendMessage(session.chatId, `${title}\n${body}`);
  await bot.sendMessage(session.chatId, t(language, "start.disclaimer_cta"));
  session.pendingAfterDisclaimer = nextAction;
  session.disclaimerAcknowledged = false;
  session.mode = "disclaimer";
  sessionStore.update(session.chatId, session);
}

async function sendLanguageMenu(chatId: number, language: LanguageCode) {
  await bot.sendMessage(chatId, t(language, "language.menu_title"), {
    reply_markup: {
      inline_keyboard: LANGUAGES.map((lang) => [
        {
          text: lang.label,
          callback_data: `${callbackPrefixes.language}:${lang.code}`,
        },
      ]),
    },
  });
}

async function sendMainMenu(session: SessionData) {
  const language = getLanguage(session);
  const inline_keyboard = [
    [
      { text: t(language, "menu.ask_question"), callback_data: `${callbackPrefixes.menu}:ASK_AI` },
      { text: t(language, "menu.estimate_refund"), callback_data: `${callbackPrefixes.menu}:ESTIMATE` },
    ],
    [
      { text: t(language, "menu.file_taxes"), callback_data: `${callbackPrefixes.menu}:FILE_TAXES` },
      { text: t(language, "menu.documents"), callback_data: `${callbackPrefixes.menu}:DOCUMENTS` },
    ],
    [
      { text: t(language, "menu.subscription"), callback_data: `${callbackPrefixes.menu}:SUBSCRIPTIONS` },
    ],
    [
      { text: t(language, "menu.profile"), callback_data: `${callbackPrefixes.menu}:PROFILE` },
      { text: t(language, "menu.reminders"), callback_data: `${callbackPrefixes.menu}:REMINDERS` },
    ],
    [
      { text: t(language, "menu.change_language"), callback_data: `${callbackPrefixes.menu}:CHANGE_LANGUAGE` },
    ],
  ];
  await bot.sendMessage(session.chatId, t(language, "menu.title"), {
    reply_markup: { inline_keyboard },
  });
}

async function handleStartCommand(message: Message) {
  const session = ensureSession(message);
  if (!session) return;

  const language = getLanguage(session);
  await bot.sendMessage(session.chatId, t(language, "start.welcome"));

  if (session.jwt) {
    await sendDisclaimer(session, "showMenu");
    return;
  }

  if (!session.jwt) {
    try {
      const client = createApiClient();
      const existing = await client.getProfileByTelegramId(session.telegramId);
      if (existing) {
        session.jwt = undefined;
        session.profile = undefined;
        session.language = existing.user.language;
        session.mode = "login";
        session.registration = undefined;
        session.disclaimerAcknowledged = false;
        session.login = { stepIndex: 0, greetingName: existing.user.fullName };
        sessionStore.update(session.chatId, session);
        await sendDisclaimer(session, "promptLogin");
        return;
      }
    } catch (error) {
      if (error instanceof ApiError && error.status !== 404) {
        logger.error("Failed to fetch profile by telegram id", error);
      }
    }
  }

  session.mode = "registration";
  session.registration = {
    stepIndex: 0,
    data: {
      telegramId: session.telegramId,
      language: session.language,
    } as Partial<RegistrationPayload>,
  };
  sessionStore.update(session.chatId, session);
  await sendLanguageMenu(session.chatId, language);
}

async function promptRegistrationStep(session: SessionData) {
  const registration = session.registration;
  if (!registration) return;
  const step = registrationSteps[registration.stepIndex];
  const language = getLanguage(session);
  if (!step) {
    await finalizeRegistration(session);
    return;
  }

  if (step.type === "select" && step.options) {
    const rows = step.options.map((option) => [
      {
        text: formatOptionLabel(language, option),
        callback_data: `${callbackPrefixes.registration}:${step.field}:${option.value}`,
      },
    ]);
    await bot.sendMessage(session.chatId, t(language, step.promptKey), {
      reply_markup: { inline_keyboard: rows },
    });
    return;
  }

  const inline_keyboard: InlineKeyboardButton[][] = [];
  if (step.type === "optional") {
    inline_keyboard.push([
      {
        text: t(language, "registration.optional_skip"),
        callback_data: `${callbackPrefixes.registration}:SKIP:${step.field}`,
      },
    ]);
  }
  await bot.sendMessage(session.chatId, t(language, step.promptKey), {
    reply_markup: inline_keyboard.length > 0 ? { inline_keyboard } : undefined,
  });
}

async function finalizeRegistration(session: SessionData) {
  const registration = session.registration;
  if (!registration) return;
  const language = getLanguage(session);
  const payload = registration.data as RegistrationPayload;
  payload.language = session.language;
  payload.telegramId = session.telegramId;
  try {
    const client = createApiClient();
    const result = await client.register(payload);
    session.jwt = result.token;
    session.profile = result.user;
    session.registration = undefined;
    session.mode = "idle";
    session.language = result.user.language;
    sessionStore.update(session.chatId, session);
    await bot.sendMessage(session.chatId, t(session.language, "registration.completed"));
    await sendMainMenu(session);
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      session.registration = undefined;
      session.mode = "login";
      session.login = { stepIndex: 0 };
      sessionStore.update(session.chatId, session);
      await bot.sendMessage(session.chatId, t(language, "registration.duplicate"));
      await promptLoginStep(session);
      return;
    }
    logger.error("Registration error %o", error);
    await bot.sendMessage(session.chatId, t(language, "error.generic"));
  }
}

async function promptLoginStep(session: SessionData) {
  const login = session.login;
  if (!login) return;
  const step = loginSteps[login.stepIndex];
  const language = getLanguage(session);
  if (!step) {
    await finalizeLogin(session);
    return;
  }
  await bot.sendMessage(session.chatId, t(language, step.promptKey));
}

async function finalizeLogin(session: SessionData) {
  const login = session.login;
  if (!login) return;
  const language = getLanguage(session);
  try {
    const client = createApiClient();
    const payload = {
      email: login.email!,
      password: login.password!,
      telegramId: session.telegramId,
    };
    const result = await client.login(payload);
    session.jwt = result.token;
    session.profile = result.user;
    session.language = result.user.language;
    session.mode = "idle";
    session.login = undefined;
    sessionStore.update(session.chatId, session);
    await bot.sendMessage(session.chatId, t(session.language, "login.completed"));
    await sendMainMenu(session);
  } catch (error) {
    logger.error("Login error %o", error);
    await bot.sendMessage(session.chatId, t(language, "login.failed"));
    session.login = { stepIndex: 0 };
    sessionStore.update(session.chatId, session);
    await promptLoginStep(session);
  }
}

async function handleRegistrationResponse(session: SessionData, message: Message) {
  const registration = session.registration;
  if (!registration) return;
  const step = registrationSteps[registration.stepIndex];
  const language = getLanguage(session);
  if (!step) return;
  const messageWithContact = message as MessageWithContact;
  const contactValue = messageWithContact.contact?.phone_number?.trim();
  const textValue = message.text?.trim();
  let text = textValue && textValue.length > 0 ? textValue : "";
  if (!text && step.field === "phone" && contactValue) {
    text = contactValue;
  }

  switch (step.type) {
    case "text":
      if (!text) {
        await bot.sendMessage(session.chatId, t(language, "error.generic"));
        return;
      }
      registration.data[step.field] = text;
      break;
    case "email":
      if (!isValidEmail(text)) {
        await bot.sendMessage(session.chatId, t(language, "registration.invalid_email"));
        return;
      }
      registration.data[step.field] = text.toLowerCase();
      break;
    case "password":
      if (!text || text.length < 6) {
        await bot.sendMessage(session.chatId, t(language, "registration.invalid_password"));
        return;
      }
      registration.data[step.field] = text;
      break;
    case "optional":
      if (!text || text.toLowerCase() === t(language, "registration.optional_skip").toLowerCase()) {
        registration.data[step.field] = undefined;
      } else {
        registration.data[step.field] = normalizePhone(text);
      }
      break;
    case "date":
      if (!isValidDate(text)) {
        await bot.sendMessage(session.chatId, t(language, "registration.invalid_dob"));
        return;
      }
      registration.data[step.field] = text;
      break;
    default:
      return;
  }

  registration.stepIndex += 1;
  session.registration = registration;
  sessionStore.update(session.chatId, session);
  await promptRegistrationStep(session);
}

async function handleLoginResponse(session: SessionData, message: Message) {
  const login = session.login;
  if (!login || !message.text) return;
  const step = loginSteps[login.stepIndex];
  const language = getLanguage(session);
  if (!step) return;
  const text = message.text.trim();
  if (step.type === "email") {
    if (!isValidEmail(text)) {
      await bot.sendMessage(session.chatId, t(language, "registration.invalid_email"));
      return;
    }
    login.email = text.toLowerCase();
  } else {
    if (!text) {
      await bot.sendMessage(session.chatId, t(language, "error.generic"));
      return;
    }
    login.password = text;
  }
  login.stepIndex += 1;
  session.login = login;
  sessionStore.update(session.chatId, session);
  await promptLoginStep(session);
}

async function handleFileTaxes(session: SessionData) {
  if (!session.jwt) {
    await bot.sendMessage(session.chatId, t(getLanguage(session), "error.generic"));
    return;
  }
  try {
    const client = createApiClient(session.jwt);
    const status = await client.fetchPlanStatus();
    if (status.requiresUpgrade) {
      session.mode = "subscription";
      session.subscription = { requiredPlan: status.plan };
      sessionStore.update(session.chatId, session);
      const messages = [t(session.language, "plans.require_upgrade")];
      if (status.missingFeature) {
        messages.push(t(session.language, "plans.missing_feature", { feature: status.missingFeature }));
      }
      await showSubscriptionPlans(session, messages.join("\n"));
      return;
    }
  } catch (error) {
    logger.warn("Plan status check failed %o", error);
  }
  await startFilingWizard(session);
}

async function startEstimator(session: SessionData) {
  session.mode = "estimator";
  session.estimator = { stepIndex: 0, data: {} };
  sessionStore.update(session.chatId, session);
  await bot.sendMessage(session.chatId, t(session.language, "estimator.intro"));
  await promptEstimatorStep(session);
}

async function promptEstimatorStep(session: SessionData) {
  const estimator = session.estimator;
  if (!estimator) return;
  const step = refundSteps[estimator.stepIndex];
  if (!step) {
    await finalizeEstimator(session);
    return;
  }
  const language = session.language;
  if (step.type === "select" && step.options) {
    const rows = step.options.map((option) => [
      {
        text: formatOptionLabel(language, option),
        callback_data: `${callbackPrefixes.estimator}:${step.field}:${option.value}`,
      },
    ]);
    await bot.sendMessage(session.chatId, t(language, step.promptKey), {
      reply_markup: { inline_keyboard: rows },
    });
    return;
  }
  await bot.sendMessage(session.chatId, t(language, step.promptKey));
}

async function handleEstimatorResponse(session: SessionData, message: Message) {
  const estimator = session.estimator;
  if (!estimator || !message.text) return;
  const step = refundSteps[estimator.stepIndex];
  if (!step) return;
  const language = session.language;
  const textValue = message.text.trim();
  if (!textValue) {
    await bot.sendMessage(session.chatId, t(language, "estimator.invalid_number"));
    return;
  }

  switch (step.type) {
    case "number": {
      const value = Number.parseInt(textValue, 10);
      if (Number.isNaN(value) || value < 0) {
        await bot.sendMessage(session.chatId, t(language, "estimator.invalid_number"));
        return;
      }
      (estimator.data as Record<string, unknown>)[step.field] = value;
      break;
    }
    case "currency": {
      const normalized = textValue.replace(/[^0-9.,-]/g, "").replace(/,/g, "");
      const value = Number.parseFloat(normalized);
      if (Number.isNaN(value) || value < 0) {
        await bot.sendMessage(session.chatId, t(language, "estimator.invalid_number"));
        return;
      }
      (estimator.data as Record<string, unknown>)[step.field] = value;
      break;
    }
    default:
      return;
  }

  estimator.stepIndex += 1;
  session.estimator = estimator;
  sessionStore.update(session.chatId, session);
  await promptEstimatorStep(session);
}

async function finalizeEstimator(session: SessionData) {
  const estimator = session.estimator;
  if (!estimator) return;
  const language = session.language;
  const data = estimator.data as Partial<RefundEstimatePayload>;
  if (!data.filingStatus || data.dependents === undefined || data.annualIncome === undefined) {
    await bot.sendMessage(session.chatId, t(language, "estimator.error"));
    session.mode = "idle";
    session.estimator = undefined;
    sessionStore.update(session.chatId, session);
    await sendMainMenu(session);
    return;
  }

  const payload: RefundEstimatePayload = {
    filingStatus: data.filingStatus,
    dependents: Number(data.dependents),
    annualIncome: Number(data.annualIncome),
  };

  try {
    const client = createApiClient(session.jwt);
    const result = await client.estimateRefund(payload);
    const lines: string[] = [t(language, "estimator.result_title")];
    if (typeof result.refundAmount === "number") {
      lines.push(
        t(language, "estimator.result_refund", {
          amount: formatCurrency(language, result.refundAmount, result.currency ?? "USD"),
        })
      );
    }
    if (typeof result.taxDue === "number") {
      lines.push(
        t(language, "estimator.result_tax_due", {
          amount: formatCurrency(language, result.taxDue, result.currency ?? "USD"),
        })
      );
    }
    if (result.summary) {
      lines.push(t(language, "estimator.result_summary", { summary: result.summary }));
    }
    await bot.sendMessage(session.chatId, lines.join("\n"));
    if (result.downloadUrl) {
      await bot.sendMessage(session.chatId, t(language, "estimator.result_download"), {
        reply_markup: {
          inline_keyboard: [[{ text: t(language, "estimator.result_download"), url: result.downloadUrl }]],
        },
      });
    }
  } catch (error) {
    logger.error("Refund estimate error %o", error);
    await bot.sendMessage(session.chatId, t(language, "estimator.error"));
  }

  session.mode = "idle";
  session.estimator = undefined;
  sessionStore.update(session.chatId, session);
  await sendMainMenu(session);
}

async function startFilingWizard(session: SessionData) {
  if (!session.jwt) {
    await bot.sendMessage(session.chatId, t(getLanguage(session), "error.generic"));
    return;
  }
  const client = createApiClient(session.jwt);
  try {
    const response = await client.startOrResumeFiling();
    session.mode = "filing";
    session.filing = {
      filingId: response.filingId,
      stepIndex: response.step ?? 0,
      totalSteps: filingSteps.length,
      data: response.data ?? {},
    };
    sessionStore.update(session.chatId, session);
    if (response.step && response.step < filingSteps.length) {
      await bot.sendMessage(session.chatId, t(session.language, "filing.resume_prompt"));
    } else {
      await bot.sendMessage(session.chatId, t(session.language, "filing.start"));
    }
    await promptFilingStep(session);
  } catch (error) {
    logger.error("startFilingWizard error %o", error);
    await bot.sendMessage(session.chatId, t(session.language, "error.generic"));
  }
}

async function promptFilingStep(session: SessionData) {
  const filing = session.filing;
  if (!filing) return;
  const step = filingSteps[filing.stepIndex];
  if (!step) {
    await sendFilingSummary(session);
    return;
  }
  const language = session.language;
  const buttons: InlineKeyboardButton[][] = [
    [
      { text: t(language, "menu.cancel"), callback_data: `${callbackPrefixes.filing}:CANCEL` },
    ],
  ];
  if (filing.stepIndex > 0) {
    buttons[0].unshift({
      text: t(language, "menu.back"),
      callback_data: `${callbackPrefixes.filing}:BACK`,
    });
  }
  if (step.optional) {
    buttons.push([
      {
        text: t(language, "registration.optional_skip"),
        callback_data: `${callbackPrefixes.filing}:SKIP`,
      },
    ]);
  }
  const progress = t(language, "filing.step_progress", {
    current: filing.stepIndex + 1,
    total: filing.totalSteps,
  });
  await bot.sendMessage(session.chatId, `${progress}\n\n${t(language, step.promptKey)}`, {
    reply_markup: { inline_keyboard: buttons },
  });
}

async function handleFilingResponse(session: SessionData, message: Message) {
  const filing = session.filing;
  if (!filing || !message.text) return;
  const step = filingSteps[filing.stepIndex];
  if (!step) return;
  const language = session.language;
  const text = message.text.trim();
  if (!text) {
    await bot.sendMessage(session.chatId, t(language, "error.generic"));
    return;
  }
  filing.data[step.field] = text;
  try {
    const client = createApiClient(session.jwt);
    if (session.jwt) {
      await client.saveFilingStep(filing.filingId!, filing.stepIndex, { [step.field]: text } as Partial<FilingData>);
    }
    filing.stepIndex += 1;
    session.filing = filing;
    sessionStore.update(session.chatId, session);
    await bot.sendMessage(session.chatId, t(language, "filing.saved"));
    await promptFilingStep(session);
  } catch (error) {
    logger.error("Filing save error %o", error);
    await bot.sendMessage(session.chatId, t(language, "error.generic"));
  }
}

async function sendFilingSummary(session: SessionData) {
  const filing = session.filing;
  if (!filing) return;
  const language = session.language;
  const lines: string[] = [t(language, "filing.summary_review")];
  for (const step of filingSteps) {
    const label = t(language, step.promptKey);
    const value = filing.data[step.field] ?? "—";
    lines.push(`• ${label}: ${value}`);
  }
  const keyboard: InlineKeyboardButton[][] = filingSteps.map((step) => [
    {
      text: t(language, "menu.back") + ` (${t(language, step.promptKey)})`,
      callback_data: `${callbackPrefixes.filing}:EDIT:${step.field}`,
    },
  ]);
  keyboard.push([
    { text: t(language, "filing.confirm_submit"), callback_data: `${callbackPrefixes.filing}:SUBMIT` },
  ]);
  keyboard.push([
    { text: t(language, "menu.cancel"), callback_data: `${callbackPrefixes.filing}:CANCEL` },
  ]);
  await bot.sendMessage(session.chatId, `${t(language, "filing.summary_title")}` + `\n\n${lines.join("\n")}`, {
    reply_markup: { inline_keyboard: keyboard },
  });
}

async function submitFiling(session: SessionData) {
  const filing = session.filing;
  if (!filing || !session.jwt) return;
  const client = createApiClient(session.jwt);
  try {
    await client.submitFiling(filing.filingId!);
    session.filing = undefined;
    session.mode = "idle";
    sessionStore.update(session.chatId, session);
    await bot.sendMessage(session.chatId, t(session.language, "filing.submitted"));
    await sendMainMenu(session);
  } catch (error) {
    logger.error("submitFiling error %o", error);
    await bot.sendMessage(session.chatId, t(session.language, "error.generic"));
  }
}

async function handleAiQuestion(session: SessionData, message: Message) {
  if (!message.text) return;
  const language = session.language;
  await bot.sendMessage(session.chatId, t(language, "ai.thinking"));
  try {
    const client = createApiClient(session.jwt);
    const response = await client.askAi(message.text, language);
    let reply = response.answer;
    if (response.references && response.references.length > 0) {
      reply += `\n\n${t(language, "ai.reference_prefix")}`;
      for (const ref of response.references) {
        reply += `\n- ${ref}`;
      }
    }
    await bot.sendMessage(session.chatId, reply, { disable_web_page_preview: true });
  } catch (error) {
    logger.error("AI question error %o", error);
    await bot.sendMessage(session.chatId, t(language, "ai.error"));
  }
}

function formatProfile(profile: UserProfile, language: LanguageCode): string {
  const lines = [t(language, "profile.title")];
  lines.push(`• ${t(language, "profile.field_fullName")}: ${profile.fullName}`);
  lines.push(`• Email: ${profile.email}`);
  if (profile.phone) lines.push(`• ${t(language, "profile.field_phone")}: ${profile.phone}`);
  if (profile.filingStatus) lines.push(`• ${t(language, "profile.field_filingStatus")}: ${profile.filingStatus}`);
  if (profile.incomeType) lines.push(`• ${t(language, "profile.field_incomeType")}: ${profile.incomeType}`);
  if (profile.state) lines.push(`• ${t(language, "profile.field_state")}: ${profile.state}`);
  if (profile.language) lines.push(t(language, "profile.current_language", { language: languageLabel(profile.language) }));
  return lines.join("\n");
}

async function showProfile(session: SessionData) {
  if (!session.jwt) {
    await bot.sendMessage(session.chatId, t(session.language, "error.generic"));
    return;
  }
  const client = createApiClient(session.jwt);
  try {
    const profile = await client.fetchProfile();
    session.profile = profile;
    sessionStore.update(session.chatId, session);
    await bot.sendMessage(session.chatId, formatProfile(profile, session.language), {
      reply_markup: {
        inline_keyboard: [
          [
            { text: t(session.language, "profile.field_fullName"), callback_data: `${callbackPrefixes.profile}:EDIT:fullName` },
            { text: t(session.language, "profile.field_phone"), callback_data: `${callbackPrefixes.profile}:EDIT:phone` },
          ],
          [
            { text: t(session.language, "profile.field_filingStatus"), callback_data: `${callbackPrefixes.profile}:EDIT:filingStatus` },
            { text: t(session.language, "profile.field_incomeType"), callback_data: `${callbackPrefixes.profile}:EDIT:incomeType` },
          ],
          [
            { text: t(session.language, "profile.field_state"), callback_data: `${callbackPrefixes.profile}:EDIT:state` },
            { text: t(session.language, "menu.cancel"), callback_data: `${callbackPrefixes.profile}:CANCEL` },
          ],
        ],
      },
    });
  } catch (error) {
    logger.error("showProfile error %o", error);
    await bot.sendMessage(session.chatId, t(session.language, "error.generic"));
  }
}

async function handleProfileEditInput(session: SessionData, message: Message) {
  if (!session.profileEditor || !message.text || !session.jwt) return;
  const field = session.profileEditor.editField;
  const language = session.language;
  const value = message.text.trim();
  if (!value) {
    await bot.sendMessage(session.chatId, t(language, "error.generic"));
    return;
  }
  const payload: Partial<UserProfile> = { [field!]: value } as Partial<UserProfile>;
  const client = createApiClient(session.jwt);
  try {
    const profile = await client.updateProfile(payload);
    session.profile = profile;
    session.profileEditor = undefined;
    session.mode = "idle";
    sessionStore.update(session.chatId, session);
    await bot.sendMessage(session.chatId, t(language, "profile.updated"));
    await showProfile(session);
  } catch (error) {
    logger.error("Profile update error %o", error);
    await bot.sendMessage(session.chatId, t(language, "error.generic"));
  }
}

async function listTaxForms(session: SessionData) {
  if (!session.jwt) {
    await bot.sendMessage(session.chatId, t(session.language, "error.generic"));
    return;
  }
  const client = createApiClient(session.jwt);
  try {
    const forms = await client.listTaxForms();
    if (forms.length === 0) {
      await bot.sendMessage(session.chatId, t(session.language, "forms.empty"));
      return;
    }
    const lines = [t(session.language, "forms.list_header")];
    const inline_keyboard: InlineKeyboardButton[][] = [];
    for (const form of forms) {
      lines.push(
        t(session.language, "forms.item_line", {
          name: form.name,
          year: form.year,
          status: formatStatus(session.language, form.status),
        })
      );
      inline_keyboard.push([
        {
          text: `${form.name} (${form.year})`,
          callback_data: `${callbackPrefixes.pdf}:${form.id}`,
        },
      ]);
    }
    await bot.sendMessage(session.chatId, lines.join("\n"), {
      reply_markup: { inline_keyboard },
    });
  } catch (error) {
    logger.error("listTaxForms error %o", error);
    await bot.sendMessage(session.chatId, t(session.language, "error.generic"));
  }
}

async function downloadPdf(session: SessionData, formId: string) {
  if (!session.jwt) return;
  const client = createApiClient(session.jwt);
  await bot.sendMessage(session.chatId, t(session.language, "pdf.preparing"));
  try {
    const blob = await client.downloadTaxForm(formId);
    const buffer = Buffer.from(await blob.arrayBuffer());
    await bot.sendDocument(session.chatId, { value: buffer, filename: `${formId}.pdf`, contentType: "application/pdf" });
    await bot.sendMessage(session.chatId, t(session.language, "pdf.ready"));
  } catch (error) {
    logger.error("downloadPdf error %o", error);
    await bot.sendMessage(session.chatId, t(session.language, "error.generic"));
  }
}

async function createPayment(session: SessionData) {
  if (!session.jwt) return;
  const client = createApiClient(session.jwt);
  await bot.sendMessage(session.chatId, t(session.language, "payment.creating"));
  try {
    const result = await client.createPaymentSession();
    await bot.sendMessage(session.chatId, t(session.language, "payment.success"), {
      reply_markup: {
        inline_keyboard: [[{ text: "Stripe Checkout", url: result.checkoutUrl }]],
      },
    });
  } catch (error) {
    logger.error("createPayment error %o", error);
    await bot.sendMessage(session.chatId, t(session.language, "payment.failed"));
  }
}

async function showSubscriptionPlans(session: SessionData, heading?: string) {
  const language = session.language;
  const lines = [
    t(language, "plans.table_header"),
    t(language, "plans.plan_standard"),
    t(language, "plans.plan_pro"),
    t(language, "plans.plan_premium"),
  ];
  const message = heading ? `${heading}\n\n${lines.join("\n")}` : lines.join("\n");
  const buttons: InlineKeyboardButton[][] = [
    [{ text: t(language, "plans.plan_standard"), callback_data: `${callbackPrefixes.subscription}:STANDARD` }],
    [{ text: t(language, "plans.plan_pro"), callback_data: `${callbackPrefixes.subscription}:PRO` }],
    [{ text: t(language, "plans.plan_premium"), callback_data: `${callbackPrefixes.subscription}:PREMIUM` }],
    [{ text: t(language, "menu.cancel"), callback_data: `${callbackPrefixes.subscription}:CANCEL` }],
  ];
  session.mode = "subscription";
  session.subscription = session.subscription ?? {};
  sessionStore.update(session.chatId, session);
  await bot.sendMessage(session.chatId, message, {
    reply_markup: { inline_keyboard: buttons },
  });
}

async function handlePlanSelection(session: SessionData, plan: string) {
  if (plan === "CANCEL") {
    session.mode = "idle";
    session.subscription = undefined;
    sessionStore.update(session.chatId, session);
    await sendMainMenu(session);
    return;
  }
  if (!session.jwt) {
    await bot.sendMessage(session.chatId, t(session.language, "error.generic"));
    return;
  }
  try {
    const client = createApiClient(session.jwt);
    const checkout = await client.createPlanCheckout(plan.toLowerCase());
    await bot.sendMessage(session.chatId, t(session.language, "plans.payment_sent"), {
      reply_markup: {
        inline_keyboard: [[{ text: t(session.language, "plans.payment_link"), url: checkout.checkoutUrl }]],
      },
    });
  } catch (error) {
    logger.error("Plan checkout error %o", error);
    await bot.sendMessage(session.chatId, t(session.language, "payment.failed"));
  }
  session.mode = "idle";
  session.subscription = undefined;
  sessionStore.update(session.chatId, session);
  await sendMainMenu(session);
}

async function startReminderFlow(session: SessionData) {
  session.mode = "reminder";
  session.reminder = {};
  sessionStore.update(session.chatId, session);
  await bot.sendMessage(session.chatId, t(session.language, "reminder.prompt_type"), {
    reply_markup: {
      inline_keyboard: REMINDER_TYPES.map((type) => [
        {
          text: formatOptionLabel(session.language, type),
          callback_data: `${callbackPrefixes.reminder}:TYPE:${type.value}`,
        },
      ]).concat([[{ text: t(session.language, "menu.cancel"), callback_data: `${callbackPrefixes.reminder}:CANCEL` }]]),
    },
  });
}

async function handleReminderInput(session: SessionData, message: Message) {
  if (!session.reminder || !session.reminder.reminderType || !session.jwt || !message.text) return;
  const dueDate = message.text.trim();
  if (!dueDate) {
    await bot.sendMessage(session.chatId, t(session.language, "error.generic"));
    return;
  }
  const client = createApiClient(session.jwt);
  try {
    const reminderType = session.reminder.reminderType;
    await client.scheduleReminder(reminderType, dueDate);
    session.mode = "idle";
    session.reminder = undefined;
    sessionStore.update(session.chatId, session);
    await bot.sendMessage(session.chatId, t(session.language, "reminder.saved"));
    try {
      const calendar = await client.createCalendarLink(dueDate, reminderType);
      await bot.sendMessage(session.chatId, t(session.language, "reminder.add_calendar"), {
        reply_markup: { inline_keyboard: [[{ text: "Calendar", url: calendar.url }]] },
      });
    } catch (calendarError) {
      logger.warn("Calendar link error %o", calendarError);
    }
    await sendMainMenu(session);
  } catch (error) {
    logger.error("Reminder error %o", error);
    await bot.sendMessage(session.chatId, t(session.language, "error.generic"));
  }
}

function resetToMainMenu(session: SessionData) {
  session.mode = "idle";
  session.registration = undefined;
  session.login = undefined;
  session.filing = undefined;
  session.profileEditor = undefined;
  session.reminder = undefined;
  session.estimator = undefined;
  session.subscription = undefined;
  session.pendingAfterDisclaimer = undefined;
  sessionStore.update(session.chatId, session);
}

async function handleCallbackQuery(callback: CallbackQuery) {
  const data = callback.data;
  if (!data) return;
  const message = callback.message;
  if (!message) return;
  const session = ensureSession(message);
  if (!session) return;
  const [prefix, ...parts] = data.split(":");
  try {
    switch (prefix) {
      case callbackPrefixes.language: {
        const language = parts[0] as LanguageCode;
        session.language = language;
        sessionStore.update(session.chatId, session);
        if (session.jwt) {
          try {
            const client = createApiClient(session.jwt);
            const profile = await client.updateLanguage(language);
            session.profile = profile;
            sessionStore.update(session.chatId, session);
          } catch (error) {
            logger.warn("Language update API error %o", error);
          }
          await bot.sendMessage(session.chatId, t(language, "language.updated", { language: languageLabel(language) }));
          await sendDisclaimer(session, "showMenu");
        } else {
          if (session.registration) {
            session.registration.data.language = language;
            session.registration.stepIndex = 0;
          }
          session.registration = session.registration ?? {
            stepIndex: 0,
            data: { telegramId: session.telegramId, language } as Partial<RegistrationPayload>,
          };
          session.mode = "registration";
          sessionStore.update(session.chatId, session);
          await sendDisclaimer(session, "startRegistration");
        }
        break;
      }
      case callbackPrefixes.registration: {
        const action = parts[0];
        if (!session.registration) break;
        if (action === "SKIP") {
          const field = parts[1] as RegistrationField;
          session.registration.data[field] = undefined;
          session.registration.stepIndex += 1;
          sessionStore.update(session.chatId, session);
          await promptRegistrationStep(session);
        } else {
          const field = action as RegistrationField;
          const value = parts[1];
          session.registration.data[field] = value;
          session.registration.stepIndex += 1;
          sessionStore.update(session.chatId, session);
          await promptRegistrationStep(session);
        }
        break;
      }
      case callbackPrefixes.estimator: {
        if (!session.estimator) break;
        const field = parts[0] as EstimatorField;
        const value = parts[1];
        (session.estimator.data as Record<string, unknown>)[field] = value;
        session.estimator.stepIndex += 1;
        sessionStore.update(session.chatId, session);
        await promptEstimatorStep(session);
        break;
      }
      case callbackPrefixes.menu: {
        const action = parts[0];
        switch (action) {
          case "ASK_AI":
            session.mode = "ai";
            sessionStore.update(session.chatId, session);
            await bot.sendMessage(session.chatId, t(session.language, "ai.prompt"));
            break;
          case "ESTIMATE":
            await startEstimator(session);
            break;
          case "FILE_TAXES":
            await handleFileTaxes(session);
            break;
          case "DOCUMENTS":
            await listTaxForms(session);
            break;
          case "SUBSCRIPTIONS":
            await showSubscriptionPlans(session);
            break;
          case "CHANGE_LANGUAGE":
            await sendLanguageMenu(session.chatId, session.language);
            break;
          case "PROFILE":
            session.mode = "profile";
            sessionStore.update(session.chatId, session);
            await showProfile(session);
            break;
          case "REMINDERS":
            await startReminderFlow(session);
            break;
          default:
            await sendMainMenu(session);
        }
        break;
      }
      case callbackPrefixes.filing: {
        if (!session.filing) break;
        const action = parts[0];
        if (action === "BACK") {
          if (session.filing.stepIndex > 0) {
            session.filing.stepIndex -= 1;
            sessionStore.update(session.chatId, session);
            await promptFilingStep(session);
          }
        } else if (action === "CANCEL") {
          session.filing = undefined;
          session.mode = "idle";
          sessionStore.update(session.chatId, session);
          await sendMainMenu(session);
        } else if (action === "SKIP") {
          const step = filingSteps[session.filing.stepIndex];
          if (step) {
            session.filing.data[step.field] = "";
            session.filing.stepIndex += 1;
            sessionStore.update(session.chatId, session);
            await promptFilingStep(session);
          }
        } else if (action === "EDIT") {
          const field = parts[1] as keyof FilingData;
          const index = filingSteps.findIndex((step) => step.field === field);
          if (index >= 0) {
            session.filing.stepIndex = index;
            sessionStore.update(session.chatId, session);
            await promptFilingStep(session);
          }
        } else if (action === "SUBMIT") {
          await submitFiling(session);
        }
        break;
      }
      case callbackPrefixes.pdf: {
        const formId = parts[0];
        await downloadPdf(session, formId);
        break;
      }
      case callbackPrefixes.profile: {
        const action = parts[0];
        if (action === "EDIT") {
          const field = parts[1] as keyof UserProfile;
          session.mode = "profile";
          session.profileEditor = { editField: field };
          sessionStore.update(session.chatId, session);
          await bot.sendMessage(session.chatId, t(session.language, "profile.update_prompt", { field: t(session.language, `profile.field_${field}`) }));
        } else if (action === "CANCEL") {
          session.profileEditor = undefined;
          session.mode = "idle";
          sessionStore.update(session.chatId, session);
          await bot.sendMessage(session.chatId, t(session.language, "profile.cancelled"));
          await sendMainMenu(session);
        }
        break;
      }
      case callbackPrefixes.reminder: {
        const action = parts[0];
        if (!session.reminder) {
          session.reminder = {};
        }
        if (action === "TYPE") {
          session.reminder.reminderType = parts[1];
          sessionStore.update(session.chatId, session);
          await bot.sendMessage(session.chatId, t(session.language, "reminder.choose_deadline"));
        } else if (action === "CANCEL") {
          session.reminder = undefined;
          session.mode = "idle";
          sessionStore.update(session.chatId, session);
          await bot.sendMessage(session.chatId, t(session.language, "profile.cancelled"));
          await sendMainMenu(session);
        }
        break;
      }
      case callbackPrefixes.subscription: {
        const plan = parts[0];
        await handlePlanSelection(session, plan);
        break;
      }
      default:
        break;
    }
  } finally {
    await bot.answerCallbackQuery(callback.id);
  }
}

async function handleMessage(message: Message) {
  if (message.text?.startsWith("/")) return;
  const session = ensureSession(message);
  if (!session) return;
  const messageWithContact = message as MessageWithContact;
  const hasText = Boolean(message.text && message.text.trim().length > 0);
  const hasContact = Boolean(messageWithContact.contact);
  if (!hasText && !hasContact) return;

  if (
    session.mode === "disclaimer" ||
    (!session.disclaimerAcknowledged && Boolean(session.pendingAfterDisclaimer))
  ) {
    if (!hasText || !message.text) {
      return;
    }
    if (isDisclaimerAcknowledgement(message.text)) {
      session.disclaimerAcknowledged = true;
      session.mode = "idle";
      sessionStore.update(session.chatId, session);
      await bot.sendMessage(session.chatId, t(session.language, "start.disclaimer_confirmed"));
      await handlePostDisclaimerAction(session);
    } else {
      const keyword = getPrimaryAckWord(session.language);
      await bot.sendMessage(session.chatId, t(session.language, "start.disclaimer_retry", { keyword }));
    }
    return;
  }

  switch (session.mode) {
    case "registration":
      await handleRegistrationResponse(session, message);
      break;
    case "login":
      if (!hasText) return;
      await handleLoginResponse(session, message);
      break;
    case "filing":
      if (!hasText) return;
      await handleFilingResponse(session, message);
      break;
    case "ai":
      if (!hasText) return;
      await handleAiQuestion(session, message);
      break;
    case "estimator":
      if (!hasText) return;
      await handleEstimatorResponse(session, message);
      break;
    case "profile":
      if (!hasText) return;
      await handleProfileEditInput(session, message);
      break;
    case "reminder":
      if (!hasText) return;
      await handleReminderInput(session, message);
      break;
    case "subscription":
      if (!hasText) return;
      await showSubscriptionPlans(session);
      break;
    default:
      if (!hasText) return;
      await sendMainMenu(session);
      break;
  }
}

async function setupBot() {
  if (config.webhookUrl) {
    bot = new TelegramBot(config.botToken, { polling: false });
    await bot.setWebHook(config.webhookUrl, config.webhookSecret ? { secret_token: config.webhookSecret } : undefined);
    const server = createServer((req, res) => {
      if (req.method === "POST" && req.url === "/webhook") {
        const secret = req.headers["x-telegram-bot-api-secret-token"];
        if (config.webhookSecret && secret !== config.webhookSecret) {
          res.statusCode = 403;
          res.end("Forbidden");
          return;
        }
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        req.on("end", () => {
          const raw = Buffer.concat(chunks).toString();
          try {
            const update = JSON.parse(raw);
            bot.processUpdate(update);
          } catch (error) {
            logger.error("Invalid webhook payload %o", error);
          }
          res.end("OK");
        });
        return;
      }
      res.statusCode = 404;
      res.end("Not found");
    });
    server.listen(config.port, () => {
      logger.info(`Webhook server listening on port ${config.port}`);
    });
  } else {
    bot = new TelegramBot(config.botToken, { polling: { interval: 1000, timeout: 30 } });
    await bot.deleteWebHook();
    await bot.startPolling();
  }

  await bot.setMyCommands([
    { command: "start", description: "Restart conversation" },
    { command: "menu", description: "Show main menu" },
    { command: "help", description: "How to use the bot" },
  ]);

  bot.onText(/^\/start$/, handleStartCommand);
  bot.onText(/^\/menu$/, (msg) => {
    const session = ensureSession(msg);
    if (!session) return;
    resetToMainMenu(session);
    sendMainMenu(session);
  });
  bot.onText(/^\/help$/, (msg) => {
    const session = ensureSession(msg);
    if (!session) return;
    const language = getLanguage(session);
    const help = `${t(language, "start.welcome")}\n\n` +
      `• /start – restart onboarding\n` +
      `• /menu – ${t(language, "menu.title")}`;
    bot.sendMessage(session.chatId, help);
  });

  bot.on("message", handleMessage);
  bot.on("callback_query", handleCallbackQuery);

  bot.on("polling_error", (err) => {
    logger.error("Polling error %o", err);
  });

  if (config.adminChatId) {
    try {
      await bot.sendMessage(
        config.adminChatId,
        `🚀 ${config.botName} v${config.botVersion} launched (${config.environment})`
      );
    } catch (error) {
      logger.warn("Unable to notify admin %o", error);
    }
  }

  logger.info(`${config.botName} ready. Mode=${config.webhookUrl ? "webhook" : "polling"}`);
}

setupBot().catch((error) => {
  logger.error("Bot startup failed %o", error);
  process.exit(1);
});
