import { NextResponse } from 'next/server';
import { z } from 'zod';
import { redis } from '@/lib/redis';
import { normalizeUsPhone } from '@/lib/phone';

export const runtime = 'nodejs';

const bodySchema = z.object({
  phone: z.string().min(7)
});

export async function POST(request: Request) {
  const json = await request.json();
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  let phone: string;
  try {
    phone = normalizeUsPhone(parsed.data.phone);
  } catch (error) {
    return NextResponse.json({ error: 'Invalid US phone number' }, { status: 400 });
  }

  const requestId = crypto.randomUUID();
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  await redis.hset(`otp:${requestId}`, {
    phone,
    code: otp,
    createdAt: Date.now().toString()
  });
  await redis.expire(`otp:${requestId}`, 300);

  return NextResponse.json({ requestId });
}
