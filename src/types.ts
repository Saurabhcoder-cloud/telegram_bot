export type LanguageCode = "en" | "es" | "ru" | "zh" | "ar" | "fa";

export interface LanguageOption {
  code: LanguageCode;
  label: string;
  locale: string;
}

export interface RegistrationPayload {
  fullName: string;
  email: string;
  phone: string;
  dob: string;
  country: string;
  stateRegion: string;
  filingStatus: string;
  incomeType: string;
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
  country?: string;
  stateRegion?: string;
  language: LanguageCode;
  onboardingComplete?: boolean;
  lastSyncedAt?: string;
}

export interface SessionRegistrationState {
  stepIndex: number;
  data: Partial<RegistrationPayload>;
  phoneVerified?: boolean;
  stateRetryCount?: number;
}

export interface SessionLoginState {
  stepIndex: number;
  email?: string;
  password?: string;
}

export interface FilingDocument {
  fileId: string;
  fileName?: string;
  fileUniqueId?: string;
  mimeType?: string;
  documentId?: string;
  status?: "uploaded" | "processing" | "processed" | "failed";
  classification?: string;
  ocrSummary?: string;
  uploadedAt?: string;
}

export interface FilingData {
  documents?: FilingDocument[];
  validationNotes?: string;
  adaptiveResponses?: string;
  benefitsNotes?: string;
  reviewFeedback?: string;
  exportPreference?: string;
  retentionConsent?: "accept" | "decline";
  consentNotes?: string;
  // legacy fields retained for compatibility with previously saved drafts
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
  awaitingDocument?: boolean;
}

export interface DocumentUploadRequest {
  fileId: string;
  fileName?: string;
  mimeType?: string;
  fileUniqueId?: string;
}

export interface DocumentUploadResponse {
  documentId: string;
  classification?: string;
  status: string;
  ocrSummary?: string;
}

export interface FilingStageSummary {
  stageId: string;
  status: "pending" | "processing" | "completed" | "queued";
  headline?: string;
  summary: string;
  highlights?: string[];
  nextSteps?: string[];
}

export interface SessionReminderState {
  reminderType?: string;
  dueDate?: string;
}

export interface SessionProfileState {
  editField?: keyof UserProfile;
  data?: Partial<UserProfile>;
  inputType?: "text" | "phone" | "stateRegion";
}

export interface SessionUiState {
  countryPage?: number;
  statePage?: number;
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
  pendingRegistration?: RegistrationPayload;
  mode: SessionMode;
  registration?: SessionRegistrationState;
  login?: SessionLoginState;
  filing?: SessionFilingState;
  reminder?: SessionReminderState;
  profileEditor?: SessionProfileState;
  ui?: SessionUiState;
  lastActivity?: number;
  offlineMode?: boolean;
  offlineLogin?: {
    email: string;
    authenticatedAt: string;
  };
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
