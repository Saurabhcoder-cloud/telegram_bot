import { EventEmitter } from 'events';

export type ChatAction =
  | 'typing'
  | 'upload_photo'
  | 'record_video'
  | 'upload_video'
  | 'record_voice'
  | 'upload_voice'
  | 'upload_document'
  | 'choose_sticker'
  | 'find_location'
  | 'record_video_note'
  | 'upload_video_note';

export interface PollingOptions {
  interval?: number;
  timeout?: number;
  limit?: number;
}

export interface ConstructorOptions {
  polling?: boolean | PollingOptions;
}

export interface KeyboardButton {
  text: string;
  request_contact?: boolean;
  request_location?: boolean;
}

export interface ReplyKeyboardMarkup {
  keyboard: KeyboardButton[][];
  resize_keyboard?: boolean;
  one_time_keyboard?: boolean;
  selective?: boolean;
}

export interface InlineKeyboardButton {
  text: string;
  url?: string;
  callback_data?: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface ReplyKeyboardRemove {
  remove_keyboard: true;
  selective?: boolean;
}

export type ReplyMarkup = InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove;

export interface SendMessageOptions {
  parse_mode?: 'Markdown' | 'MarkdownV2' | 'HTML';
  reply_markup?: ReplyMarkup;
  disable_web_page_preview?: boolean;
}

export interface AnswerCallbackQueryOptions {
  text?: string;
  show_alert?: boolean;
  url?: string;
}

export interface InputFileOptions {
  filename?: string;
  contentType?: string;
  value: Blob | ArrayBuffer | Buffer;
}

export interface PhotoInputOptions extends InputFileOptions {
  filename?: string;
  contentType?: string;
}

export interface Chat {
  id: number;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface User {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface Message {
  message_id: number;
  from?: User;
  chat: Chat;
  date: number;
  text?: string;
  contact?: {
    phone_number: string;
    first_name?: string;
    last_name?: string;
    user_id?: number;
    vcard?: string;
  };
}

export interface CallbackQuery {
  id: string;
  from: User;
  message?: Message;
  inline_message_id?: string;
  chat_instance?: string;
  data?: string;
}

export interface Update {
  update_id: number;
  message?: Message;
  callback_query?: CallbackQuery;
}

export interface BotCommand {
  command: string;
  description: string;
}

export default class TelegramBot extends EventEmitter {
  constructor(token: string, options?: ConstructorOptions);
  startPolling(): Promise<void>;
  stopPolling(): void;
  setWebHook(url: string, options?: Record<string, unknown>): Promise<boolean>;
  deleteWebHook(options?: Record<string, unknown>): Promise<boolean>;
  onText(regex: RegExp, callback: (msg: Message, match: RegExpExecArray | null) => void): void;
  processUpdate(update: Update): void;
  sendMessage(chatId: number | string, text: string, options?: SendMessageOptions): Promise<Message>;
  editMessageText(text: string, options?: Record<string, unknown>): Promise<Message>;
  editMessageReplyMarkup(options?: Record<string, unknown>): Promise<boolean>;
  answerCallbackQuery(callbackQueryId: string, options?: AnswerCallbackQueryOptions): Promise<boolean>;
  sendChatAction(chatId: number | string, action: ChatAction): Promise<boolean>;
  sendDocument(
    chatId: number | string,
    document: string | InputFileOptions,
    options?: Record<string, unknown>
  ): Promise<Message>;
  sendPhoto(
    chatId: number | string,
    photo: string | PhotoInputOptions,
    options?: Record<string, unknown>
  ): Promise<Message>;
  setMyCommands(commands: BotCommand[]): Promise<boolean>;
}

export type {
  Message,
  CallbackQuery,
  Update,
  InlineKeyboardButton,
  InlineKeyboardMarkup,
  ReplyMarkup,
  SendMessageOptions,
};
