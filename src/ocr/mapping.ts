import { OcrDocumentType } from "../types";

export interface OcrFieldMapping {
  source: string;
  target: string;
  label: string;
}

export const OCR_FIELD_MAPPING: Record<OcrDocumentType, OcrFieldMapping[]> = {
  w2: [
    { source: "employer", target: "1040.income.w2.employer", label: "Employer" },
    { source: "wages", target: "1040.income.wages", label: "Wages" },
    {
      source: "fed_tax_withheld",
      target: "1040.tax_and_payments.federal_tax_withheld",
      label: "Federal tax withheld",
    },
  ],
  "1099-int": [
    { source: "payer", target: "1040.income.interest_payer", label: "Payer" },
    { source: "interest_income", target: "1040.income.interest_income", label: "Interest income" },
  ],
  "1099-nec": [
    { source: "payer", target: "schedule_c.income.payer", label: "Payer" },
    { source: "non_employee_comp", target: "schedule_c.income.gross_receipts", label: "Non-employee comp" },
    {
      source: "federal_tax_withheld",
      target: "schedule_c.tax_and_payments.federal_tax_withheld",
      label: "Federal tax withheld",
    },
  ],
};
