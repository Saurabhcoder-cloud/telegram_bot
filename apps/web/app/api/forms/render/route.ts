import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthContext } from '@/lib/auth';
import { renderReturnPdf } from '@/lib/pdf';

const schema = z.object({
  normalizedReturn: z.record(z.any())
});

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const auth = getAuthContext(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const json = await req.json();
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const file = await renderReturnPdf(auth.userId, parsed.data.normalizedReturn);

  return NextResponse.json({ files: [{ type: 'pdf', url: file.url, expiresIn: file.expiresIn }] });
}
