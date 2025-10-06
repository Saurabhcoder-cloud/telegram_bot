import TelegramBot, { CallbackQuery, InlineKeyboardButton, Message } from "node-telegram-bot-api";
import { createServer } from "http";
import { config } from "./config";
import logger from "./logger";
import { LANGUAGES, languageLabel, t } from "./i18n";
import { sessionStore } from "./session";
import {
  FilingData,
  FilingFormConfig,
  FilingFormId,
  FilingFormFieldRequirement,
  LanguageCode,
  RegistrationPayload,
  SessionData,
  UserProfile,
  RefundEstimateResult,
  SubscriptionPlanId,
  AiResponse,
} from "./types";
import { isValidDate, isValidEmail, isValidPhone, normalizePhone } from "./utils/validators";
import {
  FILING_FORM_CONFIG,
  FILING_STATUSES,
  INCOME_TYPES,
  REMINDER_TYPES,
  SUBSCRIPTION_PLANS,
  formatOptionLabel,
  formatStatus,
} from "./constants";
import { ApiError, createApiClient } from "./services/apiClient";
import { estimateRefund } from "./tax/engine";
import { refineDocumentType } from "./ocr/service";
import { formatCurrency } from "./utils/format";
import { AiProviderError, queryAiAssistant } from "./services/aiService";

const DEFAULT_LANGUAGE: LanguageCode = "en";

type RegistrationField = Exclude<keyof RegistrationPayload, "language" | "telegramId">;

type RegistrationStep = {
  field: RegistrationField;
  promptKey: string;
  type: "text" | "email" | "date" | "select" | "optional" | "password" | "phone";
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

type TelegramDocumentAttachment = {
  file_id: string;
  file_name?: string;
  mime_type?: string;
};

type TelegramPhotoAttachment = {
  file_id: string;
  width: number;
  height: number;
  file_size?: number;
};

type FileAttachment = TelegramDocumentAttachment | TelegramPhotoAttachment;

type RichMessage = Message & {
  caption?: string;
  document?: TelegramDocumentAttachment;
  photo?: TelegramPhotoAttachment[];
};

const registrationSteps: RegistrationStep[] = [
  { field: "fullName", promptKey: "registration.ask_full_name", type: "text" },
  { field: "email", promptKey: "registration.ask_email", type: "email" },
  { field: "phone", promptKey: "registration.ask_phone", type: "phone" },
  { field: "password", promptKey: "registration.ask_password", type: "password" },
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

const filingFormsByField = new Map<keyof FilingData, FilingFormConfig[]>();
const filingFormsById = new Map<FilingFormId, FilingFormConfig>();

for (const configItem of FILING_FORM_CONFIG) {
  const existing = filingFormsByField.get(configItem.field) ?? [];
  existing.push(configItem);
  filingFormsByField.set(configItem.field, existing);
  filingFormsById.set(configItem.id, configItem);
}

function getFormConfigsForField(field: keyof FilingData): FilingFormConfig[] {
  return filingFormsByField.get(field) ?? [];
}

function getFormConfigById(formId: FilingFormId): FilingFormConfig | undefined {
  return filingFormsById.get(formId);
}

function formatFormFieldValue(
  language: LanguageCode,
  requirement: FilingFormFieldRequirement,
  rawValue: string | number
): string {
  if (requirement.valueType === "currency") {
    const numeric =
      typeof rawValue === "number"
        ? rawValue
        : Number(String(rawValue).replace(/[^0-9.-]/g, ""));
    if (!Number.isNaN(numeric) && Number.isFinite(numeric)) {
      return formatCurrency(language, numeric);
    }
  }
  return typeof rawValue === "number" ? rawValue.toString() : rawValue;
}

function buildFormSummary(
  language: LanguageCode,
  config: FilingFormConfig,
  collected: Record<string, string>
): string[] {
  return config.requiredFields.map((requirement) => {
    const value = collected[requirement.key] ?? "—";
    return `${t(language, requirement.labelKey)}: ${value}`;
  });
}

const loginSteps: LoginStep[] = [
  { field: "email", promptKey: "login.ask_email", type: "email" },
  { field: "password", promptKey: "login.ask_password", type: "password" },
];

const callbackPrefixes = {
  language: "LANG",
  registration: "REG",
  menu: "MENU",
  filing: "FILING",
  filingForm: "FILING_FORM",
  pdf: "PDF",
  profile: "PROFILE",
  reminder: "REMINDER",
  estimate: "EST",
  estimatePdf: "ESTPDF",
  subscription: "SUB",
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
      {
        text: t(language, "menu.ask_tax_question"),
        callback_data: `${callbackPrefixes.menu}:ASK_TAX_QUESTION`,
      },
      {
        text: t(language, "menu.estimate_refund"),
        callback_data: `${callbackPrefixes.menu}:ESTIMATE_REFUND`,
      },
    ],
    [
      { text: t(language, "menu.file_taxes"), callback_data: `${callbackPrefixes.menu}:FILE_TAXES` },
      { text: t(language, "menu.my_documents"), callback_data: `${callbackPrefixes.menu}:MY_DOCUMENTS` },
    ],
    [
      {
        text: t(language, "menu.subscription_plans"),
        callback_data: `${callbackPrefixes.menu}:SUBSCRIPTION_PLANS`,
      },
    ],
  ];
  await bot.sendMessage(session.chatId, t(language, "menu.title"), {
    reply_markup: { inline_keyboard },
  });
}

function calculateRefundEstimate(status: string, dependents: number, income: number): RefundEstimateResult {
  return estimateRefund({ status, dependents, income });
}

async function sendDisclaimer(session: SessionData) {
  await bot.sendMessage(session.chatId, t(session.language, "start.disclaimer"));
}

function findSubscriptionPlan(planId: SubscriptionPlanId) {
  return SUBSCRIPTION_PLANS.find((plan) => plan.id === planId);
}

function subscriptionPlanLabel(language: LanguageCode, planId: SubscriptionPlanId): string {
  const plan = findSubscriptionPlan(planId);
  return plan ? t(language, plan.labelKey) : planId;
}

function isDocumentAttachment(attachment: FileAttachment): attachment is TelegramDocumentAttachment {
  return "mime_type" in attachment || "file_name" in attachment;
}

async function downloadTelegramFile(
  fileId: string
): Promise<{ buffer: Buffer; mimeType?: string; filePath?: string }> {
  const infoResponse = await fetch(`https://api.telegram.org/bot${config.botToken}/getFile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
  });
  if (!infoResponse.ok) {
    const text = await infoResponse.text();
    throw new Error(`getFile failed (${infoResponse.status}): ${text}`);
  }
  const infoPayload = await infoResponse.json();
  const filePath = infoPayload?.result?.file_path as string | undefined;
  if (!filePath) {
    throw new Error("Telegram getFile response missing file_path");
  }
  const fileUrl = `https://api.telegram.org/file/bot${config.botToken}/${filePath}`;
  const fileResponse = await fetch(fileUrl);
  if (!fileResponse.ok) {
    throw new Error(`Failed to download file ${fileResponse.status}`);
  }
  const arrayBuffer = await fileResponse.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType: fileResponse.headers.get("content-type") ?? undefined,
    filePath,
  };
}

async function beginRegistration(session: SessionData, messageKey?: string) {
  const language = getLanguage(session);
  if (messageKey) {
    await bot.sendMessage(session.chatId, t(language, messageKey));
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
  await promptRegistrationStep(session);
}

async function handleStartCommand(message: Message) {
  const session = ensureSession(message);
  if (!session) return;

  resetToMainMenu(session);

  if (!session.jwt) {
    try {
      const client = createApiClient();
      const existing = await client.getProfileByTelegramId(session.telegramId);
      if (existing) {
        session.jwt = existing.token;
        session.profile = existing.user;
        session.language = existing.user.language;
        sessionStore.update(session.chatId, session);
        await bot.sendMessage(
          session.chatId,
          t(session.language, "registration.success_returning", { name: existing.user.fullName })
        );
      }
    } catch (error) {
      if (error instanceof ApiError && error.status !== 404) {
        logger.error("Failed to fetch profile by telegram id", error);
      }
    }
  }

  const language = getLanguage(session);
  await bot.sendMessage(session.chatId, t(language, "start.welcome"));
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

  const requiredFieldChecks: { field: RegistrationField; messageKey: string }[] = [
    { field: "phone", messageKey: "registration.missing_phone" },
    { field: "password", messageKey: "registration.missing_password" },
  ];

  for (const { field, messageKey } of requiredFieldChecks) {
    if (!payload[field]) {
      const stepIndex = registrationSteps.findIndex((step) => step.field === field);
      if (stepIndex >= 0) {
        registration.stepIndex = stepIndex;
        session.registration = registration;
        sessionStore.update(session.chatId, session);
      }
      await bot.sendMessage(session.chatId, t(language, messageKey));
      await promptRegistrationStep(session);
      return;
    }
  }

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
  if (!registration || !message.text) return;
  const step = registrationSteps[registration.stepIndex];
  const language = getLanguage(session);
  if (!step) return;
  const text = message.text.trim();

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
    case "phone": {
      if (!isValidPhone(text)) {
        await bot.sendMessage(session.chatId, t(language, "registration.invalid_phone"));
        return;
      }
      registration.data[step.field] = normalizePhone(text);
      break;
    }
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
    case "password":
      if (text.length < 6) {
        await bot.sendMessage(session.chatId, t(language, "registration.invalid_password"));
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

async function startEstimateFlow(session: SessionData) {
  session.mode = "estimate";
  session.estimate = { step: "status" };
  sessionStore.update(session.chatId, session);
  await bot.sendMessage(session.chatId, t(session.language, "estimate.intro"));
  await promptEstimateStep(session);
}

async function promptEstimateStep(session: SessionData) {
  const state = session.estimate;
  if (!state) return;
  const language = session.language;
  if (state.step === "status") {
    await bot.sendMessage(session.chatId, t(language, "estimate.prompt_status"), {
      reply_markup: {
        inline_keyboard: FILING_STATUSES.map((status) => [
          {
            text: formatOptionLabel(language, status),
            callback_data: `${callbackPrefixes.estimate}:STATUS:${status.value}`,
          },
        ]),
      },
    });
    return;
  }
  if (state.step === "dependents") {
    await bot.sendMessage(session.chatId, t(language, "estimate.prompt_dependents"));
    return;
  }
  if (state.step === "income") {
    await bot.sendMessage(session.chatId, t(language, "estimate.prompt_income"));
    return;
  }
  if (state.step === "result") {
    await sendEstimateSummary(session);
  }
}

async function handleEstimateInput(session: SessionData, message: Message) {
  const state = session.estimate;
  if (!state || !message.text) return;
  const language = session.language;
  const text = message.text.trim();
  if (state.step === "dependents") {
    const value = Number.parseInt(text, 10);
    if (Number.isNaN(value) || value < 0) {
      await bot.sendMessage(session.chatId, t(language, "estimate.invalid_number"));
      return;
    }
    state.dependents = value;
    state.step = "income";
    session.estimate = state;
    sessionStore.update(session.chatId, session);
    await promptEstimateStep(session);
    return;
  }
  if (state.step === "income") {
    const sanitized = text.replace(/[^0-9.,-]/g, "").replace(/,/g, "");
    const value = Number.parseFloat(sanitized);
    if (!Number.isFinite(value) || value < 0) {
      await bot.sendMessage(session.chatId, t(language, "estimate.invalid_number"));
      return;
    }
    state.income = value;
    state.step = "result";
    session.estimate = state;
    sessionStore.update(session.chatId, session);
    await completeEstimate(session);
  }
}

async function completeEstimate(session: SessionData) {
  const state = session.estimate;
  if (!state || !state.status || state.dependents === undefined || state.income === undefined) return;
  const result = calculateRefundEstimate(state.status, state.dependents, state.income);
  state.result = result;
  state.step = "result";
  session.estimate = state;
  session.mode = "idle";
  sessionStore.update(session.chatId, session);
  await sendEstimateSummary(session);
}

async function sendEstimateSummary(session: SessionData) {
  const state = session.estimate;
  if (!state || !state.result) return;
  const { result } = state;
  const language = session.language;
  const statusOption = FILING_STATUSES.find((option) => option.value === result.status);
  const statusLabel = statusOption ? formatOptionLabel(language, statusOption) : result.status;
  const baseSummary = t(language, "estimate.result_details", {
    status: statusLabel,
    dependents: result.dependents,
    income: formatCurrency(language, result.income),
    taxable: formatCurrency(language, result.taxableIncome),
    credits: formatCurrency(language, result.credits),
    withheld: formatCurrency(language, result.withheld),
    tax: formatCurrency(language, result.estimatedTax),
  });
  const extraLines: string[] = [];
  if (result.creditsBreakdown) {
    if (result.creditsBreakdown.childTaxCredit > 0) {
      extraLines.push(
        t(language, "estimate.summary_child_credit", {
          amount: formatCurrency(language, result.creditsBreakdown.childTaxCredit),
        })
      );
    }
    if (result.creditsBreakdown.earnedIncomeCredit > 0) {
      extraLines.push(
        t(language, "estimate.summary_eitc", {
          amount: formatCurrency(language, result.creditsBreakdown.earnedIncomeCredit),
        })
      );
    }
    if (result.creditsBreakdown.educationCredit > 0) {
      extraLines.push(
        t(language, "estimate.summary_education_credit", {
          amount: formatCurrency(language, result.creditsBreakdown.educationCredit),
        })
      );
    }
  }
  if (typeof result.marginalRate === "number") {
    extraLines.push(
      t(language, "estimate.summary_marginal_rate", {
        rate: (result.marginalRate * 100).toFixed(1),
      })
    );
  }
  const summary = [baseSummary, ...extraLines].join("\n");
  let conclusion: string;
  if (result.net > 0) {
    conclusion = t(language, "estimate.result_refund", { amount: formatCurrency(language, Math.abs(result.net)) });
  } else if (result.net < 0) {
    conclusion = t(language, "estimate.result_tax_due", { amount: formatCurrency(language, Math.abs(result.net)) });
  } else {
    conclusion = t(language, "estimate.result_break_even");
  }
  const inline_keyboard: InlineKeyboardButton[][] = [
    [
      {
        text: t(language, "estimate.download_pdf"),
        callback_data: `${callbackPrefixes.estimatePdf}:LATEST`,
      },
    ],
    [
      { text: t(language, "estimate.restart"), callback_data: `${callbackPrefixes.estimate}:RESTART` },
      { text: t(language, "menu.subscription_plans"), callback_data: `${callbackPrefixes.menu}:SUBSCRIPTION_PLANS` },
    ],
    [
      { text: t(language, "menu.back_to_main"), callback_data: `${callbackPrefixes.menu}:MAIN` },
    ],
  ];
  await bot.sendMessage(session.chatId, `${summary}\n\n${conclusion}`, {
    reply_markup: { inline_keyboard },
  });
}

function escapePdfText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function createEstimatePdf(language: LanguageCode, result: RefundEstimateResult): Buffer {
  const statusOption = FILING_STATUSES.find((option) => option.value === result.status);
  const statusLabel = statusOption ? formatOptionLabel(language, statusOption) : result.status;
  const lines = [
    t(language, "estimate.pdf_title"),
    "",
    t(language, "estimate.summary_status", { status: statusLabel }),
    t(language, "estimate.summary_dependents", { dependents: result.dependents }),
    t(language, "estimate.summary_income", { income: formatCurrency(language, result.income) }),
    t(language, "estimate.summary_taxable", { taxable: formatCurrency(language, result.taxableIncome) }),
    t(language, "estimate.summary_tax", { tax: formatCurrency(language, result.estimatedTax) }),
    t(language, "estimate.summary_credits", { credits: formatCurrency(language, result.credits) }),
    t(language, "estimate.summary_withheld", { withheld: formatCurrency(language, result.withheld) }),
  ];
  if (result.creditsBreakdown) {
    if (result.creditsBreakdown.childTaxCredit > 0) {
      lines.push(
        t(language, "estimate.summary_child_credit", {
          amount: formatCurrency(language, result.creditsBreakdown.childTaxCredit),
        })
      );
    }
    if (result.creditsBreakdown.earnedIncomeCredit > 0) {
      lines.push(
        t(language, "estimate.summary_eitc", {
          amount: formatCurrency(language, result.creditsBreakdown.earnedIncomeCredit),
        })
      );
    }
    if (result.creditsBreakdown.educationCredit > 0) {
      lines.push(
        t(language, "estimate.summary_education_credit", {
          amount: formatCurrency(language, result.creditsBreakdown.educationCredit),
        })
      );
    }
  }
  if (typeof result.marginalRate === "number") {
    lines.push(
      t(language, "estimate.summary_marginal_rate", {
        rate: (result.marginalRate * 100).toFixed(1),
      })
    );
  }
  if (result.net > 0) {
    lines.push(t(language, "estimate.result_refund", { amount: formatCurrency(language, Math.abs(result.net)) }));
  } else if (result.net < 0) {
    lines.push(t(language, "estimate.result_tax_due", { amount: formatCurrency(language, Math.abs(result.net)) }));
  } else {
    lines.push(t(language, "estimate.result_break_even"));
  }

  const escapedLines = lines.map((line) => `(${escapePdfText(line)}) Tj`);
  if (escapedLines.length === 0) {
    escapedLines.push("() Tj");
  }
  const textStream = [
    "BT",
    "/F1 18 Tf",
    "1 0 0 1 72 720 Tm",
    "24 TL",
    escapedLines[0],
    ...escapedLines.slice(1).flatMap((line) => ["T*", line]),
    "ET",
    "",
  ].join("\n");
  const objects: string[] = [];
  const header = "%PDF-1.4\n";
  const contentLength = Buffer.byteLength(textStream, "utf-8");
  objects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  objects.push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  objects.push(
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n"
  );
  objects.push(`4 0 obj\n<< /Length ${contentLength} >>\nstream\n${textStream}endstream\nendobj\n`);
  objects.push("5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Name /F1 >>\nendobj\n");

  let offset = header.length;
  const xrefEntries = ["0000000000 65535 f \n"];
  const body = objects
    .map((obj) => {
      const current = offset;
      offset += Buffer.byteLength(obj, "utf-8");
      xrefEntries.push(`${current.toString().padStart(10, "0")} 00000 n \n`);
      return obj;
    })
    .join("");
  const xrefStart = offset;
  const xref =
    `xref\n0 ${objects.length + 1}\n` +
    xrefEntries.join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  const pdf = header + body + xref;
  return Buffer.from(pdf, "utf-8");
}

async function sendEstimatePdf(session: SessionData) {
  const state = session.estimate;
  if (!state || !state.result) {
    await bot.sendMessage(session.chatId, t(session.language, "error.generic"));
    return;
  }
  const buffer = createEstimatePdf(session.language, state.result);
  await bot.sendDocument(session.chatId, {
    value: buffer,
    filename: "refund-estimate.pdf",
    contentType: "application/pdf",
  });
}

async function ensureProfile(session: SessionData): Promise<UserProfile | null> {
  if (!session.jwt) return null;
  if (session.profile) return session.profile;
  const client = createApiClient(session.jwt);
  try {
    const profile = await client.fetchProfile();
    session.profile = profile;
    sessionStore.update(session.chatId, session);
    return profile;
  } catch (error) {
    logger.error("fetchProfile error %o", error);
    return null;
  }
}

async function handleFileTaxes(session: SessionData) {
  if (!session.jwt) {
    await beginRegistration(session, "registration.required_for_filing");
    return;
  }
  const profile = await ensureProfile(session);
  if (!profile) {
    await bot.sendMessage(session.chatId, t(session.language, "error.generic"));
    return;
  }
  const planId = profile.subscriptionPlan ?? "free";
  const status = profile.subscriptionStatus ?? "none";
  if (planId === "free" || status === "none" || status === "canceled" || status === "past_due") {
    await bot.sendMessage(session.chatId, t(session.language, "filing.plan_free_limited"), {
      reply_markup: {
        inline_keyboard: [
          [
            { text: t(session.language, "menu.estimate_refund"), callback_data: `${callbackPrefixes.menu}:ESTIMATE_REFUND` },
          ],
          [
            { text: t(session.language, "menu.subscription_plans"), callback_data: `${callbackPrefixes.menu}:SUBSCRIPTION_PLANS` },
          ],
        ],
      },
    });
    return;
  }
  await bot.sendMessage(
    session.chatId,
    t(session.language, "filing.plan_paid_welcome", { plan: subscriptionPlanLabel(session.language, planId) })
  );
  await startFilingWizard(session);
}

async function ensureAuthenticatedForDocuments(session: SessionData): Promise<boolean> {
  if (session.jwt) return true;
  await beginRegistration(session, "registration.required_for_documents");
  return false;
}

async function showSubscriptionPlans(session: SessionData) {
  const language = session.language;
  const inline_keyboard = SUBSCRIPTION_PLANS.map((plan) => [
    {
      text: t(language, plan.labelKey),
      callback_data: `${callbackPrefixes.subscription}:SELECT:${plan.id}`,
    },
  ]);
  inline_keyboard.push([{ text: t(language, "menu.back_to_main"), callback_data: `${callbackPrefixes.menu}:MAIN` }]);
  await bot.sendMessage(session.chatId, t(language, "subscription.intro"), {
    reply_markup: { inline_keyboard },
  });
}

async function handleSubscriptionAction(session: SessionData, parts: string[]) {
  const action = parts[0];
  const language = session.language;
  if (action === "SELECT") {
    const planId = parts[1] as SubscriptionPlanId;
    const plan = findSubscriptionPlan(planId);
    if (!plan) return;
    await bot.sendMessage(session.chatId, t(language, plan.detailsKey));
    if (!plan.requiresPayment) {
      session.subscription = { planId, awaitingConfirmation: false };
      sessionStore.update(session.chatId, session);
      await bot.sendMessage(session.chatId, t(language, "subscription.free_features"));
      await sendMainMenu(session);
      return;
    }
    if (!session.jwt) {
      await beginRegistration(session, "registration.required_for_subscription");
      return;
    }
    const client = createApiClient(session.jwt);
    try {
      const checkout = await client.createSubscriptionCheckout(planId);
      session.subscription = { planId, awaitingConfirmation: true, checkoutUrl: checkout.checkoutUrl };
      session.mode = "subscription";
      sessionStore.update(session.chatId, session);
      await bot.sendMessage(
        session.chatId,
        t(language, "subscription.payment_link", { plan: t(language, plan.labelKey) }),
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: t(language, "subscription.open_checkout"), url: checkout.checkoutUrl }],
              [
                {
                  text: t(language, "subscription.payment_confirm"),
                  callback_data: `${callbackPrefixes.subscription}:CONFIRM:${planId}`,
                },
              ],
              [{ text: t(language, "menu.back_to_main"), callback_data: `${callbackPrefixes.menu}:MAIN` }],
            ],
          },
        }
      );
    } catch (error) {
      logger.error("Subscription checkout error %o", error);
      await bot.sendMessage(session.chatId, t(language, "subscription.payment_failed"));
    }
  } else if (action === "CONFIRM") {
    const planId = parts[1] as SubscriptionPlanId;
    if (!session.jwt) {
      await bot.sendMessage(session.chatId, t(language, "registration.required_for_subscription"));
      return;
    }
    try {
      const client = createApiClient(session.jwt);
      const profile = await client.fetchProfile();
      session.profile = profile;
      session.subscription = undefined;
      session.mode = "idle";
      sessionStore.update(session.chatId, session);
      const activePlan = profile.subscriptionPlan ?? planId;
      await bot.sendMessage(
        session.chatId,
        t(language, "subscription.payment_confirmed", { plan: subscriptionPlanLabel(language, activePlan) })
      );
      await sendMainMenu(session);
    } catch (error) {
      logger.error("Subscription confirmation error %o", error);
      await bot.sendMessage(session.chatId, t(language, "subscription.payment_failed"));
    }
  }
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
      formState: undefined,
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

  if (filing.formState && filing.formState.field !== step.field) {
    filing.formState = undefined;
    session.filing = filing;
    sessionStore.update(session.chatId, session);
  }

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
  let message = `${progress}\n\n${t(language, step.promptKey)}`;
  const hintKey = getUploadHintKey(step.field);
  if (hintKey) {
    message += `\n\n${t(language, hintKey)}`;
  }
  await bot.sendMessage(session.chatId, message, {
    reply_markup: { inline_keyboard: buttons },
  });

  const formConfigs = getFormConfigsForField(step.field);
  if (formConfigs.length === 0) {
    return;
  }

  if (!filing.formState) {
    const formButtons: InlineKeyboardButton[][] = formConfigs.map((config) => [
      {
        text: t(language, config.labelKey),
        callback_data: `${callbackPrefixes.filingForm}:SELECT:${config.id}`,
      },
    ]);
    await bot.sendMessage(session.chatId, t(language, "filing.select_form"), {
      reply_markup: { inline_keyboard: formButtons },
    });
    return;
  }

  if (filing.formState.awaitingUpload) {
    const currentConfig = getFormConfigById(filing.formState.formId);
    if (currentConfig) {
      await bot.sendMessage(
        session.chatId,
        t(language, "filing.upload_prompt", { form: t(language, currentConfig.labelKey) })
      );
    }
    return;
  }

  if (filing.formState.pendingKeys.length > 0) {
    const nextKey = filing.formState.pendingKeys[0];
    const requirement = filing.formState.requiredFields.find((item) => item.key === nextKey);
    if (requirement) {
      await bot.sendMessage(
        session.chatId,
        t(language, "filing.form_missing_prompt", { field: t(language, requirement.labelKey) })
      );
    }
  }
}

function getUploadHintKey(field: keyof FilingData): string | null {
  if (field === "w2Income") return "filing.upload_hint_w2";
  if (field === "form1099Income") return "filing.upload_hint_1099";
  if (field === "scheduleCDetails") return "filing.upload_hint_schedule_c";
  return null;
}

async function handleDocumentUpload(session: SessionData, message: Message) {
  if (!session.jwt) {
    await beginRegistration(session, "registration.required_for_filing");
    return;
  }
  const filing = session.filing;
  if (!filing) return;
  const step = filingSteps[filing.stepIndex];
  if (!step) {
    await bot.sendMessage(session.chatId, t(session.language, "filing.ocr_not_supported"));
    return;
  }

  const richMessage = message as RichMessage;
  const formState = filing.formState;
  if (!formState) {
    await bot.sendMessage(session.chatId, t(session.language, "filing.form_select_before_upload"));
    return;
  }

  if (!formState.awaitingUpload) {
    await bot.sendMessage(session.chatId, t(session.language, "filing.form_upload_not_expected"));
    return;
  }

  const formConfig = getFormConfigById(formState.formId);
  if (!formConfig) {
    await bot.sendMessage(session.chatId, t(session.language, "filing.ocr_not_supported"));
    return;
  }

  const metadata = richMessage.caption ?? richMessage.document?.file_name ?? null;
  const refinedDocumentType = refineDocumentType(formState.ocrType, metadata) ?? formState.ocrType;
  const attachment: FileAttachment | undefined =
    richMessage.document ?? (richMessage.photo && richMessage.photo.length > 0
      ? richMessage.photo[richMessage.photo.length - 1]
      : undefined);
  if (!attachment) {
    await bot.sendMessage(session.chatId, t(session.language, "filing.ocr_failed"));
    return;
  }

  try {
    const downloaded = await downloadTelegramFile(attachment.file_id);
    const buffer = downloaded.buffer;
    const remoteName = downloaded.filePath ? downloaded.filePath.split("/").pop() : undefined;
    const detectedMime = downloaded.mimeType;
    const sourceName =
      (isDocumentAttachment(attachment) && attachment.file_name) ||
      (metadata ? metadata.replace(/[^a-z0-9_.-]/gi, "_") : undefined) ||
      (remoteName ? remoteName.replace(/[^a-z0-9_.-]/gi, "_") : undefined) ||
      `${formConfig.id}-${Date.now()}`;
    const baseName = sourceName.replace(/[^a-z0-9_.-]/gi, "_");
    const extensionGuess =
      (baseName.includes(".") ? baseName.split(".").pop() : undefined) ||
      (remoteName && remoteName.includes(".") ? remoteName.split(".").pop() : undefined) ||
      (isDocumentAttachment(attachment) && attachment.mime_type?.split("/").pop()) ||
      (detectedMime?.split("/").pop()) ||
      (richMessage.photo && richMessage.photo.length > 0 ? "jpg" : "bin");
    const filename = baseName.includes(".") ? baseName : `${baseName}.${extensionGuess ?? "bin"}`;
    const mimeType =
      (isDocumentAttachment(attachment) && attachment.mime_type) ||
      detectedMime ||
      (richMessage.photo && richMessage.photo.length > 0 ? "image/jpeg" : "application/octet-stream");

    await bot.sendMessage(session.chatId, t(session.language, "filing.ocr_processing"));

    const client = createApiClient(session.jwt);
    const upload = await client.uploadDocument(buffer, filename, mimeType);
    const processed = await client.processOcr(upload.documentId, refinedDocumentType);

    const updatedCollected = { ...formState.collected };
    const pendingKeys: string[] = [];
    for (const requirement of formConfig.requiredFields) {
      const rawValue = processed.fields[requirement.key];
      if (rawValue !== undefined && rawValue !== null && rawValue !== "") {
        updatedCollected[requirement.key] = formatFormFieldValue(session.language, requirement, rawValue);
      }
      if (!updatedCollected[requirement.key]) {
        pendingKeys.push(requirement.key);
      }
    }

    filing.formState = {
      ...formState,
      awaitingUpload: false,
      pendingKeys,
      collected: updatedCollected,
    };
    session.filing = filing;
    sessionStore.update(session.chatId, session);

    const capturedLines = formConfig.requiredFields
      .map((requirement) => {
        const value = updatedCollected[requirement.key];
        if (!value) return null;
        return `• ${t(session.language, requirement.labelKey)}: ${value}`;
      })
      .filter((line): line is string => Boolean(line));

    let successMessage = `${t(session.language, "filing.ocr_success")}\n\n`;
    if (capturedLines.length > 0) {
      successMessage += `${t(session.language, "filing.ocr_success_header")}\n${capturedLines.join("\n")}`;
    } else {
      successMessage += t(session.language, "filing.ocr_no_fields");
    }

    if (pendingKeys.length > 0) {
      const missingLabels = pendingKeys
        .map((key) => formConfig.requiredFields.find((item) => item.key === key))
        .filter((item): item is FilingFormFieldRequirement => Boolean(item))
        .map((item) => t(session.language, item.labelKey));
      successMessage += `\n\n${t(session.language, "filing.form_missing_list", { fields: missingLabels.join(", ") })}`;
    } else {
      successMessage += `\n\n${t(session.language, "filing.form_all_captured")}`;
    }

    await bot.sendMessage(session.chatId, successMessage);

    if (pendingKeys.length > 0) {
      const nextRequirement = formConfig.requiredFields.find((item) => item.key === pendingKeys[0]);
      if (nextRequirement) {
        await bot.sendMessage(
          session.chatId,
          t(session.language, "filing.form_missing_prompt", { field: t(session.language, nextRequirement.labelKey) })
        );
      }
    } else {
      await finalizeFormCapture(session);
    }
  } catch (error) {
    logger.error("Document OCR error %o", error);
    await bot.sendMessage(session.chatId, t(session.language, "filing.ocr_failed"));
  }
}

async function finalizeFormCapture(session: SessionData) {
  const filing = session.filing;
  if (!filing || !filing.formState) return;
  if (!session.jwt) {
    await beginRegistration(session, "registration.required_for_filing");
    return;
  }

  const formState = filing.formState;
  const formConfig = getFormConfigById(formState.formId);
  if (!formConfig) return;

  const language = session.language;
  const summaryLines = buildFormSummary(language, formConfig, formState.collected);
  const storedValue = summaryLines.join("; ");

  const client = createApiClient(session.jwt);
  try {
    await client.saveFilingStep(filing.filingId!, filing.stepIndex, {
      [formConfig.field]: storedValue,
    } as Partial<FilingData>);
  } catch (error) {
    logger.error("Filing form save error %o", error);
    await bot.sendMessage(session.chatId, t(language, "error.generic"));
    return;
  }

  filing.data[formConfig.field] = storedValue;
  filing.stepIndex += 1;
  filing.formState = undefined;
  session.filing = filing;
  sessionStore.update(session.chatId, session);

  await bot.sendMessage(session.chatId, t(language, "filing.form_complete", { form: t(language, formConfig.labelKey) }));
  await promptFilingStep(session);
}

async function handleFilingResponse(session: SessionData, message: Message) {
  const filing = session.filing;
  if (!filing || !message.text) return;
  const formState = filing.formState;
  const language = session.language;
  const text = message.text.trim();
  if (!text) {
    await bot.sendMessage(session.chatId, t(language, "error.generic"));
    return;
  }

  if (formState && formState.pendingKeys.length > 0) {
    const currentKey = formState.pendingKeys[0];
    const requirement = formState.requiredFields.find((item) => item.key === currentKey);
    if (!requirement) {
      formState.pendingKeys = formState.pendingKeys.slice(1);
      filing.formState = formState;
      session.filing = filing;
      sessionStore.update(session.chatId, session);
      if (formState.pendingKeys.length === 0) {
        await finalizeFormCapture(session);
      }
      return;
    }

    formState.collected[currentKey] = formatFormFieldValue(language, requirement, text);
    formState.pendingKeys = formState.pendingKeys.slice(1);
    filing.formState = formState;
    session.filing = filing;
    sessionStore.update(session.chatId, session);

    await bot.sendMessage(session.chatId, t(language, "filing.saved"));

    if (formState.pendingKeys.length > 0) {
      const nextKey = formState.pendingKeys[0];
      const nextRequirement = formState.requiredFields.find((item) => item.key === nextKey);
      if (nextRequirement) {
        await bot.sendMessage(
          session.chatId,
          t(language, "filing.form_missing_prompt", { field: t(language, nextRequirement.labelKey) })
        );
      }
    } else {
      await finalizeFormCapture(session);
    }
    return;
  }

  const step = filingSteps[filing.stepIndex];
  if (!step) return;
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
    try {
      await bot.sendMessage(session.chatId, t(session.language, "pdf.preparing"));
      const pdf = await client.generateTaxPdf(filing.filingId!);
      const pdfBuffer = Buffer.from(await pdf.arrayBuffer());
      await bot.sendDocument(session.chatId, {
        value: pdfBuffer,
        filename: "form-1040-draft.pdf",
        contentType: "application/pdf",
      });
      await bot.sendMessage(session.chatId, t(session.language, "pdf.ready"));
    } catch (pdfError) {
      logger.warn("Unable to generate filing PDF %o", pdfError);
      await bot.sendMessage(session.chatId, t(session.language, "pdf.unavailable"));
    }
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
    let response: AiResponse | null = null;
    if (config.aiApiKey) {
      try {
        response = await queryAiAssistant(message.text, language);
      } catch (directError) {
        if (directError instanceof AiProviderError) {
          logger.warn("Direct AI provider unavailable %o", directError);
        } else {
          logger.warn("Unexpected AI provider error %o", directError);
        }
      }
    }

    if (!response) {
      const client = createApiClient(session.jwt);
      response = await client.askAi(message.text, language);
    }

    if (!response) {
      throw new Error("AI response missing");
    }

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
  session.estimate = undefined;
  session.subscription = undefined;
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
        if (session.registration) {
          session.registration.data.language = language;
        }
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
        }
        await bot.sendMessage(
          session.chatId,
          t(language, "language.updated", { language: languageLabel(language) })
        );
        await sendDisclaimer(session);
        await sendMainMenu(session);
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
      case callbackPrefixes.menu: {
        const action = parts[0];
        switch (action) {
          case "ASK_TAX_QUESTION":
            session.mode = "ai";
            sessionStore.update(session.chatId, session);
            await bot.sendMessage(session.chatId, t(session.language, "ai.prompt"));
            break;
          case "ESTIMATE_REFUND":
            await startEstimateFlow(session);
            break;
          case "FILE_TAXES":
            await handleFileTaxes(session);
            break;
          case "MY_DOCUMENTS":
            if (await ensureAuthenticatedForDocuments(session)) {
              await listTaxForms(session);
            }
            break;
          case "SUBSCRIPTION_PLANS":
            await showSubscriptionPlans(session);
            break;
          case "MAIN":
            resetToMainMenu(session);
            await sendMainMenu(session);
            break;
          default:
            await sendMainMenu(session);
        }
        break;
      }
      case callbackPrefixes.estimate: {
        const action = parts[0];
        if (action === "STATUS") {
          const status = parts[1];
          session.estimate = session.estimate ?? { step: "status" };
          session.estimate.status = status;
          session.estimate.step = "dependents";
          sessionStore.update(session.chatId, session);
          await promptEstimateStep(session);
        } else if (action === "RESTART") {
          await startEstimateFlow(session);
        }
        break;
      }
      case callbackPrefixes.estimatePdf: {
        await sendEstimatePdf(session);
        break;
      }
      case callbackPrefixes.filing: {
        if (!session.filing) break;
        const action = parts[0];
        if (action === "BACK") {
          if (session.filing.stepIndex > 0) {
            session.filing.formState = undefined;
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
            session.filing.formState = undefined;
            sessionStore.update(session.chatId, session);
            await promptFilingStep(session);
          }
        } else if (action === "EDIT") {
          const field = parts[1] as keyof FilingData;
          const index = filingSteps.findIndex((step) => step.field === field);
          if (index >= 0) {
            session.filing.stepIndex = index;
            if (session.filing.formState) {
              session.filing.formState = undefined;
            }
            sessionStore.update(session.chatId, session);
            await promptFilingStep(session);
          }
        } else if (action === "SUBMIT") {
          await submitFiling(session);
        }
        break;
      }
      case callbackPrefixes.filingForm: {
        if (!session.filing) break;
        const action = parts[0];
        if (action === "SELECT") {
          const formId = parts[1] as FilingFormId;
          const config = getFormConfigById(formId);
          const step = filingSteps[session.filing.stepIndex];
          if (!config || !step || config.field !== step.field) {
            await bot.sendMessage(session.chatId, t(session.language, "filing.ocr_not_supported"));
            break;
          }
          session.filing.formState = {
            field: config.field,
            formId: config.id,
            ocrType: config.ocrType,
            requiredFields: config.requiredFields,
            collected: {},
            pendingKeys: config.requiredFields.map((item) => item.key),
            awaitingUpload: true,
          };
          sessionStore.update(session.chatId, session);
          await bot.sendMessage(
            session.chatId,
            t(session.language, "filing.upload_prompt", { form: t(session.language, config.labelKey) })
          );
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
        await handleSubscriptionAction(session, parts);
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

  const richMessage = message as RichMessage;
  const hasAttachment = Boolean(richMessage.document || (richMessage.photo && richMessage.photo.length > 0));
  if (hasAttachment && session.mode === "filing") {
    await handleDocumentUpload(session, message);
    return;
  }

  if (!message.text) return;

  switch (session.mode) {
    case "registration":
      await handleRegistrationResponse(session, message);
      break;
    case "login":
      await handleLoginResponse(session, message);
      break;
    case "filing":
      await handleFilingResponse(session, message);
      break;
    case "ai":
      await handleAiQuestion(session, message);
      break;
    case "profile":
      await handleProfileEditInput(session, message);
      break;
    case "reminder":
      await handleReminderInput(session, message);
      break;
    case "estimate":
      await handleEstimateInput(session, message);
      break;
    default:
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
