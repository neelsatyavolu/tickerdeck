/** Sends one email through Resend's HTTP API. No SDK: it is a single POST. */

export type Mail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Resend drops a second send with the same key (kept for 24 hours), so a retried request cannot email twice. */
  idempotencyKey?: string;
};

export type MailConfig = {
  /** Resend API key. */
  apiKey: string;
  /** Sender, e.g. `TickerQuill <no-reply@n3el.dev>`. The domain must be verified in Resend. */
  from: string;
};

const RESEND_URL = "https://api.resend.com/emails";
// Neon Auth waits 5 seconds for the webhook that calls this, which may first spend up to
// 1.5 seconds fetching signing keys (lib/auth/webhookSignature.ts).
const SEND_TIMEOUT_MS = 3_000;

export class MailError extends Error {
  constructor(readonly status: number) {
    super(`Resend refused the email (HTTP ${status})`);
    this.name = "MailError";
  }
}

export async function sendEmail(mail: Mail, config: MailConfig, fetchImpl: typeof fetch = fetch): Promise<void> {
  const response = await fetchImpl(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      ...(mail.idempotencyKey ? { "Idempotency-Key": mail.idempotencyKey } : {}),
    },
    body: JSON.stringify({ from: config.from, to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!response.ok) throw new MailError(response.status);
}
