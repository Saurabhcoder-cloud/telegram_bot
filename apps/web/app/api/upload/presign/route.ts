import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getAuthContext } from '@/lib/auth';
import { bucket, s3 } from '@/lib/storage';

const schema = z.object({
  ext: z.enum(['pdf', 'jpg', 'jpeg', 'png']),
  size: z.number().max(10 * 1024 * 1024)
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

  const fileKey = `${auth.userId}/${crypto.randomUUID()}.${parsed.data.ext}`;
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: fileKey,
    ContentType:
      parsed.data.ext === 'pdf'
        ? 'application/pdf'
        : `image/${parsed.data.ext === 'jpg' ? 'jpeg' : parsed.data.ext}`,
    ContentLength: parsed.data.size
  });

  const url = await getSignedUrl(s3, command, { expiresIn: 60 * 5 });

  return NextResponse.json({ url, fileKey });
}
