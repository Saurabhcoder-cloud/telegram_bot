import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { stripe } from '@/lib/stripe';
import { env } from '@/lib/env';
import { getAuthContext } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getOrCreateDraftReturn } from '@/lib/returns';

const schema = z.object({
  plan: z.literal('mvp')
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

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        price: env.STRIPE_PRICE_ID_MVP,
        quantity: 1
      }
    ],
    success_url: `${env.APP_BASE_URL}/checkout/success`,
    cancel_url: `${env.APP_BASE_URL}/checkout/cancel`,
    metadata: {
      userId: auth.userId,
      returnId: draft.id
    }
  });

  await prisma.payment.create({
    data: {
      userId: auth.userId,
      stripeSession: session.id,
      amount: session.amount_total ?? 1499,
      status: 'pending'
    }
  });

  return NextResponse.json({ checkoutUrl: session.url });
}
