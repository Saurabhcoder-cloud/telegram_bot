import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { ReturnState } from '@/shared';
import { nextQuestions } from '@/lib/qa';

const schema = z.object({
  return_state: z.any()
});

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const state = (parsed.data.return_state ?? {}) as ReturnState;
  const response = nextQuestions(state);

  return NextResponse.json(response);
}
