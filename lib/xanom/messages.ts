// What the sign-in and settings pages say when a Xanom flow comes back with a code.

const MESSAGES: Record<string, string> = {
  linked: "Your Xanom account is linked. You can sign in with it from now on.",
  access_denied: "Xanom sign-in was cancelled.",
  login_required: "Sign in to Xanom to continue.",
  no_flow: "The Xanom sign-in took too long or started in another browser. Try again.",
  bad_flow: "The Xanom sign-in took too long or started in another browser. Try again.",
  session_changed: "You signed out or switched accounts while linking. Sign in and try again.",
  sub_taken: "That Xanom account is already linked to another TickerQuill account.",
  already_linked: "This TickerQuill account is already linked to a different Xanom account.",
  email_mismatch: "Your Xanom account uses a different email. Use \"Link an existing Xanom account\" instead.",
  email_linked_elsewhere: "A TickerQuill account with this email is already linked to a different Xanom account.",
};

const FALLBACK = "Xanom sign-in didn't work. Try again, or use your email and password.";

export function xanomMessage(code: string | null): string | null {
  if (!code) return null;
  return MESSAGES[code] ?? FALLBACK;
}

export const isSuccess = (code: string | null) => code === "linked";
