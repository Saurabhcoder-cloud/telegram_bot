import { prisma } from './prisma';

export async function getOrCreateDraftReturn(userId: string) {
  const existing = await prisma.return.findFirst({
    where: { userId, lockedAfterPayment: false },
    orderBy: { createdAt: 'desc' }
  });
  if (existing) return existing;
  return prisma.return.create({
    data: {
      userId,
      type: '1040',
      stateJson: {}
    }
  });
}
