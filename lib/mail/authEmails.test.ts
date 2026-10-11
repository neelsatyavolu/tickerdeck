import { describe, expect, it } from "vitest";
import { AUTH_MAIL_FROM, authEmail, isLinkType, LINK_TYPES } from "./authEmails";

const url = "https://auth.example/reset-password/tok?callbackURL=x";

describe("authEmail", () => {
  it("writes the password reset email", () => {
    const mail = authEmail("forget-password", url);
    expect(mail.subject).toBe("Reset your TickerQuill password");
    expect(mail.text).toBe([
      "TICKERQUILL",
      "Reset your password",
      "Someone asked to reset the password for your TickerQuill account. If that was you, choose a new one below.",
      `Reset password: ${url}`,
      "This link works once and expires soon. If you didn't ask for it, ignore this email and your password stays the same.",
    ].join("\n\n"));
  });

  it("writes the email confirmation email", () => {
    const mail = authEmail("email-verification", url);
    expect(mail.subject).toBe("Confirm your email for TickerQuill");
    expect(mail.text).toBe([
      "TICKERQUILL",
      "Confirm your email",
      "Confirm this address to finish setting up your TickerQuill account.",
      `Confirm email: ${url}`,
      "If you didn't create a TickerQuill account, ignore this email.",
    ].join("\n\n"));
  });

  it("writes the sign-in link email", () => {
    const mail = authEmail("sign-in", url);
    expect(mail.subject).toBe("Your TickerQuill sign-in link");
    expect(mail.text).toBe([
      "TICKERQUILL",
      "Sign in",
      "Use the button below to sign in to TickerQuill.",
      `Sign in: ${url}`,
      "This link works once and expires soon. If you didn't ask for it, ignore this email.",
    ].join("\n\n"));
  });

  it("gives every email the paste-the-link hint and no exclamation marks", () => {
    for (const type of LINK_TYPES) {
      const mail = authEmail(type, url);
      expect(mail.html).toContain("Or paste this link into your browser:");
      expect(mail.subject + mail.text).not.toContain("!");
    }
  });
});

describe("isLinkType", () => {
  it("accepts the three link types Neon sends and nothing else", () => {
    expect(LINK_TYPES.every(isLinkType)).toBe(true);
    expect(isLinkType("delete-account")).toBe(false);
    expect(isLinkType("")).toBe(false);
  });
});

describe("AUTH_MAIL_FROM", () => {
  it("is the verified sender", () => {
    expect(AUTH_MAIL_FROM).toBe("TickerQuill <no-reply@n3el.dev>");
  });
});
