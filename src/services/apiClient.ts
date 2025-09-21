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
  SendPhoneOtpResponse,
  VerifyPhoneOtpResponse,
} from "../types";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_ATTEMPTS = 2;
const DEFAULT_RETRY_DELAY_MS = 500;

interface RequestOptions extends RequestInit {
  auth?: boolean;
  query?: Record<string, string | number | undefined>;
  timeoutMs?: number;
  retryAttempts?: number;
  retryDelayMs?: number;
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
  "ENETUNREACH",
  "EHOSTDOWN",
  "ECONNABORTED",
  "EPIPE",
  "ABORT_ERR",
  "UND_ERR_CONNECT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_TIMEOUT",
]);

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" ||
      (typeof (error as { code?: unknown }).code === "string" &&
        (error as { code?: string }).code === "ABORT_ERR"))
  );
}

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

  private calculateRetryDelay(baseDelay: number, attempt: number): number {
    return Math.round(baseDelay * Math.pow(2, attempt));
  }

  private async delay(ms: number): Promise<void> {
    if (ms <= 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private shouldRetryStatus(status: number): boolean {
    return status >= 500 || status === 429;
  }

  private shouldRetryError(error: unknown): boolean {
    if (!error) {
      return false;
    }

    if (error instanceof ApiError) {
      return (
        error.code === "network_error" ||
        error.code === "timeout" ||
        error.code === "health_check_failed"
      );
    }

    if (isAbortError(error)) {
      return true;
    }

    if (error instanceof TypeError) {
      return true;
    }

    if (hasNetworkCode(error)) {
      return true;
    }

    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && messageLooksNetworkRelated(message)) {
      return true;
    }

    if (error && typeof error === "object" && "cause" in error) {
      const cause = (error as { cause?: unknown }).cause;
      if (cause && cause !== error) {
        return this.shouldRetryError(cause);
      }
    }

    return false;
  }

  private normalizeFetchError(
    error: unknown,
    url: string,
    timeoutMs: number,
    code: string = "network_error"
  ): ApiError {
    if (error instanceof ApiError) {
      return error;
    }

    if (isAbortError(error)) {
      logger.warn("Request to %s timed out after %dms", url, timeoutMs);
      return new ApiError("Request timed out", 504, code === "network_error" ? "timeout" : code, error);
    }

    if (error instanceof TypeError || hasNetworkCode(error) || this.shouldRetryError(error)) {
      logger.warn("Network error while calling %s: %o", url, error);
      return new ApiError("Network request failed", 503, code, error);
    }

    if (error instanceof Error) {
      logger.warn("Request to %s failed: %s", url, error.message);
      return new ApiError(error.message || "Request failed", 500, code, error);
    }

    logger.warn("Request to %s failed with unknown error", url);
    return new ApiError("Request failed", 500, code);
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
    const {
      auth = true,
      query,
      headers,
      body,
      method = "GET",
      timeoutMs = DEFAULT_TIMEOUT_MS,
      retryAttempts = DEFAULT_RETRY_ATTEMPTS,
      retryDelayMs = DEFAULT_RETRY_DELAY_MS,
      signal: _signal,
      ...rest
    } = options;

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

    for (let attempt = 0; attempt <= retryAttempts; attempt++) {
      const isLastAttempt = attempt === retryAttempts;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const fetchOptions: RequestInit = {
          ...rest,
          method,
          headers: finalHeaders,
          signal: controller.signal,
        };

        if (body !== undefined) {
          fetchOptions.body = body;
        }

        const response = await fetch(url, fetchOptions);

        if (!response.ok) {
          if (!isLastAttempt && this.shouldRetryStatus(response.status)) {
            const wait = this.calculateRetryDelay(retryDelayMs, attempt);
            logger.warn(
              "Retrying %s due to HTTP %d (attempt %d/%d) in %dms",
              url,
              response.status,
              attempt + 1,
              retryAttempts + 1,
              wait
            );
            await this.delay(wait);
            continue;
          }

          const errorText = await response.text();
          let payload: unknown = undefined;
          if (errorText) {
            try {
              payload = JSON.parse(errorText);
            } catch {
              payload = undefined;
            }
          }

          const bodyJson = payload as { message?: string; code?: string } | undefined;
          const message = bodyJson?.message || response.statusText || "Request failed";
          logger.warn("API error %s -> %s (status %d)", url, message, response.status);
          throw new ApiError(message, response.status, bodyJson?.code);
        }

        const text = await response.text();
        if (!text) {
          return undefined as T;
        }

        try {
          return JSON.parse(text) as T;
        } catch (error) {
          logger.error("Failed to parse JSON response from %s: %o", url, error);
          throw new ApiError("Invalid server response", response.status || 500, "invalid_response", error);
        }
      } catch (error) {
        if (error instanceof ApiError) {
          throw error;
        }

        if (!isLastAttempt && this.shouldRetryError(error)) {
          const wait = this.calculateRetryDelay(retryDelayMs, attempt);
          logger.warn(
            "Retrying %s due to error: %s (attempt %d/%d) in %dms",
            url,
            error instanceof Error ? error.message : String(error),
            attempt + 1,
            retryAttempts + 1,
            wait
          );
          await this.delay(wait);
          continue;
        }

        throw this.normalizeFetchError(error, url, timeoutMs);
      } finally {
        clearTimeout(timeoutId);
      }
    }

    throw new ApiError("Request failed", 500, "unknown_error");
  }

  async healthCheck(timeoutMs: number = Math.min(DEFAULT_TIMEOUT_MS, 5000)): Promise<void> {
    const url = this.buildUrl("/health");
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 404 || response.status === 401 || response.status === 403) {
          logger.warn(
            "API health endpoint returned %d at %s",
            response.status,
            url
          );
          return;
        }

        const text = await response.text().catch(() => "");
        const message = text || `Health check failed with status ${response.status}`;
        throw new ApiError(message, response.status, "health_check_failed");
      }
    } catch (error) {
      throw this.normalizeFetchError(error, url, timeoutMs, "health_check_failed");
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async sendPhoneOtp(phone: string, language: LanguageCode, telegramId: number): Promise<SendPhoneOtpResponse> {
    return this.request<SendPhoneOtpResponse>("/auth/phone/send-otp", {
      method: "POST",
      body: JSON.stringify({ phone, language, telegramId }),
      auth: false,
    });
  }

  async verifyPhoneOtp(otpId: string, code: string): Promise<VerifyPhoneOtpResponse> {
    return this.request<VerifyPhoneOtpResponse>("/auth/phone/verify-otp", {
      method: "POST",
      body: JSON.stringify({ otpId, code }),
      auth: false,
    });
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
    for (let attempt = 0; attempt <= DEFAULT_RETRY_ATTEMPTS; attempt++) {
      const isLastAttempt = attempt === DEFAULT_RETRY_ATTEMPTS;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      try {
        const response = await fetch(url, { headers, signal: controller.signal });
        if (!response.ok) {
          if (!isLastAttempt && this.shouldRetryStatus(response.status)) {
            const wait = this.calculateRetryDelay(DEFAULT_RETRY_DELAY_MS, attempt);
            logger.warn(
              "Retrying %s download due to HTTP %d (attempt %d/%d) in %dms",
              url,
              response.status,
              attempt + 1,
              DEFAULT_RETRY_ATTEMPTS + 1,
              wait
            );
            await this.delay(wait);
            continue;
          }
          const text = await response.text();
          throw new ApiError(text || "Failed to download PDF", response.status);
        }
        return await response.blob();
      } catch (error) {
        if (!isLastAttempt && this.shouldRetryError(error)) {
          const wait = this.calculateRetryDelay(DEFAULT_RETRY_DELAY_MS, attempt);
          logger.warn(
            "Retrying %s download due to error: %s (attempt %d/%d) in %dms",
            url,
            error instanceof Error ? error.message : String(error),
            attempt + 1,
            DEFAULT_RETRY_ATTEMPTS + 1,
            wait
          );
          await this.delay(wait);
          continue;
        }
        throw this.normalizeFetchError(error, url, DEFAULT_TIMEOUT_MS);
      } finally {
        clearTimeout(timeoutId);
      }
    }
    throw new ApiError("Failed to download PDF", 500, "unknown_error");
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
  if (
    error instanceof ApiError &&
    (error.code === "network_error" || error.code === "timeout" || error.code === "health_check_failed")
  ) {
    return true;
  }

  if (isAbortError(error)) {
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
    if (isAbortError(cause)) {
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
