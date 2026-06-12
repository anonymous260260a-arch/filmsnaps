const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

export function canSendAuthEmail(key: string) {
  if (typeof window === 'undefined') return false;

  const raw = localStorage.getItem(key);
  if (!raw) return true;

  const last = Number(raw);

  // 🔑 IMPORTANT: invalid value → allow sending
  if (Number.isNaN(last)) {
    localStorage.removeItem(key);
    return true;
  }

  return Date.now() - last > COOLDOWN_MS;
}

export function markAuthEmailSent(key: string) {
  if (typeof window === 'undefined') return;

  localStorage.setItem(key, Date.now().toString());
}
