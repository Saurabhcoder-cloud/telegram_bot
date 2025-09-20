import { EventEmitter } from 'events';
import { setTimeout as delay } from 'timers/promises';

const DEFAULT_POLLING_INTERVAL_MS = 1000;

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanParams(input) {
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'object' && !(value instanceof Array) && !(value instanceof Date) && !(value instanceof Blob)) {
      out[key] = JSON.stringify(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export default class TelegramBot extends EventEmitter {
  constructor(token, options = {}) {
    super();
    if (!token) {
      throw new Error('Telegram Bot Token is required');
    }
    this.token = token;
    this.options = options;
    this.offset = 0;
    this.polling = false;
    this.textListeners = [];

    if (options.polling) {
      this.startPolling();
    }
  }

  get baseUrl() {
    return `https://api.telegram.org/bot${this.token}`;
  }

  async _request(method, params = {}, extra = {}) {
    const url = `${this.baseUrl}/${method}`;
    let response;
    try {
      if (extra.formData) {
        if (params && Object.keys(params).length > 0) {
          for (const [key, value] of Object.entries(cleanParams(params))) {
            extra.formData.append(key, value);
          }
        }
        response = await fetch(url, {
          method: 'POST',
          body: extra.formData,
        });
      } else {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cleanParams(params)),
        });
      }
    } catch (err) {
      this.emit('error', err);
      throw err;
    }

    if (!response.ok) {
      const text = await response.text();
      const error = new Error(`Telegram API request failed (${response.status}): ${text}`);
      this.emit('error', error);
      throw error;
    }

    const data = await response.json();
    if (!data.ok) {
      const error = new Error(`Telegram API error: ${data.description || 'unknown error'}`);
      this.emit('error', error);
      throw error;
    }
    return data.result;
  }

  async startPolling() {
    if (this.polling) return;
    this.polling = true;
    this.emit('polling');
    const pollingOptions = isObject(this.options.polling) ? this.options.polling : {};
    const timeout = pollingOptions.timeout ?? 30;
    const limit = pollingOptions.limit ?? 100;
    const interval = pollingOptions.interval ?? DEFAULT_POLLING_INTERVAL_MS;

    while (this.polling) {
      try {
        const updates = await this._request('getUpdates', {
          offset: this.offset,
          timeout,
          limit,
        });
        for (const update of updates) {
          this.offset = update.update_id + 1;
          this.processUpdate(update);
        }
      } catch (err) {
        this.emit('polling_error', err);
        await delay(interval);
      }
    }
  }

  stopPolling() {
    this.polling = false;
  }

  async setWebHook(url, options = {}) {
    const params = { url, ...options };
    return this._request('setWebhook', params);
  }

  async deleteWebHook(options = {}) {
    return this._request('deleteWebhook', options);
  }

  onText(regex, callback) {
    if (!(regex instanceof RegExp)) {
      throw new Error('onText expects a RegExp');
    }
    this.textListeners.push({ regex, callback });
  }

  processUpdate(update) {
    this.emit('update', update);
    if (update.message) {
      this.emit('message', update.message);
      if (update.message.text) {
        for (const { regex, callback } of this.textListeners) {
          const result = regex.exec(update.message.text);
          if (result) {
            callback(update.message, result);
          }
        }
      }
    }
    if (update.callback_query) {
      this.emit('callback_query', update.callback_query);
    }
  }

  async sendMessage(chatId, text, options = {}) {
    return this._request('sendMessage', { chat_id: chatId, text, ...options });
  }

  async editMessageText(text, options = {}) {
    return this._request('editMessageText', { text, ...options });
  }

  async editMessageReplyMarkup(options = {}) {
    return this._request('editMessageReplyMarkup', options);
  }

  async answerCallbackQuery(callbackQueryId, options = {}) {
    return this._request('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      ...options,
    });
  }

  async sendChatAction(chatId, action) {
    return this._request('sendChatAction', { chat_id: chatId, action });
  }

  async sendDocument(chatId, document, options = {}) {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    if (typeof document === 'string') {
      form.append('document', document);
    } else if (document && typeof document === 'object') {
      const { filename = 'document.pdf', contentType = 'application/octet-stream', value } = document;
      if (!value) {
        throw new Error('Invalid document value');
      }
      const blob = value instanceof Blob ? value : new Blob([value], { type: contentType });
      form.append('document', blob, filename);
    } else {
      throw new Error('Unsupported document type');
    }
    for (const [key, value] of Object.entries(cleanParams(options))) {
      form.append(key, value);
    }
    return this._request('sendDocument', {}, { formData: form });
  }

  async sendPhoto(chatId, photo, options = {}) {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    if (typeof photo === 'string') {
      form.append('photo', photo);
    } else if (photo && typeof photo === 'object') {
      const { filename = 'photo.jpg', contentType = 'image/jpeg', value } = photo;
      if (!value) {
        throw new Error('Invalid photo value');
      }
      const blob = value instanceof Blob ? value : new Blob([value], { type: contentType });
      form.append('photo', blob, filename);
    } else {
      throw new Error('Unsupported photo type');
    }
    for (const [key, value] of Object.entries(cleanParams(options))) {
      form.append(key, value);
    }
    return this._request('sendPhoto', {}, { formData: form });
  }

  async setMyCommands(commands = []) {
    return this._request('setMyCommands', { commands });
  }
}
