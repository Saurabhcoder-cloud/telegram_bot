import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = getAuthContext(req);
  if (!auth || auth.userId !== params.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await prisma.document.deleteMany({ where: { userId: auth.userId } });
  await prisma.return.deleteMany({ where: { userId: auth.userId } });

  return NextResponse.json({ status: 'queued' });
}
