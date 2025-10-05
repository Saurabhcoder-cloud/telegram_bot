import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthContext } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getOrCreateDraftReturn } from '@/lib/returns';

export const runtime = 'nodejs';

const bodySchema = z.object({
  accepted: z.boolean()
});

export async function POST(req: NextRequest) {
  const auth = getAuthContext(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const payload = await req.json();
  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const draft = await getOrCreateDraftReturn(auth.userId);
  await prisma.return.update({
    where: { id: draft.id },
    data: {
      stateJson: {
        ...draft.stateJson,
        consentAccepted: parsed.data.accepted,
        consentAt: new Date().toISOString()
      }
    }
  });

  return NextResponse.json({ accepted: parsed.data.accepted });
}
