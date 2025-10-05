import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthContext } from '@/lib/auth';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = getAuthContext(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const doc = await prisma.document.findUnique({ where: { id: params.id } });
  if (!doc || doc.userId !== auth.userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // In a real deployment this should proxy a signed S3 URL.
  const url = `${env.S3_ENDPOINT.replace(/\/$/, '')}/${doc.url}`;
  return NextResponse.json({ url });
}
