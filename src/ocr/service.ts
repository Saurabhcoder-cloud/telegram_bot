import { LanguageCode, OcrDocumentType, OcrProcessResult } from "../types";
import { formatCurrency } from "../utils/format";
import { OCR_FIELD_MAPPING } from "./mapping";

export interface OcrMappingResult {
  mappedFields: Record<string, string | number>;
  summaryLines: string[];
}

export function mapOcrProcessResult(
  language: LanguageCode,
  result: OcrProcessResult
): OcrMappingResult {
  const mappings = OCR_FIELD_MAPPING[result.type] ?? [];
  const mappedFields: Record<string, string | number> = {};
  const summaryLines: string[] = [];

  for (const mapping of mappings) {
    const value = result.fields[mapping.source];
    if (value === undefined || value === null) continue;
    mappedFields[mapping.target] = value;
    const formatted = typeof value === "number" ? formatCurrency(language, value) : String(value);
    summaryLines.push(`${mapping.label}: ${formatted}`);
  }

  return { mappedFields, summaryLines };
}

export function inferDocumentTypeFromField(field: string): OcrDocumentType | null {
  if (field === "w2Income") return "w2";
  if (field === "form1099Income") return "1099-int";
  if (field === "scheduleCDetails") return "1099-nec";
  return null;
}

export function refineDocumentType(
  initial: OcrDocumentType | null,
  metadata?: string | null
): OcrDocumentType | null {
  if (!metadata) return initial;
  const normalized = metadata.toLowerCase();
  if (normalized.includes("nec")) {
    return "1099-nec";
  }
  if (normalized.includes("int") || normalized.includes("interest")) {
    return "1099-int";
  }
  return initial;
}
