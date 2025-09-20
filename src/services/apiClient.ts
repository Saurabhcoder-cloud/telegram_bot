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

  constructor(message: string, status: number, code?: string, cause?: unknown) {
    super(message, cause ? { cause } : undefined);
    this.status = status;
    this.code = code;
    this.name = "ApiError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const NETWORK_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "EPIPE",
  "UND_ERR_CONNECT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_TIMEOUT",
]);

function hasNetworkCode(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const { code, errno } = value as { code?: unknown; errno?: unknown };
  if (typeof code === "string" && NETWORK_ERROR_CODES.has(code)) {
    return true;
  }
  if (typeof errno === "string" && NETWORK_ERROR_CODES.has(errno)) {
    return true;
  }
  return false;
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

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: finalHeaders,
        body,
      });
    } catch (error) {
      logger.warn("Network error while calling %s: %o", url, error);
      throw new ApiError("Network request failed", 503, "network_error", error);
    }

    const text = await response.text();
    let payload: unknown = undefined;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (error) {
        logger.error("Failed to parse JSON response from %s: %o", url, error);
        throw new ApiError("Invalid server response", response.status || 500, "invalid_response");
      }
    }

    if (!response.ok) {
      const body = payload as { message?: string; code?: string } | undefined;
      const message = body?.message || response.statusText || "Request failed";
      const error = new ApiError(message, response.status, body?.code);
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

function messageLooksNetworkRelated(message?: string): boolean {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return (
    normalized.includes("network") ||
    normalized.includes("fetch failed") ||
    normalized.includes("timed out") ||
    normalized.includes("timeout") ||
    normalized.includes("enotfound") ||
    normalized.includes("econnrefused")
  );
}

export function isNetworkError(error: unknown): boolean {
  if (error instanceof ApiError && error.code === "network_error") {
    return true;
  }

  if (error instanceof TypeError && messageLooksNetworkRelated(error.message)) {
    return true;
  }

  if (!error || typeof error !== "object") {
    return false;
  }

  if (hasNetworkCode(error)) {
    return true;
  }

  if ("cause" in error) {
    const { cause } = error as { cause?: unknown };
    if (hasNetworkCode(cause)) {
      return true;
    }
    if (cause instanceof Error && messageLooksNetworkRelated(cause.message)) {
      return true;
    }
  }

  const { message } = error as { message?: unknown };
  if (typeof message === "string" && messageLooksNetworkRelated(message)) {
    return true;
  }

  return false;
}

export { ApiError };
