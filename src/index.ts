import TelegramBot, {
  CallbackQuery,
  InlineKeyboardButton,
  Message,
  ReplyKeyboardMarkup,
  SendMessageOptions,
} from "node-telegram-bot-api";
import { createServer } from "http";
import { config } from "./config";
import logger from "./logger";
import { LANGUAGES, languageLabel, t } from "./i18n";
import { sessionStore } from "./session";
import {
  FilingData,
  LanguageCode,
  RegistrationPayload,
  SessionData,
  SessionRegistrationState,
  UserProfile,
} from "./types";
import { isValidDate, isValidEmail, isValidPhone, isValidStateRegion, normalizePhone } from "./utils/validators";
import {
  FILING_STATUSES,
  INCOME_TYPES,
  REMINDER_TYPES,
  describeFilingStatus,
  describeIncomeType,
  describeReminderType,
  formatOptionLabel,
  formatStatus,
  type OptionDefinition,
} from "./constants";
import { ApiError, createApiClient, isNetworkError } from "./services/apiClient";
import { COUNTRIES, STATES } from "./data/locations";
import { buildKeyboard, NAV_BACK, NAV_CANCEL, NAV_NEXT, NAV_PREV, paginate } from "./utils/keyboard";
import { enqueueProfilePatch, startProfileSync } from "./utils/sync";

const DEFAULT_LANGUAGE: LanguageCode = "en";

const SHARE_PHONE_KEYBOARD: ReplyKeyboardMarkup = {
  keyboard: [[{ text: "📞 Share Phone Number", request_contact: true }]],
  one_time_keyboard: true,
  resize_keyboard: true,
};

type RegistrationField = Exclude<keyof RegistrationPayload, "language" | "telegramId">;

type RegistrationStep = {
  field: RegistrationField;
  promptKey: string;
  type: "text" | "email" | "date" | "select" | "optional" | "phone" | "country" | "state";
  options?: OptionDefinition[];
};

type MessageWithMarkup = Message & {
  reply_markup?: { inline_keyboard?: InlineKeyboardButton[][] };
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

const registrationSteps: RegistrationStep[] = [
  { field: "phone", promptKey: "registration.ask_phone", type: "phone" },
  { field: "fullName", promptKey: "registration.ask_full_name", type: "text" },
  { field: "email", promptKey: "registration.ask_email", type: "email" },
  { field: "dob", promptKey: "registration.ask_dob", type: "date" },
  { field: "country", promptKey: "registration.ask_country", type: "country" },
  { field: "stateRegion", promptKey: "registration.ask_state_region_list", type: "state" },
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
];

const COUNTRY_PAGE_SIZE = 8;
const STATE_PAGE_SIZE = 8;

function findRegistrationStepIndex(field: RegistrationField): number {
  return registrationSteps.findIndex((step) => step.field === field);
}

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

const callbackPrefixes = {
  language: "LANG",
  registration: "REG",
  menu: "MENU",
  filing: "FILING",
  pdf: "PDF",
  profile: "PROFILE",
  reminder: "REMINDER",
};

let bot: TelegramBot;

async function ensureApiReachable() {
  const baseUrl = config.apiBaseUrl?.trim();
  if (!baseUrl) {
    logger.info("Starting in offline mode; skipping API health check");
    return;
  }

  const client = createApiClient();
  try {
    const result = await client.healthCheck();
    if (result.ok) {
      logger.info("API health check succeeded for %s", baseUrl);
    } else {
      logger.warn("API health check failed for %s: %s", baseUrl, result.reason);
    }
  } catch (error) {
    logger.error("Unexpected error during API health check: %o", error);
  }
}

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

function inlineKeyboardsEqual(
  a?: InlineKeyboardButton[][],
  b?: InlineKeyboardButton[][],
): boolean {
  if (!a || !b) {
    return false;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let rowIndex = 0; rowIndex < a.length; rowIndex += 1) {
    const rowA = a[rowIndex];
    const rowB = b[rowIndex];
    if (!rowB || rowA.length !== rowB.length) {
      return false;
    }
    for (let colIndex = 0; colIndex < rowA.length; colIndex += 1) {
      const buttonA = rowA[colIndex];
      const buttonB = rowB[colIndex];
      if (!buttonB) {
        return false;
      }
      if (buttonA.text !== buttonB.text) {
        return false;
      }
      if (buttonA.callback_data !== buttonB.callback_data) {
        return false;
      }
      if (buttonA.url !== buttonB.url) {
        return false;
      }
    }
  }
  return true;
}

function ensureUiState(session: SessionData) {
  if (!session.ui) {
    session.ui = {};
  }
  return session.ui;
}

function clampPage(page: number | undefined, totalPages: number): number {
  if (totalPages <= 1) return 0;
  const next = typeof page === "number" ? page : 0;
  return Math.min(Math.max(next, 0), totalPages - 1);
}

export function buildLanguageKeyboard(selectedCode?: string): InlineKeyboardButton[][] {
  const rows: InlineKeyboardButton[][] = [];
  LANGUAGES.forEach((lang) => {
    const isSelected = selectedCode === lang.code;
    const button: InlineKeyboardButton = {
      text: isSelected ? `${lang.label} ✅` : lang.label,
      callback_data: `${callbackPrefixes.language}:${lang.code}`,
    };
    const lastRow = rows[rows.length - 1];
    if (!lastRow || lastRow.length === 2) {
      rows.push([button]);
    } else {
      lastRow.push(button);
    }
  });
  return rows;
}

async function showLanguagePicker(
  chatId: number,
  selectedCode?: string,
  messageId?: number,
  currentMarkup?: InlineKeyboardButton[][],
) {
  const session = sessionStore.get(chatId);
  const language = getLanguage(session);
  const inline_keyboard = buildLanguageKeyboard(selectedCode ?? session?.language);
  if (messageId) {
    if (inlineKeyboardsEqual(currentMarkup, inline_keyboard)) {
      return;
    }
    await bot.editMessageReplyMarkup({
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard },
    });
    return;
  }
  await bot.sendMessage(chatId, t(language, "language.menu_title"), {
    reply_markup: { inline_keyboard },
  });
}

async function sendMainMenu(session: SessionData) {
  const language = getLanguage(session);
  const inline_keyboard = [
    [
      { text: t(language, "menu.start_filing"), callback_data: `${callbackPrefixes.menu}:START_FILING` },
      { text: t(language, "menu.view_forms"), callback_data: `${callbackPrefixes.menu}:VIEW_FORMS` },
    ],
    [
      { text: t(language, "menu.download_pdf"), callback_data: `${callbackPrefixes.menu}:DOWNLOAD_PDF` },
      { text: t(language, "menu.make_payment"), callback_data: `${callbackPrefixes.menu}:MAKE_PAYMENT` },
    ],
    [
      { text: t(language, "menu.ask_ai"), callback_data: `${callbackPrefixes.menu}:ASK_AI` },
      { text: t(language, "menu.change_language"), callback_data: `${callbackPrefixes.menu}:CHANGE_LANGUAGE` },
    ],
    [
      { text: t(language, "menu.profile"), callback_data: `${callbackPrefixes.menu}:PROFILE` },
      { text: t(language, "menu.reminders"), callback_data: `${callbackPrefixes.menu}:REMINDERS` },
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

  if (!session.jwt) {
    try {
      const client = createApiClient();
      const existing = await client.getProfileByTelegramId(session.telegramId);
      if (existing) {
        session.language = existing.user.language;
        session.mode = "login";
        session.login = { stepIndex: 0 };
        sessionStore.update(session.chatId, session);
        await bot.sendMessage(
          session.chatId,
          t(session.language, "registration.success_returning", { name: existing.user.fullName }),
        );
        await bot.sendMessage(session.chatId, t(session.language, "auth.login_required"));
        await promptLoginStep(session);
        return;
      }
    } catch (error) {
      if (isNetworkError(error)) {
        logger.warn("Unable to reach API for telegram lookup: %o", error);
      } else if (error instanceof ApiError && error.status !== 404) {
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
    phoneVerified: false,
  };
  sessionStore.update(session.chatId, session);
  await showLanguagePicker(session.chatId, language);
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

  if (step.type === "country") {
    const ui = ensureUiState(session);
    const totalPages = Math.max(1, Math.ceil(COUNTRIES.length / COUNTRY_PAGE_SIZE));
    ui.countryPage = clampPage(ui.countryPage, totalPages);
    sessionStore.update(session.chatId, { ui: { ...ui } });
    const { pageItems } = paginate(COUNTRIES, ui.countryPage, COUNTRY_PAGE_SIZE);
    const keyboard = buildKeyboard(pageItems, ui.countryPage, totalPages, "country");
    await bot.sendMessage(session.chatId, t(language, step.promptKey), {
      reply_markup: keyboard,
    });
    return;
  }

  if (step.type === "state") {
    const country = registration.data.country;
    if (!country) {
      const countryIndex = findRegistrationStepIndex("country");
      if (countryIndex !== -1) {
        registration.stepIndex = countryIndex;
        session.registration = registration;
        sessionStore.update(session.chatId, { registration });
        await promptRegistrationStep(session);
      }
      return;
    }
    const list = STATES[country];
    if (Array.isArray(list) && list.length > 0) {
      const ui = ensureUiState(session);
      const totalPages = Math.max(1, Math.ceil(list.length / STATE_PAGE_SIZE));
      ui.statePage = clampPage(ui.statePage, totalPages);
      sessionStore.update(session.chatId, { ui: { ...ui } });
      const { pageItems } = paginate(list, ui.statePage, STATE_PAGE_SIZE);
      const keyboard = buildKeyboard(pageItems, ui.statePage, totalPages, "state");
      await bot.sendMessage(
        session.chatId,
        t(language, "registration.ask_state_region_list", { country }),
        { reply_markup: keyboard },
      );
      return;
    }
    registration.stateRetryCount = 0;
    session.registration = registration;
    sessionStore.update(session.chatId, { registration });
    const manualKeyboard: ReplyKeyboardMarkup = {
      keyboard: [[{ text: NAV_BACK }, { text: NAV_CANCEL }]],
      resize_keyboard: true,
      one_time_keyboard: false,
      selective: true,
    };
    await bot.sendMessage(
      session.chatId,
      t(language, "registration.ask_state_region_free", { country }),
      { reply_markup: manualKeyboard },
    );
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

  let replyMarkup: SendMessageOptions["reply_markup"] | undefined;

  if (step.type === "optional") {
    replyMarkup = {
      inline_keyboard: [
        [
          {
            text: t(language, "registration.optional_skip"),
            callback_data: `${callbackPrefixes.registration}:SKIP:${step.field}`,
          },
        ],
      ],
    };
  } else if (step.type === "phone") {
    replyMarkup = SHARE_PHONE_KEYBOARD;
  }

  await bot.sendMessage(session.chatId, t(language, step.promptKey), {
    reply_markup: replyMarkup ?? { remove_keyboard: true },
  });
}

async function cancelRegistrationFlow(session: SessionData) {
  const language = getLanguage(session);
  session.mode = "idle";
  session.registration = undefined;
  session.ui = {};
  sessionStore.update(session.chatId, {
    mode: session.mode,
    registration: session.registration,
    ui: session.ui,
  });
  await bot.sendMessage(session.chatId, t(language, "registration.cancelled"), {
    reply_markup: { remove_keyboard: true },
  });
  await sendMainMenu(session);
}

async function persistLocationSelection(
  session: SessionData,
  country: string,
  stateRegion: string,
): Promise<"online" | "queued"> {
  let status: "online" | "queued" = "queued";
  if (session.jwt && config.apiBaseUrl?.trim()) {
    try {
      const client = createApiClient(session.jwt);
      const profile = await client.updateProfile({ country, stateRegion });
      session.profile = profile;
      sessionStore.update(session.chatId, { profile });
      status = "online";
    } catch (error) {
      if (isNetworkError(error)) {
        logger.warn("Deferred profile update for chatId=%d due to network error", session.chatId);
      } else {
        logger.error("Profile update error chatId=%d %o", session.chatId, error);
      }
    }
  }

  if (status === "queued") {
    enqueueProfilePatch(session.chatId, { country, stateRegion });
    if (session.profile) {
      session.profile.country = country;
      session.profile.stateRegion = stateRegion;
      sessionStore.update(session.chatId, { profile: session.profile });
    }
  }

  return status;
}

async function handleCountryInput(
  session: SessionData,
  registration: SessionRegistrationState,
  rawText: string,
): Promise<void> {
  const language = getLanguage(session);
  const text = rawText.trim();
  if (!text) {
    await bot.sendMessage(session.chatId, t(language, "registration.country_invalid"));
    return;
  }

  if (text === NAV_CANCEL) {
    await cancelRegistrationFlow(session);
    return;
  }

  if (text === NAV_BACK) {
    registration.stepIndex = Math.max(0, registration.stepIndex - 1);
    session.registration = registration;
    sessionStore.update(session.chatId, { registration });
    await promptRegistrationStep(session);
    return;
  }

  const totalPages = Math.max(1, Math.ceil(COUNTRIES.length / COUNTRY_PAGE_SIZE));
  const ui = ensureUiState(session);

  if (text === NAV_PREV) {
    ui.countryPage = clampPage((ui.countryPage ?? 0) - 1, totalPages);
    sessionStore.update(session.chatId, { ui: { ...ui } });
    await promptRegistrationStep(session);
    return;
  }

  if (text === NAV_NEXT) {
    ui.countryPage = clampPage((ui.countryPage ?? 0) + 1, totalPages);
    sessionStore.update(session.chatId, { ui: { ...ui } });
    await promptRegistrationStep(session);
    return;
  }

  const match = COUNTRIES.find((country) => country.toLowerCase() === text.toLowerCase());
  if (!match) {
    await bot.sendMessage(session.chatId, t(language, "registration.country_invalid"));
    return;
  }

  registration.data.country = match;
  delete registration.data.stateRegion;
  registration.stateRetryCount = 0;
  registration.stepIndex += 1;
  const updatedUi = ensureUiState(session);
  updatedUi.statePage = 0;
  session.registration = registration;
  sessionStore.update(session.chatId, { registration, ui: { ...updatedUi } });
  logger.info("country=%s selected chatId=%d", match, session.chatId);
  await promptRegistrationStep(session);
}

async function handleStateInput(
  session: SessionData,
  registration: SessionRegistrationState,
  rawText: string,
): Promise<void> {
  const language = getLanguage(session);
  const text = rawText.trim();
  const country = registration.data.country;
  if (!country) {
    await promptRegistrationStep(session);
    return;
  }

  if (!text) {
    await bot.sendMessage(session.chatId, t(language, "registration.state_retry"));
    return;
  }

  if (text === NAV_CANCEL) {
    await cancelRegistrationFlow(session);
    return;
  }

  if (text === NAV_BACK) {
    const countryIndex = findRegistrationStepIndex("country");
    if (countryIndex !== -1) {
      registration.stepIndex = countryIndex;
      session.registration = registration;
      sessionStore.update(session.chatId, { registration });
      await promptRegistrationStep(session);
    }
    return;
  }

  const list = STATES[country];
  if (Array.isArray(list) && list.length > 0) {
    const totalPages = Math.max(1, Math.ceil(list.length / STATE_PAGE_SIZE));
    const ui = ensureUiState(session);
    if (text === NAV_PREV) {
      ui.statePage = clampPage((ui.statePage ?? 0) - 1, totalPages);
      sessionStore.update(session.chatId, { ui: { ...ui } });
      await promptRegistrationStep(session);
      return;
    }
    if (text === NAV_NEXT) {
      ui.statePage = clampPage((ui.statePage ?? 0) + 1, totalPages);
      sessionStore.update(session.chatId, { ui: { ...ui } });
      await promptRegistrationStep(session);
      return;
    }
    const match = list.find((item) => item.toLowerCase() === text.toLowerCase());
    if (!match) {
      await bot.sendMessage(session.chatId, t(language, "registration.state_invalid_choice"));
      return;
    }
    registration.data.stateRegion = match;
    registration.stateRetryCount = 0;
    registration.stepIndex += 1;
    session.registration = registration;
    sessionStore.update(session.chatId, { registration });
    const status = await persistLocationSelection(session, country, match);
    logger.info("stateRegion=%s selected status=%s chatId=%d", match, status, session.chatId);
    const messageKey =
      status === "online" ? "registration.state_saved_online" : "registration.state_saved_offline";
    await bot.sendMessage(session.chatId, t(language, messageKey, { country, state: match }), {
      reply_markup: { remove_keyboard: true },
    });
    await promptRegistrationStep(session);
    return;
  }

  if (!isValidStateRegion(text)) {
    registration.stateRetryCount = (registration.stateRetryCount ?? 0) + 1;
    session.registration = registration;
    sessionStore.update(session.chatId, { registration });
    await bot.sendMessage(session.chatId, t(language, "registration.state_retry"));
    return;
  }

  registration.data.stateRegion = text;
  registration.stateRetryCount = 0;
  registration.stepIndex += 1;
  session.registration = registration;
  sessionStore.update(session.chatId, { registration });
  const status = await persistLocationSelection(session, country, text);
  logger.info("stateRegion=%s selected status=%s chatId=%d", text, status, session.chatId);
  const messageKey =
    status === "online" ? "registration.state_saved_online" : "registration.state_saved_offline";
  await bot.sendMessage(session.chatId, t(language, messageKey, { country, state: text }), {
    reply_markup: { remove_keyboard: true },
  });
  await promptRegistrationStep(session);
}

async function finalizeRegistration(session: SessionData) {
  const registration = session.registration;
  if (!registration) return;
  const language = getLanguage(session);
  const payload = registration.data as RegistrationPayload;
  const phone = registration.data.phone as string | undefined;
  if (!phone || !registration.phoneVerified) {
    const phoneIndex = findRegistrationStepIndex("phone");
    if (phoneIndex !== -1) {
      registration.stepIndex = phoneIndex;
      session.registration = registration;
      sessionStore.update(session.chatId, session);
      await bot.sendMessage(session.chatId, t(language, "registration.phone_required"), {
        reply_markup: SHARE_PHONE_KEYBOARD,
      });
      await promptRegistrationStep(session);
      return;
    }
  }
  payload.language = session.language;
  payload.telegramId = session.telegramId;
  if (phone) {
    payload.phone = phone;
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
    if (isNetworkError(error)) {
      registration.stepIndex = Math.max(0, registrationSteps.length - 1);
      session.registration = registration;
      sessionStore.update(session.chatId, session);
      await bot.sendMessage(session.chatId, t(language, "error.network"));
      await promptRegistrationStep(session);
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
    if (isNetworkError(error)) {
      login.stepIndex = Math.max(0, loginSteps.length - 1);
      session.login = login;
      sessionStore.update(session.chatId, session);
      await bot.sendMessage(session.chatId, t(language, "error.network"));
      await promptLoginStep(session);
      return;
    }
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

  if (step.type === "phone") {
    if (!text) {
      await bot.sendMessage(session.chatId, t(language, "registration.invalid_phone"), {
        reply_markup: SHARE_PHONE_KEYBOARD,
      });
      return;
    }
    const normalized = normalizePhone(text);
    if (!isValidPhone(normalized)) {
      await bot.sendMessage(session.chatId, t(language, "registration.invalid_phone"), {
        reply_markup: SHARE_PHONE_KEYBOARD,
      });
      return;
    }
    registration.data.phone = normalized;
    registration.phoneVerified = true;
    registration.stepIndex += 1;
    session.registration = registration;
    sessionStore.update(session.chatId, session);
    await bot.sendMessage(session.chatId, t(language, "registration.phone_saved"), {
      reply_markup: { remove_keyboard: true },
    });
    await promptRegistrationStep(session);
    return;
  }

  if (step.type === "country") {
    await handleCountryInput(session, registration, text);
    return;
  }

  if (step.type === "state") {
    await handleStateInput(session, registration, text);
    return;
  }

  switch (step.type) {
    case "text":
      if (!text) {
        await bot.sendMessage(session.chatId, t(language, "error.generic"));
        return;
      }
      registration.data[step.field as keyof RegistrationPayload] = text as never;
      break;
    case "email":
      if (!isValidEmail(text)) {
        await bot.sendMessage(session.chatId, t(language, "registration.invalid_email"));
        return;
      }
      registration.data[step.field as keyof RegistrationPayload] = text.toLowerCase() as never;
      break;
    case "date":
      if (!isValidDate(text)) {
        await bot.sendMessage(session.chatId, t(language, "registration.invalid_dob"));
        return;
      }
      registration.data[step.field as keyof RegistrationPayload] = text as never;
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
    if (isNetworkError(error)) {
      await bot.sendMessage(session.chatId, t(session.language, "error.network"));
      return;
    }
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
    if (isNetworkError(error)) {
      await bot.sendMessage(session.chatId, t(language, "error.network"));
      return;
    }
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
    if (isNetworkError(error)) {
      await bot.sendMessage(session.chatId, t(session.language, "error.network"));
      return;
    }
    logger.error("submitFiling error %o", error);
    await bot.sendMessage(session.chatId, t(session.language, "error.generic"));
  }
}

async function handleAiQuestion(session: SessionData, message: Message) {
  if (!message.text) return;
  const language = session.language;
  if (!session.jwt) {
    await bot.sendMessage(session.chatId, t(language, "auth.login_required"));
    session.mode = "idle";
    sessionStore.update(session.chatId, session);
    await sendMainMenu(session);
    return;
  }
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
    if (isNetworkError(error)) {
      await bot.sendMessage(session.chatId, t(language, "error.network"));
      return;
    }
    logger.error("AI question error %o", error);
    await bot.sendMessage(session.chatId, t(language, "ai.error"));
  }
}

function formatProfile(profile: UserProfile, language: LanguageCode): string {
  const lines = [t(language, "profile.title")];
  lines.push(`• ${t(language, "profile.field_fullName")}: ${profile.fullName}`);
  lines.push(`• Email: ${profile.email}`);
  if (profile.phone) lines.push(`• ${t(language, "profile.field_phone")}: ${profile.phone}`);
  const filingStatus = describeFilingStatus(language, profile.filingStatus);
  if (filingStatus) {
    lines.push(`• ${t(language, "profile.field_filingStatus")}: ${filingStatus}`);
  }
  const incomeType = describeIncomeType(language, profile.incomeType);
  if (incomeType) {
    lines.push(`• ${t(language, "profile.field_incomeType")}: ${incomeType}`);
  }
  if (profile.country) {
    lines.push(`• ${t(language, "profile.field_country")}: ${profile.country}`);
  }
  if (profile.stateRegion) {
    lines.push(`• ${t(language, "profile.field_state_region")}: ${profile.stateRegion}`);
  }
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
            {
              text: t(session.language, "profile.field_state_region"),
              callback_data: `${callbackPrefixes.profile}:EDIT:stateRegion`,
            },
            { text: t(session.language, "menu.cancel"), callback_data: `${callbackPrefixes.profile}:CANCEL` },
          ],
        ],
      },
    });
  } catch (error) {
    if (isNetworkError(error)) {
      await bot.sendMessage(session.chatId, t(session.language, "error.network"));
      return;
    }
    logger.error("showProfile error %o", error);
    await bot.sendMessage(session.chatId, t(session.language, "error.generic"));
  }
}

async function handleProfileEditInput(session: SessionData, message: Message) {
  if (!session.profileEditor || !message.text || !session.jwt) return;
  const { editField, inputType } = session.profileEditor;
  if (!editField) return;
  const language = session.language;
  const value = message.text.trim();
  if (!value) {
    await bot.sendMessage(session.chatId, t(language, "error.generic"));
    return;
  }

  if (editField === "filingStatus" || editField === "incomeType") {
    await bot.sendMessage(
      session.chatId,
      t(language, "profile.choose_option", { field: t(language, `profile.field_${editField}`) })
    );
    return;
  }

  let formattedValue: string | undefined = value;
  if (inputType === "phone") {
    const normalized = normalizePhone(value);
    if (!isValidPhone(normalized)) {
      await bot.sendMessage(session.chatId, t(language, "profile.invalid_phone"));
      return;
    }
    formattedValue = normalized;
  } else if (inputType === "stateRegion") {
    if (!isValidStateRegion(value)) {
      await bot.sendMessage(session.chatId, t(language, "profile.invalid_state_region"));
      return;
    }
    formattedValue = value;
  }

  const payload: Partial<UserProfile> = { [editField]: formattedValue } as Partial<UserProfile>;
  const client = createApiClient(session.jwt);
  try {
    const profile = await client.updateProfile(payload);
    session.profile = profile;
    session.profileEditor = undefined;
    session.mode = "profile";
    sessionStore.update(session.chatId, session);
    await bot.sendMessage(session.chatId, t(language, "profile.updated"));
    await showProfile(session);
  } catch (error) {
    if (isNetworkError(error)) {
      await bot.sendMessage(session.chatId, t(language, "error.network"));
      return;
    }
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
    if (isNetworkError(error)) {
      await bot.sendMessage(session.chatId, t(session.language, "error.network"));
      return;
    }
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
    if (isNetworkError(error)) {
      await bot.sendMessage(session.chatId, t(session.language, "error.network"));
      return;
    }
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
    if (isNetworkError(error)) {
      await bot.sendMessage(session.chatId, t(session.language, "error.network"));
      return;
    }
    logger.error("createPayment error %o", error);
    await bot.sendMessage(session.chatId, t(session.language, "payment.failed"));
  }
}

async function startReminderFlow(session: SessionData) {
  if (!session.jwt) {
    await bot.sendMessage(session.chatId, t(session.language, "auth.login_required"));
    session.mode = "idle";
    sessionStore.update(session.chatId, session);
    await sendMainMenu(session);
    return;
  }
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
    const reminderLabel = describeReminderType(session.language, reminderType) ?? reminderType;
    await client.scheduleReminder(reminderType, dueDate);
    session.mode = "idle";
    session.reminder = undefined;
    sessionStore.update(session.chatId, session);
    await bot.sendMessage(session.chatId, t(session.language, "reminder.saved"));
    try {
      const calendar = await client.createCalendarLink(dueDate, reminderLabel);
      const calendarLabel = t(session.language, "reminder.add_calendar");
      await bot.sendMessage(session.chatId, calendarLabel, {
        reply_markup: { inline_keyboard: [[{ text: calendarLabel, url: calendar.url }]] },
      });
    } catch (calendarError) {
      logger.warn("Calendar link error %o", calendarError);
    }
    await sendMainMenu(session);
  } catch (error) {
    if (isNetworkError(error)) {
      await bot.sendMessage(session.chatId, t(session.language, "error.network"));
      return;
    }
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
  sessionStore.update(session.chatId, session);
}

async function handleCallbackQuery(callback: CallbackQuery) {
  const data = callback.data;
  if (!data) return;
  const message = callback.message;
  if (!message) return;
  const messageId = message.message_id;
  const session = ensureSession(message);
  if (!session) return;
  const [prefix, ...parts] = data.split(":");
  try {
    switch (prefix) {
      case callbackPrefixes.language: {
        const language = parts[0] as LanguageCode;
        session.language = language;
        sessionStore.update(session.chatId, session);
        if (messageId) {
          const markup = (message as MessageWithMarkup).reply_markup?.inline_keyboard;
          await showLanguagePicker(session.chatId, language, messageId, markup);
        }
        if (session.jwt) {
          try {
            const client = createApiClient(session.jwt);
            const profile = await client.updateLanguage(language);
            session.profile = profile;
            sessionStore.update(session.chatId, session);
          } catch (error) {
            if (isNetworkError(error)) {
              await bot.sendMessage(session.chatId, t(language, "error.network"));
            }
            logger.warn("Language update API error %o", error);
          }
          await bot.sendMessage(session.chatId, t(language, "language.updated", { language: languageLabel(language) }));
          await sendMainMenu(session);
        } else {
          if (session.registration) {
            session.registration.data.language = language;
          }
          await bot.sendMessage(session.chatId, t(language, "registration.intro"));
          session.registration = session.registration ?? {
            stepIndex: 0,
            data: { telegramId: session.telegramId, language } as Partial<RegistrationPayload>,
            phoneVerified: false,
          };
          session.registration.stepIndex = 0;
          session.registration.phoneVerified = false;
          session.registration.data.language = language;
          delete (session.registration.data as Record<string, unknown>).phone;
          session.mode = "registration";
          sessionStore.update(session.chatId, session);
          await promptRegistrationStep(session);
        }
        break;
      }
      case callbackPrefixes.registration: {
        const action = parts[0];
        const registration = session.registration;
        if (!registration) break;
        const language = getLanguage(session);
        switch (action) {
          case "SKIP": {
            const field = parts[1] as RegistrationField;
            registration.data[field as keyof RegistrationPayload] = undefined as never;
            registration.stepIndex += 1;
            session.registration = registration;
            sessionStore.update(session.chatId, session);
            await promptRegistrationStep(session);
            break;
          }
          default: {
            const field = action as RegistrationField;
            const value = parts[1];
            registration.data[field as keyof RegistrationPayload] = value as never;
            registration.stepIndex += 1;
            session.registration = registration;
            sessionStore.update(session.chatId, session);
            await promptRegistrationStep(session);
          }
        }
        break;
      }
      case callbackPrefixes.menu: {
        const action = parts[0];
        switch (action) {
          case "START_FILING":
            await startFilingWizard(session);
            break;
          case "VIEW_FORMS":
            await listTaxForms(session);
            break;
          case "DOWNLOAD_PDF":
            await listTaxForms(session);
            break;
          case "MAKE_PAYMENT":
            await createPayment(session);
            break;
          case "ASK_AI":
            session.mode = "ai";
            sessionStore.update(session.chatId, session);
            await bot.sendMessage(session.chatId, t(session.language, "ai.prompt"));
            break;
          case "CHANGE_LANGUAGE":
            await showLanguagePicker(session.chatId, session.language);
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
          if (field === "filingStatus" || field === "incomeType") {
            const options = field === "filingStatus" ? FILING_STATUSES : INCOME_TYPES;
            session.profileEditor = { editField: field };
            sessionStore.update(session.chatId, session);
            const inline_keyboard = options.map((option) => [
              {
                text: formatOptionLabel(session.language, option),
                callback_data: `${callbackPrefixes.profile}:SET:${field}:${option.value}`,
              },
            ]);
            inline_keyboard.push([
              { text: t(session.language, "menu.cancel"), callback_data: `${callbackPrefixes.profile}:CANCEL` },
            ]);
            await bot.sendMessage(
              session.chatId,
              t(session.language, "profile.choose_option", { field: t(session.language, `profile.field_${field}`) }),
              { reply_markup: { inline_keyboard } }
            );
          } else {
            session.profileEditor = {
              editField: field,
              inputType: field === "phone" ? "phone" : field === "stateRegion" ? "stateRegion" : "text",
            };
            sessionStore.update(session.chatId, session);
            await bot.sendMessage(
              session.chatId,
              t(session.language, "profile.update_prompt", { field: t(session.language, `profile.field_${field}`) })
            );
          }
        } else if (action === "SET") {
          const field = parts[1] as keyof UserProfile;
          const value = parts[2];
          if (!session.jwt) break;
          const client = createApiClient(session.jwt);
          try {
            const profile = await client.updateProfile({ [field]: value } as Partial<UserProfile>);
            session.profile = profile;
            session.profileEditor = undefined;
            session.mode = "profile";
            sessionStore.update(session.chatId, session);
            await bot.sendMessage(session.chatId, t(session.language, "profile.updated"));
            await showProfile(session);
          } catch (error) {
            if (isNetworkError(error)) {
              await bot.sendMessage(session.chatId, t(session.language, "error.network"));
              break;
            }
            logger.error("Profile update error %o", error);
            await bot.sendMessage(session.chatId, t(session.language, "error.generic"));
          }
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
      default:
        break;
    }
  } finally {
    await bot.answerCallbackQuery(callback.id);
  }
}

async function handleMessage(message: Message) {
  if (!message.text || message.text.startsWith("/")) return;
  const session = ensureSession(message);
  if (!session) return;

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
    default:
      await sendMainMenu(session);
      break;
  }
}

async function setupBot() {
  await ensureApiReachable();
  startProfileSync();

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

  bot.on("contact", async (msg) => {
    const session = ensureSession(msg);
    if (!session) return;
    if (session.mode !== "registration") return;
    const registration = session.registration;
    if (!registration) return;
    const step = registrationSteps[registration.stepIndex];
    if (!step || step.type !== "phone") return;
    const raw = msg.contact?.phone_number;
    if (!raw) return;
    const phone = normalizePhone(raw);
    const language = getLanguage(session);
    if (!isValidPhone(phone)) {
      await bot.sendMessage(session.chatId, t(language, "registration.invalid_phone"), {
        reply_markup: SHARE_PHONE_KEYBOARD,
      });
      return;
    }
    registration.data.phone = phone;
    registration.phoneVerified = true;
    registration.stepIndex += 1;
    session.registration = registration;
    sessionStore.update(session.chatId, session);
    await bot.sendMessage(session.chatId, t(language, "registration.phone_saved"), {
      reply_markup: { remove_keyboard: true },
    });
    await promptRegistrationStep(session);
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
