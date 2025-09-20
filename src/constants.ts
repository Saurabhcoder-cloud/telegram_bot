import { t } from "./i18n";
import { LanguageCode } from "./types";

export type OptionDefinition = {
  value: string;
  labelKey: string;
};

export const FILING_STATUSES: OptionDefinition[] = [
  { value: "single", labelKey: "options.filing_status.single" },
  { value: "married_joint", labelKey: "options.filing_status.married_joint" },
  { value: "married_separate", labelKey: "options.filing_status.married_separate" },
  { value: "head_household", labelKey: "options.filing_status.head_household" },
  { value: "widow", labelKey: "options.filing_status.widow" },
];

export const INCOME_TYPES: OptionDefinition[] = [
  { value: "w2", labelKey: "options.income_type.w2" },
  { value: "1099", labelKey: "options.income_type.1099" },
  { value: "student", labelKey: "options.income_type.student" },
  { value: "retired", labelKey: "options.income_type.retired" },
  { value: "other", labelKey: "options.income_type.other" },
];

export const REMINDER_TYPES: OptionDefinition[] = [
  { value: "filing_deadline", labelKey: "options.reminder.filing_deadline" },
  { value: "state_deadline", labelKey: "options.reminder.state_deadline" },
  { value: "documents", labelKey: "options.reminder.documents" },
  { value: "payment_due", labelKey: "options.reminder.payment_due" },
];

export function formatOptionLabel(language: LanguageCode, option: OptionDefinition): string {
  const label = t(language, option.labelKey);
  return label === option.labelKey ? option.labelKey : label;
}

function findOption(options: OptionDefinition[], value?: string | null): OptionDefinition | undefined {
  if (!value) return undefined;
  return options.find((option) => option.value === value);
}

export function describeFilingStatus(language: LanguageCode, value?: string | null): string | undefined {
  const option = findOption(FILING_STATUSES, value);
  if (!option) return value ?? undefined;
  return formatOptionLabel(language, option);
}

export function describeIncomeType(language: LanguageCode, value?: string | null): string | undefined {
  const option = findOption(INCOME_TYPES, value);
  if (!option) return value ?? undefined;
  return formatOptionLabel(language, option);
}

export function describeReminderType(language: LanguageCode, value?: string | null): string | undefined {
  const option = findOption(REMINDER_TYPES, value);
  if (!option) return value ?? undefined;
  return formatOptionLabel(language, option);
}

export function formatStatus(language: LanguageCode, status: string): string {
  const key = status.toLowerCase();
  const translated = t(language, `status.${key}`);
  if (translated && translated !== `status.${key}`) {
    return translated;
  }
  const fallback = t("en", `status.${key}`);
  return fallback === `status.${key}` ? status : fallback;
}
