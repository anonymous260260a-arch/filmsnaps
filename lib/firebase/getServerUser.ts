// lib/firebase/getServerUser.ts
import { cookies } from 'next/headers';
import { verifySessionCookie } from '@/lib/firebase/auth-rest';

export async function getServerUser() {
  const session = (await cookies()).get('session')?.value;
  if (!session) return null;

  try {
    const decoded = await verifySessionCookie(session);
    return decoded; // contains uid, email, etc.
  } catch {
    return null;
  }
}
