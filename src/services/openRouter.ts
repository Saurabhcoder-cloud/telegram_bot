import { config } from "../config";
import logger from "../logger";
import { languageLabel } from "../i18n";
import { AiResponse, LanguageCode } from "../types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = "openai/gpt-4o-mini";
const OPENROUTER_TIMEOUT_MS = 15_000;

function buildSystemPrompt(language: LanguageCode): string {
  const label = languageLabel(language);
  return [
    "You are TaxHelp AI, a multilingual tax assistant.",
    `Respond in ${label} unless the user explicitly requests another language.`,
    "Provide concise explanations and include relevant IRS or local tax authority links when available.",
  ].join(" ");
}

export async function askOpenRouter(
  question: string,
  language: LanguageCode,
): Promise<AiResponse> {
  if (!config.openRouterApiKey) {
    throw new Error("AI service is not configured");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openRouterApiKey}`,
        "X-Title": "TaxHelp AI Telegram Bot",
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [
          { role: "system", content: buildSystemPrompt(language) },
          { role: "user", content: question },
        ],
        temperature: 0.3,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenRouter request failed (${response.status}): ${text}`);
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("OpenRouter response was empty");
    }

    return { answer: content };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("The AI service timed out. Please try again.");
    }
    logger.error("OpenRouter AI error %o", error);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
