import { config } from "../config";
import logger from "../logger";
import { languageLabel } from "../i18n";
import { AiResponse, LanguageCode } from "../types";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const CHAT_COMPLETIONS_PATH = "/chat/completions";

export class AiProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiProviderError";
  }
}

function buildSystemPrompt(language: LanguageCode): string {
  const languageName = languageLabel(language);
  return [
    "You are TaxHelp AI, a multilingual U.S. tax specialist.",
    "Answer concisely using the user's preferred language.",
    "Focus on Individual Income Tax (Form 1040) guidance and cite relevant IRS publications when possible.",
    `Respond in ${languageName} and include short pointers to IRS sources when available.`,
  ].join(" ");
}

function extractReferences(answer: string): { cleaned: string; references?: string[] } {
  const references = Array.from(answer.matchAll(/https?:\/\/[^\s)]+/gi)).map((match) => match[0]);
  if (references.length === 0) {
    return { cleaned: answer.trim() };
  }
  const unique = Array.from(new Set(references));
  let cleaned = answer;
  for (const ref of unique) {
    cleaned = cleaned.replace(ref, "").trim();
  }
  return { cleaned: cleaned.replace(/\n{3,}/g, "\n\n").trim(), references: unique };
}

export async function queryAiAssistant(question: string, language: LanguageCode): Promise<AiResponse> {
  if (!config.aiApiKey || config.aiApiKey.trim().length === 0) {
    throw new AiProviderError("AI API key is not configured");
  }

  const baseUrl = (config.aiBaseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
  const endpoint = `${baseUrl}${CHAT_COMPLETIONS_PATH}`;
  const isOpenRouter = baseUrl === OPENROUTER_BASE_URL || /openrouter\.ai/.test(baseUrl);

  const body = {
    model: config.aiModel || (isOpenRouter ? "deepseek/deepseek-chat-v3.1:free" : "gpt-4o-mini"),
    temperature: 0.2,
    top_p: 0.9,
    messages: [
      { role: "system", content: buildSystemPrompt(language) },
      { role: "user", content: question },
    ],
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.aiApiKey}`,
  };

  if (isOpenRouter) {
    headers["HTTP-Referer"] = config.aiReferer ?? "https://taxhelp.ai";
    headers["X-Title"] = config.aiTitle ?? "TaxHelp AI";
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.warn("AI provider request failed %s -> %s", endpoint, errorText);
    throw new AiProviderError(errorText || response.statusText || "AI provider request failed");
  }

  const payload = await response.json();
  const content: string | undefined = payload?.choices?.[0]?.message?.content;
  if (!content || content.trim().length === 0) {
    throw new AiProviderError("AI provider returned an empty response");
  }

  const { cleaned, references } = extractReferences(content);
  return {
    answer: cleaned.length > 0 ? cleaned : content.trim(),
    references: references && references.length > 0 ? references : undefined,
  };
}
