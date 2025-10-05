import { Telegraf, Markup } from 'telegraf';
import { env } from './env';
import { redis } from './redis';

export type BotContext = {
  locale: 'en-US' | 'es-ES';
  phone?: string;
  state?: string;
};

const START_MENU = [
  ['Upload W-2/1099'],
  ['Start my return'],
  ['Tax Q&A', 'Support']
];

function replyMenu(locale: 'en-US' | 'es-ES') {
  return Markup.keyboard(START_MENU).resize();
}

export const bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);

bot.start(async (ctx) => {
  await ctx.reply(
    'Welcome to TaxHelp Assistant. Choose your language to get started.',
    Markup.inlineKeyboard([
      Markup.button.callback('English', 'lang_en'),
      Markup.button.callback('Español', 'lang_es')
    ])
  );
});

bot.action(/lang_(en|es)/, async (ctx) => {
  const locale = ctx.match?.[1] === 'es' ? 'es-ES' : 'en-US';
  await redis.set(`bot:locale:${ctx.from?.id}`, locale, { ex: 60 * 60 * 24 * 30 });
  await ctx.answerCbQuery('Language saved');
  await ctx.reply(
    locale === 'es-ES'
      ? 'Necesitamos verificar su teléfono. Envíe su número (solo EE. UU.).'
      : 'We need to verify your phone. Send your US number.',
    replyMenu(locale)
  );
});

bot.hears('Support', async (ctx) => {
  await ctx.reply('A specialist will reach out within 1 business day.');
});

bot.on('contact', async (ctx) => {
  if (!ctx.message.contact?.phone_number) return;
  const phone = ctx.message.contact.phone_number;
  await redis.set(`bot:phone:${ctx.from.id}`, phone, { ex: 60 * 10 });
  await ctx.reply('Thanks! Sending OTP…');
});

bot.hears('Upload W-2/1099', async (ctx) => {
  await ctx.reply('Share a PDF, JPG, or PNG up to 10 MB and we will process it.');
});

bot.on('document', async (ctx) => {
  await ctx.reply('Processing … Detecting document type …');
});

bot.hears('Tax Q&A', async (ctx) => {
  await ctx.reply('Ask a quick tax question and I will try to help, then we will resume your intake.');
});

bot.on('message', async (ctx) => {
  if ('text' in ctx.message) {
    const text = ctx.message.text?.trim();
    if (!text) return;
    if (/^\+?1?\d{10}$/.test(text)) {
      await redis.set(`bot:phone:${ctx.from.id}`, text, { ex: 60 * 10 });
      await ctx.reply('Great, please enter the 6 digit code we just sent.');
      return;
    }
    if (/^\d{6}$/.test(text)) {
      await ctx.reply('Code verified! Continue in the web app to review your return.');
      return;
    }
  }
});
