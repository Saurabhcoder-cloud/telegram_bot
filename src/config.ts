import dotenv from "dotenv";

dotenv.config({ override: true });

if (!process.env.BOT_TOKEN || process.env.BOT_TOKEN.trim().length === 0) {
  throw new Error("Missing required environment variable: BOT_TOKEN");
}

const rawApiBaseUrl = process.env.API_BASE_URL ?? "";
const sanitizedApiBaseUrl = rawApiBaseUrl.trim().replace(/\/$/, "");

export const config = {
  botToken: process.env.BOT_TOKEN!,
  apiBaseUrl: sanitizedApiBaseUrl,
  stripePublishableKey: process.env.STRIPE_KEY ?? "",
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
