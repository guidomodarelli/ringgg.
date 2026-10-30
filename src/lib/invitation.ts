/** Ringgg does not send email: the resident who authorized someone shares this message themselves. */
export function invitationMessage(homeName: string, email: string, origin: string) {
  return `Te sumé al timbre de ${homeName} en Ringgg. Creá tu cuenta con ${email} en ${origin}/sign-in y verificá tu correo para entrar.`;
}

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

/**
 * The system share sheet where it exists (phones, so WhatsApp is one tap away); otherwise the
 * clipboard. Closing the share sheet is not a failure.
 */
export async function shareInvitation(text: string): Promise<ShareOutcome> {
  if (typeof navigator.share === 'function') {
    try { await navigator.share({ text }); return 'shared'; }
    catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'; }
  }
  try { await navigator.clipboard.writeText(text); return 'copied'; }
  catch { return 'failed'; }
}
