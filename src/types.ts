export type LanguageCode = "en" | "es" | "ru" | "zh" | "ar" | "fa";

export interface LanguageOption {
  code: LanguageCode;
  label: string;
  locale: string;
}

export interface RegistrationPayload {
  fullName: string;
  email: string;
  phone?: string;
  dob: string;
  filingStatus: string;
  incomeType: string;
  state: string;
  language: LanguageCode;
  telegramId: number;
}

export interface LoginPayload {
  email: string;
  password: string;
  telegramId: number;
}

export interface UserProfile {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
  dob?: string;
  filingStatus?: string;
  incomeType?: string;
  state?: string;
  language: LanguageCode;
  onboardingComplete?: boolean;
  lastSyncedAt?: string;
}

export interface SessionRegistrationState {
  stepIndex: number;
  data: Partial<RegistrationPayload>;
}

export interface SessionLoginState {
  stepIndex: number;
  email?: string;
  password?: string;
}

export interface FilingData {
  w2Income?: string;
  form1099Income?: string;
  scheduleCDetails?: string;
  deductions?: string;
  dependents?: string;
  educationCredits?: string;
  medicalExpenses?: string;
  mileage?: string;
}

export interface SessionFilingState {
  filingId?: string;
  stepIndex: number;
  totalSteps: number;
  data: FilingData;
  summaryMessageId?: number;
}

export interface SessionReminderState {
  reminderType?: string;
  dueDate?: string;
}

export interface SessionProfileState {
  editField?: keyof UserProfile;
  data?: Partial<UserProfile>;
}

export type SessionMode =
  | "idle"
  | "registration"
  | "login"
  | "filing"
  | "ai"
  | "profile"
  | "reminder";

export interface SessionData {
  chatId: number;
  telegramId: number;
  language: LanguageCode;
  jwt?: string;
  profile?: UserProfile;
  mode: SessionMode;
  registration?: SessionRegistrationState;
  login?: SessionLoginState;
  filing?: SessionFilingState;
  reminder?: SessionReminderState;
  profileEditor?: SessionProfileState;
  lastActivity?: number;
}

export interface ApiUserResponse {
  token: string;
  user: UserProfile;
}

export interface ApiTaxForm {
  id: string;
  name: string;
  year: number;
  status: "draft" | "submitted" | "completed";
  updatedAt: string;
}

export interface AiResponse {
  answer: string;
  references?: string[];
}
