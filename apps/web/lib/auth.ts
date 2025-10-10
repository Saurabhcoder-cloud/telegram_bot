import { NextRequest } from 'next/server';

export type AuthContext = {
  userId: string;
  phone?: string | null;
};

export function getAuthContext(req: NextRequest | Request): AuthContext | null {
  const header = req.headers.get('authorization') ?? req.headers.get('Authorization');
  if (!header) return null;
  const token = header.replace('Bearer ', '').trim();
  try {
    const payload = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    if (!payload?.sub) {
      return null;
    }
    return { userId: payload.sub as string, phone: payload.phone };
  } catch (error) {
    return null;
  }
}
