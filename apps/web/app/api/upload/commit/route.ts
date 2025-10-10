import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthContext } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';

const schema = z.object({
  fileKey: z.string().min(5),
  sha256: z.string().length(64)
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

  const doc = await prisma.document.create({
    data: {
      userId: auth.userId,
      kind: 'upload',
      url: parsed.data.fileKey,
      checksum: parsed.data.sha256
    }
  });

  const previewUrl = `${env.APP_BASE_URL}/api/files/${doc.id}`;

  return NextResponse.json({ previewUrl, docId: doc.id });
}
