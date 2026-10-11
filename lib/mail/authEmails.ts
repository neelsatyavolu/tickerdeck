import { renderEmail, type EmailCopy, type RenderedEmail } from "./template";

/** The emails Neon Auth asks the app to send: each carries one link (see lib/auth/webhook.ts). */
export const LINK_TYPES = ["forget-password", "email-verification", "sign-in"] as const;
export type LinkType = (typeof LINK_TYPES)[number];

export const AUTH_MAIL_FROM = "TickerQuill <no-reply@n3el.dev>";

const APP = "TickerQuill";
const LINK_HINT = "Or paste this link into your browser:";

type Copy = Pick<EmailCopy, "subject" | "heading" | "body" | "button" | "footer">;

const COPY: Record<LinkType, Copy> = {
  "forget-password": {
    subject: "Reset your TickerQuill password",
    heading: "Reset your password",
    body: "Someone asked to reset the password for your TickerQuill account. If that was you, choose a new one below.",
    button: "Reset password",
    footer: "This link works once and expires soon. If you didn't ask for it, ignore this email and your password stays the same.",
  },
  "email-verification": {
    subject: "Confirm your email for TickerQuill",
    heading: "Confirm your email",
    body: "Confirm this address to finish setting up your TickerQuill account.",
    button: "Confirm email",
    footer: "If you didn't create a TickerQuill account, ignore this email.",
  },
  "sign-in": {
    subject: "Your TickerQuill sign-in link",
    heading: "Sign in",
    body: "Use the button below to sign in to TickerQuill.",
    button: "Sign in",
    footer: "This link works once and expires soon. If you didn't ask for it, ignore this email.",
  },
};

export function isLinkType(value: string): value is LinkType {
  return (LINK_TYPES as readonly string[]).includes(value);
}

export function authEmail(linkType: LinkType, url: string): RenderedEmail {
  return renderEmail({ ...COPY[linkType], app: APP, url, linkHint: LINK_HINT });
}
