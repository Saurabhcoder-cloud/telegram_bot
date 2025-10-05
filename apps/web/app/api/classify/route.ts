import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getAuthContext } from '@/lib/auth';

const schema = z.object({
  docId: z.string().min(5)
});

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const auth = getAuthContext(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const payload = await req.json();
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const doc = await prisma.document.findUnique({ where: { id: parsed.data.docId } });
  if (!doc || doc.userId !== auth.userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ type: 'W2', confidence: 0.82 });
}
