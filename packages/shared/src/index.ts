export type FilingStatus = 'Single' | 'Married filing jointly' | 'Married filing separately' | 'Head of household';

export type QaQuestionId =
  | 'filing_status'
  | 'dependents_under_17'
  | 'dependents_total'
  | 'zip'
  | 'gig_method'
  | 'miles'
  | 'actual.fuel'
  | 'actual.insurance'
  | 'actual.maintenance'
  | 'actual.dmv'
  | 'actual.depreciation'
  | 'phone_percent'
  | 'confirm_ss_tax'
  | 'confirm_medicare_tax'
  | 'confirm_ein';

export type QaQuestion = {
  id: QaQuestionId;
  label: string;
  type: 'select' | 'number' | 'currency' | 'text';
  options?: string[];
  help?: string;
  validation?: Record<string, unknown>;
};

export type ReturnState = {
  filing_status?: FilingStatus;
  dependents_under_17?: number;
  dependents_total?: number;
  zip?: string;
  gig_method?: 'Standard mileage' | 'Actual expenses';
  miles?: number;
  actual?: {
    fuel?: number;
    insurance?: number;
    maintenance?: number;
    dmv?: number;
    depreciation?: number;
  };
  phone_percent?: number;
  confirm_ss_tax?: boolean;
  confirm_medicare_tax?: boolean;
  confirm_ein?: boolean;
  validation_flags?: string[];
};

export type QaResponse = {
  questions: QaQuestion[];
  completed: boolean;
  notes?: string;
};
