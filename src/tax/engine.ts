import { ESTIMATE_WITHHOLDING_RATE, STANDARD_DEDUCTION } from "../constants";
import { RefundEstimateResult, TaxCalculationInput, TaxCreditBreakdown } from "../types";

type TaxBracket = { upTo: number; rate: number };

const TAX_BRACKETS_2024: Record<string, TaxBracket[]> = {
  single: [
    { upTo: 11000, rate: 0.1 },
    { upTo: 44725, rate: 0.12 },
    { upTo: 95375, rate: 0.22 },
    { upTo: 182100, rate: 0.24 },
    { upTo: 231250, rate: 0.32 },
    { upTo: 578125, rate: 0.35 },
    { upTo: Number.POSITIVE_INFINITY, rate: 0.37 },
  ],
  married_joint: [
    { upTo: 22000, rate: 0.1 },
    { upTo: 89450, rate: 0.12 },
    { upTo: 190750, rate: 0.22 },
    { upTo: 364200, rate: 0.24 },
    { upTo: 462500, rate: 0.32 },
    { upTo: 693750, rate: 0.35 },
    { upTo: Number.POSITIVE_INFINITY, rate: 0.37 },
  ],
  married_separate: [
    { upTo: 11000, rate: 0.1 },
    { upTo: 44725, rate: 0.12 },
    { upTo: 95375, rate: 0.22 },
    { upTo: 182100, rate: 0.24 },
    { upTo: 231250, rate: 0.32 },
    { upTo: 346875, rate: 0.35 },
    { upTo: Number.POSITIVE_INFINITY, rate: 0.37 },
  ],
  head_household: [
    { upTo: 15700, rate: 0.1 },
    { upTo: 59850, rate: 0.12 },
    { upTo: 95350, rate: 0.22 },
    { upTo: 182100, rate: 0.24 },
    { upTo: 231250, rate: 0.32 },
    { upTo: 578100, rate: 0.35 },
    { upTo: Number.POSITIVE_INFINITY, rate: 0.37 },
  ],
  widow: [
    { upTo: 22000, rate: 0.1 },
    { upTo: 89450, rate: 0.12 },
    { upTo: 190750, rate: 0.22 },
    { upTo: 364200, rate: 0.24 },
    { upTo: 462500, rate: 0.32 },
    { upTo: 693750, rate: 0.35 },
    { upTo: Number.POSITIVE_INFINITY, rate: 0.37 },
  ],
};

function calculateTaxLiability(status: string, taxableIncome: number): { tax: number; marginalRate: number } {
  const brackets = TAX_BRACKETS_2024[status] ?? TAX_BRACKETS_2024.single;
  let remaining = taxableIncome;
  let previousCap = 0;
  let tax = 0;
  let marginalRate = brackets[0]?.rate ?? 0.1;

  for (const bracket of brackets) {
    const bracketWidth = bracket.upTo - previousCap;
    const taxableAtRate = Math.max(Math.min(remaining, bracketWidth), 0);
    tax += taxableAtRate * bracket.rate;
    remaining -= taxableAtRate;
    if (remaining <= 0) {
      marginalRate = bracket.rate;
      break;
    }
    previousCap = bracket.upTo;
  }

  return { tax, marginalRate };
}

function calculateCredits(input: TaxCalculationInput): TaxCreditBreakdown {
  const baseChildCredit = input.childTaxCreditOverride ?? input.dependents * 2000;
  const eitc = input.earnedIncomeCreditOverride ?? Math.min(1200, input.dependents * 600);
  const education = input.educationCreditOverride ?? 0;
  return {
    childTaxCredit: Math.max(0, baseChildCredit),
    earnedIncomeCredit: Math.max(0, eitc),
    educationCredit: Math.max(0, education),
  };
}

export function estimateRefund(input: TaxCalculationInput): RefundEstimateResult {
  const deduction = STANDARD_DEDUCTION[input.status] ?? STANDARD_DEDUCTION.single;
  const taxableIncome = Math.max(0, input.income - deduction);
  const { tax: estimatedTax, marginalRate } = calculateTaxLiability(input.status, taxableIncome);
  const creditsBreakdown = calculateCredits(input);
  const credits =
    creditsBreakdown.childTaxCredit +
    creditsBreakdown.earnedIncomeCredit +
    creditsBreakdown.educationCredit;
  const withheld = input.withheld ?? input.income * ESTIMATE_WITHHOLDING_RATE;
  const net = withheld + credits - estimatedTax;

  return {
    status: input.status,
    dependents: input.dependents,
    income: input.income,
    taxableIncome,
    estimatedTax,
    credits,
    creditsBreakdown,
    withheld,
    net,
    marginalRate,
  };
}
