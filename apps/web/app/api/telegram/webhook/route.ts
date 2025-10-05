import { NextRequest, NextResponse } from 'next/server';
import { bot } from '@/lib/bot';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = await req.json();
  await bot.handleUpdate(body);
  return NextResponse.json({ ok: true });
}
