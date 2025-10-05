import { NextResponse } from 'next/server';
import { z } from 'zod';

const schema = z.object({
  fields: z.object({
    socialSecurityWages: z.number().optional(),
    socialSecurityTax: z.number().optional(),
    medicareWages: z.number().optional(),
    medicareTax: z.number().optional(),
    employerEin: z.string().optional()
  })
});

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const json = await request.json();
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }
  const { fields } = parsed.data;
  const flags: string[] = [];

  if (fields.socialSecurityWages && fields.socialSecurityTax) {
    const expected = fields.socialSecurityWages * 0.062;
    if (Math.abs(fields.socialSecurityTax - expected) > 2) {
      flags.push('ss_rate_mismatch');
    }
  }

  if (fields.medicareWages && fields.medicareTax) {
    const expected = fields.medicareWages * 0.0145;
    if (Math.abs(fields.medicareTax - expected) > 2) {
      flags.push('medicare_rate_mismatch');
    }
  }

  if (fields.employerEin && !/^\d{2}-\d{7}$/.test(fields.employerEin)) {
    flags.push('ein_invalid');
  }

  return NextResponse.json({ flags });
}
