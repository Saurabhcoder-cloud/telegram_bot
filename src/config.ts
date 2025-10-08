import dotenv from "dotenv";

dotenv.config({ override: true });

const required = ["BOT_TOKEN", "API_BASE_URL"] as const;

for (const key of required) {
  if (!process.env[key] || process.env[key]?.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

const aiApiKey = process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
const isOpenRouterKey = /^(sk-or-|sk-ant-)/.test(aiApiKey);

const resolvedAiBaseUrl =
  process.env.AI_BASE_URL ?? (isOpenRouterKey ? "https://openrouter.ai/api/v1" : "https://api.openai.com/v1");

const resolvedAiModel =
  process.env.AI_MODEL ?? (isOpenRouterKey ? "deepseek/deepseek-chat-v3.1:free" : "gpt-4o-mini");

export const config = {
  botToken: process.env.BOT_TOKEN!,
  apiBaseUrl: process.env.API_BASE_URL!,
  stripePublishableKey: process.env.STRIPE_KEY ?? "",
  aiApiKey,
  aiModel: resolvedAiModel,
  aiBaseUrl: resolvedAiBaseUrl,
  aiReferer: process.env.AI_REFERER ?? "https://taxhelp.ai",
  aiTitle: process.env.AI_TITLE ?? "TaxHelp AI",
  adminChatId: process.env.ADMIN_CHAT_ID,
  environment: process.env.NODE_ENV ?? "development",
  botName: process.env.BOT_NAME ?? "TaxHelp AI",
  botVersion: process.env.BOT_VERSION ?? "1.0.0",
  updatedAt: process.env.BOT_UPDATED_AT ?? new Date().toISOString(),
  author: process.env.BOT_AUTHOR ?? "TaxHelp AI Team",
  webhookUrl: process.env.WEBHOOK_URL,
  webhookSecret: process.env.WEBHOOK_SECRET ?? undefined,
  port: Number(process.env.PORT ?? 3000),
};

export type AppConfig = typeof config;
