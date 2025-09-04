import dotenv from "dotenv";
// Ensure .env values override any system env with same name (fixes 401 from wrong token)
dotenv.config({ override: true });

import { Telegraf, Context } from "telegraf";
import { message } from "telegraf/filters";
import { join } from "path";
import fs from "fs";
import logger from "./logger";
import type { BotMeta } from "./types";

// ---- Read env ----
const token = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const meta: BotMeta = {
  name: process.env.BOT_NAME || "Demo Bot",
  version: process.env.BOT_VERSION || "0.1.0",
  updatedAt: process.env.BOT_UPDATED_AT || new Date().toISOString().slice(0, 10),
  author: process.env.BOT_AUTHOR || "Unknown",
};

if (!token || token.trim().length === 0) {
  logger.error("Missing BOT_TOKEN in .env (or empty).");
  process.exit(1);
}
const safeTokenTail = token.slice(-6);

// ---- Pre-launch token check (friendly error if invalid) ----
async function validateToken(t: string) {
  const temp = new Telegraf<Context>(t);
  try {
    const me = await temp.telegram.getMe();
    logger.info(`Token looks valid (…${safeTokenTail}). Bot username=@${me.username}`);
  } catch (e) {
    logger.error(
      `❌ Invalid BOT_TOKEN (…${safeTokenTail}). Regenerate via @BotFather and update .env. Error=%o`,
      e
    );
    process.exit(1);
  }
}
await validateToken(token);

// ---- Real bot instance ----
const bot = new Telegraf<Context>(token);

// ---- Middleware: log every update ----
bot.use(async (ctx, next) => {
  const u = ctx.update as any;
  const from = u?.message?.from || u?.callback_query?.from;
  logger.info("Update %o", {
    update_id: u?.update_id,
    user: from ? `${from.id} (${from.username || from.first_name})` : "n/a",
    type: Object.keys(ctx.update)[1] ?? Object.keys(ctx.update)[0],
  });
  return next();
});

// ---- Commands ----
bot.start(async (ctx) => {
  const text =
`👋 Hello! I'm a demo bot.
Available commands:
/ping – check availability
/help – list commands
/info – bot information
/status – runtime status
/file – send sample file

Send any normal text and I’ll echo it back.`;
  await ctx.reply(text);
});

bot.command("ping", (ctx) => ctx.reply("pong ✅"));

bot.command("help", (ctx) =>
  ctx.reply(
    `/start – greeting + summary
/ping – check availability
/help – this help
/info – name, version, updated date, author
/status – runtime + token check
/file – send sample file`
  )
);

bot.command("info", (ctx) => {
  ctx.reply(
    `ℹ️ Bot information
Name: ${meta.name}
Version: ${meta.version}
Updated: ${meta.updatedAt}
Author: ${meta.author}`
  );
});

bot.command("status", async (ctx) => {
  try {
    const me = await bot.telegram.getMe();
    const uptimeSec = Math.round(process.uptime());
    const mem = process.memoryUsage();
    ctx.reply(
      `✅ Status: OK
Username: @${me.username}
Uptime: ${uptimeSec}s
Memory: ${(mem.rss/1024/1024).toFixed(1)} MB
Env: ${process.env.NODE_ENV || "unknown"}`
    );
  } catch (err) {
    logger.error("Status error %o", err);
    ctx.reply("❌ Status: ERROR");
  }
});

// ---- /file: send local sample.txt ----
bot.command("file", async (ctx) => {
  const filePath = join(process.cwd(), "sample.txt");
  if (!fs.existsSync(filePath)) {
    return ctx.reply("❌ sample.txt not found.");
  }
  await ctx.replyWithDocument({ source: filePath, filename: "sample.txt" });
});

// ---- Echo mode ----
bot.on(message("text"), async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith("/")) return;
  await ctx.reply(`Echo: ${text}`);
});

// ---- Error catcher ----
bot.catch((err, ctx) => {
  logger.error("Bot error %o", err);
  ctx.reply?.("⚠️ Internal error, check logs.");
});

// ---- Launch ----
(async () => {
  await bot.launch();
  logger.info(`Bot launched. Version=${meta.version}, Name=${meta.name}`);

  if (ADMIN_CHAT_ID) {
    try {
      await bot.telegram.sendMessage(
        ADMIN_CHAT_ID,
        `🚀 ${meta.name} v${meta.version} started at ${new Date().toLocaleString()}.`
      );
    } catch (e) {
      logger.warn("Admin notify failed: %o", e);
    }
  }

  process.once("SIGINT", () => {
    logger.info("SIGINT -> stopping bot…");
    bot.stop("SIGINT");
  });
  process.once("SIGTERM", () => {
    logger.info("SIGTERM -> stopping bot…");
    bot.stop("SIGTERM");
  });
})();
