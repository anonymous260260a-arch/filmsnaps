// lib/server/getServerUser.ts
import { cookies } from 'next/headers';
import { adminAuth } from '@/lib/firebase/admin';

export async function getServerUser() {
  const session = (await cookies()).get('session')?.value;
  if (!session) return null;

  try {
    const decoded = await adminAuth.verifySessionCookie(session, true);
    return decoded; // contains uid, email, etc.
  } catch {
    return null;
  }
}
