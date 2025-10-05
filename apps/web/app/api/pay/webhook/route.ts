import { NextRequest, NextResponse } from 'next/server';
import type StripeType from 'stripe';
import { stripe } from '@/lib/stripe';
import { env } from '@/lib/env';
import { prisma } from '@/lib/prisma';
import { renderReturnPdf } from '@/lib/pdf';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  const body = Buffer.from(await req.arrayBuffer());

  let event: StripeType.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as StripeType.Checkout.Session;
    const userId = session.metadata?.userId;
    const returnId = session.metadata?.returnId;
    if (userId && returnId) {
      await prisma.payment.updateMany({
        where: { stripeSession: session.id },
        data: {
          status: 'paid',
          amount: session.amount_total ?? 1499
        }
      });

      const draft = await prisma.return.findUnique({ where: { id: returnId } });
      if (draft) {
        const updatedState = {
          ...(draft.stateJson as Record<string, unknown>),
          paymentStatus: 'paid'
        };

        await prisma.return.update({
          where: { id: returnId },
          data: {
            lockedAfterPayment: true,
            stateJson: updatedState
          }
        });

        const pdf = await renderReturnPdf(userId, updatedState);
        await prisma.document.create({
          data: {
            userId,
            kind: 'draft_pdf',
            url: pdf.key,
            checksum: '',
            expiresAt: new Date(Date.now() + pdf.expiresIn * 1000)
          }
        });
      }
    }
  }

  return NextResponse.json({ received: true });
}
