'use server';

import { redirect } from 'next/navigation';
import { checkPassword, setAdminSession, setGuestSession, clearSession } from '@/lib/auth';

export async function loginAdmin(formData: FormData) {
  const password = String(formData.get('password') ?? '');
  if (!checkPassword(password)) {
    redirect('/login?error=1');
  }
  await setAdminSession();
  redirect('/');
}

export async function enterAsGuest() {
  await setGuestSession();
  redirect('/');
}

export async function logout() {
  await clearSession();
  redirect('/login');
}
