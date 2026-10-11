import { describe, expect, it } from "vitest";
import { escapeHtml, renderEmail, type EmailCopy } from "./template";

const copy: EmailCopy = {
  app: "TickerQuill",
  subject: "Reset your TickerQuill password",
  heading: "Reset your password",
  body: "Someone asked to reset the password for your account.",
  button: "Reset password",
  url: "https://auth.example/reset-password/abc?callbackURL=https%3A%2F%2Fsite.example%2Flogin%2Freset&x=1",
  linkHint: "Or paste this link into your browser:",
  footer: "This link works once and expires soon.",
};

describe("escapeHtml", () => {
  it("escapes the five characters that can break out of text or an attribute", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe("&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
  });
});

describe("renderEmail", () => {
  it("returns the subject as given and puts every piece of copy in the HTML", () => {
    const mail = renderEmail(copy);
    expect(mail.subject).toBe(copy.subject);
    expect(mail.html).toMatch(/^<!doctype html>\n<html lang="en">/);
    for (const text of [copy.heading, copy.body, copy.button, copy.linkHint, copy.footer]) expect(mail.html).toContain(text);
    expect(mail.html).toContain(`<title>${copy.subject}</title>`);
  });

  it("links the button and the written-out link to the escaped URL", () => {
    const { html } = renderEmail(copy);
    const escaped = copy.url.replace(/&/g, "&amp;");
    expect(html.split(`href="${escaped}"`)).toHaveLength(3);
    expect(html).not.toContain("Freset&x=1");
  });

  it("keeps the approved palette and never uses pure black or white", () => {
    const { html } = renderEmail(copy);
    for (const color of ["#0E0E0D", "#F2F0EA", "#A9A8A3", "#757470", "#252523", "#4C8DFF"]) expect(html).toContain(color);
    expect(html).not.toMatch(/#000000|#000;|#fff;|#ffffff/i);
  });

  it("escapes hostile values everywhere they appear", () => {
    const hostile = `"><script>alert(1)</script><img src=x onerror='x'>`;
    const { html } = renderEmail({ ...copy, app: hostile, subject: hostile, heading: hostile, body: hostile, button: hostile, url: `https://x.test/?q=${hostile}`, linkHint: hostile, footer: hostile, lang: hostile });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toMatch(/="[^"]*"><script/);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("writes a plain-text version with the link in full", () => {
    const { text } = renderEmail(copy);
    expect(text).toBe(["TICKERQUILL", copy.heading, copy.body, `Reset password: ${copy.url}`, copy.footer].join("\n\n"));
    expect(text).not.toMatch(/<[a-z]/i);
  });

  it("uses the given language tag", () => {
    expect(renderEmail({ ...copy, lang: "de" }).html).toContain('<html lang="de">');
  });
});
