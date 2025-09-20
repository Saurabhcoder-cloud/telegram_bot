import { config } from "../config";
import logger from "../logger";
import {
  ApiTaxForm,
  ApiUserResponse,
  FilingData,
  LanguageCode,
  LoginPayload,
  RegistrationPayload,
  UserProfile,
  AiResponse,
} from "../types";

interface RequestOptions extends RequestInit {
  auth?: boolean;
  query?: Record<string, string | number | undefined>;
}

class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export class ApiClient {
  private baseUrl: string;
  private token?: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  setToken(token?: string) {
    this.token = token;
  }

  private buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
    const url = new URL(`${this.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { auth = true, query, headers, body, method = "GET" } = options;
    const url = this.buildUrl(path, query);
    const finalHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (headers) {
      if (headers instanceof Headers) {
        headers.forEach((value, key) => {
          finalHeaders[key] = value;
        });
      } else if (Array.isArray(headers)) {
        for (const [key, value] of headers) {
          finalHeaders[key] = value;
        }
      } else {
        Object.assign(finalHeaders, headers as Record<string, string>);
      }
    }
    if (auth && this.token) {
      finalHeaders["Authorization"] = `Bearer ${this.token}`;
    }

    const response = await fetch(url, {
      method,
      headers: finalHeaders,
      body,
    });

    const text = await response.text();
    const payload = text ? JSON.parse(text) : undefined;

    if (!response.ok) {
      const message = payload?.message || response.statusText || "Request failed";
      const error = new ApiError(message, response.status, payload?.code);
      logger.warn("API error %s -> %s", url, message);
      throw error;
    }

    return payload as T;
  }

  async register(payload: RegistrationPayload): Promise<ApiUserResponse> {
    const body = JSON.stringify(payload);
    const result = await this.request<ApiUserResponse>("/auth/register", {
      method: "POST",
      body,
      auth: false,
    });
    this.setToken(result.token);
    return result;
  }

  async login(payload: LoginPayload): Promise<ApiUserResponse> {
    const result = await this.request<ApiUserResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
      auth: false,
    });
    this.setToken(result.token);
    return result;
  }

  async fetchProfile(): Promise<UserProfile> {
    const profile = await this.request<UserProfile>("/users/me", { method: "GET" });
    return profile;
  }

  async getProfileByTelegramId(telegramId: number): Promise<ApiUserResponse | null> {
    try {
      const result = await this.request<ApiUserResponse>(`/auth/telegram/${telegramId}`, {
        method: "GET",
        auth: false,
      });
      this.setToken(result.token);
      return result;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        return null;
      }
      throw err;
    }
  }

  async updateLanguage(language: LanguageCode): Promise<UserProfile> {
    const profile = await this.request<UserProfile>("/users/me/language", {
      method: "PATCH",
      body: JSON.stringify({ language }),
    });
    return profile;
  }

  async updateProfile(data: Partial<UserProfile>): Promise<UserProfile> {
    const profile = await this.request<UserProfile>("/users/me", {
      method: "PATCH",
      body: JSON.stringify(data),
    });
    return profile;
  }

  async startOrResumeFiling(): Promise<{ filingId: string; data?: FilingData; step?: number }> {
    return this.request<{ filingId: string; data?: FilingData; step?: number }>("/tax/filings", {
      method: "POST",
      body: JSON.stringify({ action: "start_or_resume" }),
    });
  }

  async saveFilingStep(filingId: string, step: number, payload: Partial<FilingData>): Promise<FilingData> {
    return this.request<FilingData>(`/tax/filings/${filingId}/steps/${step}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  }

  async fetchFilingSummary(filingId: string): Promise<{ filingId: string; data: FilingData }> {
    return this.request<{ filingId: string; data: FilingData }>(`/tax/filings/${filingId}`, {
      method: "GET",
    });
  }

  async submitFiling(filingId: string): Promise<{ status: string }> {
    return this.request<{ status: string }>(`/tax/filings/${filingId}/submit`, {
      method: "POST",
    });
  }

  async listTaxForms(): Promise<ApiTaxForm[]> {
    return this.request<ApiTaxForm[]>("/tax/forms", { method: "GET" });
  }

  async downloadTaxForm(formId: string): Promise<Blob> {
    const url = this.buildUrl(`/tax/forms/${formId}/pdf`);
    const headers: HeadersInit = {};
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }
    const response = await fetch(url, { headers });
    if (!response.ok) {
      const text = await response.text();
      throw new ApiError(text || "Failed to download PDF", response.status);
    }
    return await response.blob();
  }

  async createPaymentSession(): Promise<{ checkoutUrl: string; sessionId: string }> {
    return this.request<{ checkoutUrl: string; sessionId: string }>("/payments/checkout", {
      method: "POST",
      body: JSON.stringify({ provider: "stripe" }),
    });
  }

  async askAi(question: string, language: LanguageCode): Promise<AiResponse> {
    return this.request<AiResponse>("/ai/query", {
      method: "POST",
      body: JSON.stringify({ question, language }),
    });
  }

  async scheduleReminder(reminderType: string, dueDate: string): Promise<{ id: string }> {
    return this.request<{ id: string }>("/reminders", {
      method: "POST",
      body: JSON.stringify({ type: reminderType, dueDate }),
    });
  }

  async createCalendarLink(dueDate: string, title: string): Promise<{ url: string }> {
    return this.request<{ url: string }>("/integrations/calendar", {
      method: "POST",
      body: JSON.stringify({ dueDate, title }),
    });
  }
}

export function createApiClient(token?: string): ApiClient {
  const client = new ApiClient(config.apiBaseUrl);
  if (token) {
    client.setToken(token);
  }
  return client;
}

export { ApiError };
