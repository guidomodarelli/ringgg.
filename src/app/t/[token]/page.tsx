import { notFound } from 'next/navigation';
import { Visitor } from '@/components/visitor';
import { chatSettings } from '@/server/chat';
import { getDatabase } from '@/server/database';
import { publicHome } from '@/server/doorbell';
import { AppError } from '@/server/errors';

export const dynamic = 'force-dynamic';
export default async function DoorPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const home = await publicHome(await getDatabase(), token).catch((error: unknown) => {
    if (error instanceof AppError && error.code === 'INVALID_DOORBELL') return null;
    throw error;
  });
  if (!home) notFound();
  return <Visitor home={home} token={token} chat={chatSettings() !== null} />;
}
