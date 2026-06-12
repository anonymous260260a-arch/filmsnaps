import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSessionCookie } from '@/lib/firebase/auth-rest';

export async function POST(req: Request) {
  const { idToken } = await req.json();

  if (!idToken) {
    return NextResponse.json(
      { success: false, message: 'ID token missing' },
      { status: 400 }
    );
  }

  try {
    const expiresIn = 60 * 60 * 24 * 5 * 1000; // 5 days
    const sessionCookie = await createSessionCookie(idToken, expiresIn);

    (await cookies()).set('session', sessionCookie, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Session creation failed:', err);
    return NextResponse.json(
      { success: false, message: err.message },
      { status: 500 }
    );
  }
}
