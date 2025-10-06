import { LANGUAGES } from "../i18n";
import { LanguageCode } from "../types";

export function getLocale(language: LanguageCode): string {
  const match = LANGUAGES.find((lang) => lang.code === language);
  return match?.locale ?? "en-US";
}

export function formatCurrency(language: LanguageCode, value: number): string {
  return new Intl.NumberFormat(getLocale(language), {
    style: "currency",
    currency: "USD",
  }).format(value);
}
