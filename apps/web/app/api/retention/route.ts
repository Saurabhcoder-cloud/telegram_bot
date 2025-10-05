import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthContext } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getOrCreateDraftReturn } from '@/lib/returns';

const schema = z.object({
  policy: z.enum(['30d', 'delete_now'])
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
  const draft = await getOrCreateDraftReturn(auth.userId);
  await prisma.return.update({
    where: { id: draft.id },
    data: {
      stateJson: {
        ...draft.stateJson,
        retentionPolicy: parsed.data.policy,
        retentionUpdatedAt: new Date().toISOString()
      }
    }
  });

  return NextResponse.json({ policy: parsed.data.policy });
}
