import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const input = await request.json();
  const grossIncome = Number(input?.wages ?? 0);
  const withholding = Number(input?.withholding ?? 0);
  const standardDeduction = 13850;
  const taxable = Math.max(0, grossIncome - standardDeduction);
  const estimatedTax = taxable * 0.12;
  const refund = Math.max(0, withholding - estimatedTax);

  return NextResponse.json({
    federal: {
      taxable,
      estimatedTax,
      withholding,
      refund
    },
    state: {
      taxable: taxable * 0.7,
      estimatedTax: estimatedTax * 0.7,
      refund: refund * 0.5
    },
    benefits: {
      childCreditEstimate: Number(input?.dependents_under_17 ?? 0) * 1600
    },
    explainers: [
      'We used the standard deduction for a quick estimate.',
      'Refunds are estimates and final numbers may differ after full review.'
    ],
    files: []
  });
}
