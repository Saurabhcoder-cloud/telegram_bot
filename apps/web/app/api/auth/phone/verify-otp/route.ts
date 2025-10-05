import { NextResponse } from 'next/server';
import { z } from 'zod';
import { redis } from '@/lib/redis';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

const bodySchema = z.object({
  requestId: z.string().min(10),
  code: z.string().length(6)
});

export async function POST(request: Request) {
  const payload = await request.json();
  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const cacheKey = `otp:${parsed.data.requestId}`;
  const cached = await redis.hgetall<string>(cacheKey);
  if (!cached || !cached.code) {
    return NextResponse.json({ error: 'OTP expired' }, { status: 400 });
  }

  if (cached.code !== parsed.data.code) {
    return NextResponse.json({ error: 'Invalid code' }, { status: 401 });
  }

  await redis.del(cacheKey);

  const user = await prisma.user.upsert({
    where: { phone: cached.phone },
    update: { phoneVerified: true },
    create: {
      phone: cached.phone,
      phoneVerified: true
    }
  });

  const tokenPayload = {
    sub: user.id,
    phone: user.phone,
    verifiedAt: Date.now()
  };
  const token = Buffer.from(JSON.stringify(tokenPayload)).toString('base64url');

  return NextResponse.json({ token, phoneVerified: true });
}
