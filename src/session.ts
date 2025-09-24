import { SessionData, LanguageCode, UserProfile } from "./types";

const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

export class SessionStore {
  private store = new Map<number, SessionData>();

  get(chatId: number): SessionData | undefined {
    const session = this.store.get(chatId);
    if (!session) return undefined;
    if (session.lastActivity && Date.now() - session.lastActivity > SESSION_TTL_MS) {
      this.store.delete(chatId);
      return undefined;
    }
    return session;
  }

  create(chatId: number, telegramId: number, language: LanguageCode): SessionData {
    const session: SessionData = {
      chatId,
      telegramId,
      language,
      mode: "idle",
      lastActivity: Date.now(),
      ui: {},
    };
    this.store.set(chatId, session);
    return session;
  }

  upsert(chatId: number, telegramId: number, language: LanguageCode): SessionData {
    const existing = this.get(chatId);
    if (existing) {
      existing.language = language;
      existing.lastActivity = Date.now();
      return existing;
    }
    return this.create(chatId, telegramId, language);
  }

  update(chatId: number, update: Partial<SessionData>): SessionData | undefined {
    const session = this.get(chatId);
    if (!session) return undefined;
    Object.assign(session, update, { lastActivity: Date.now() });
    this.store.set(chatId, session);
    return session;
  }

  setProfile(chatId: number, profile: UserProfile): void {
    const session = this.get(chatId);
    if (!session) return;
    session.profile = profile;
    session.language = profile.language;
    session.lastActivity = Date.now();
    this.store.set(chatId, session);
  }
}

export const sessionStore = new SessionStore();
