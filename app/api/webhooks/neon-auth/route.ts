import { handleAuthWebhook } from "@/lib/auth/webhook";
import { createKeyLookup } from "@/lib/auth/webhookSignature";
import { required } from "@/lib/env";
import { AUTH_MAIL_FROM } from "@/lib/mail/authEmails";
import { sendEmail } from "@/lib/mail/send";

export const dynamic = "force-dynamic";

const jwksUrl = () => `${required("NEON_AUTH_BASE_URL").replace(/\/+$/, "")}/.well-known/jwks.json`;
const findKey = createKeyLookup(jwksUrl, (input, init) => fetch(input, init), Date.now);

// POST /api/webhooks/neon-auth — Neon Auth hands over the emails it would otherwise send
// (password reset, email confirmation, sign-in link). Signed by Neon, so no session is involved.
// It lives outside /api/auth, which is proxied to Neon. Setup is in the README.
export function POST(request: Request) {
  return handleAuthWebhook(request, {
    findKey,
    now: Date.now,
    send: (mail) => sendEmail(mail, { apiKey: required("RESEND_API_KEY"), from: AUTH_MAIL_FROM }),
  });
}
