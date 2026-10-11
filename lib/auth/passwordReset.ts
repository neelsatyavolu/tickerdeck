// Decisions behind the forgot-password pages (app/login/forgot, app/login/reset), kept
// out of the components so they can be tested. Both pages sit under /login because that
// is the only path the auth proxy leaves open to signed-out visitors.

export const FORGOT_PATH = "/login/forgot";
export const RESET_PATH = "/login/reset";
/** Where the reset page sends the user once the password is changed. */
export const LOGIN_AFTER_RESET = "/login?reset=done";
/** The same minimum the sign-up form enforces. */
export const MIN_PASSWORD_LENGTH = 8;

export const SENT_NOTICE = "If an account exists for that address, a reset link is on its way.";
export const NETWORK_MESSAGE = "Could not reach the sign-in service. Try again.";
export const RATE_LIMIT_MESSAGE = "Too many attempts. Wait a minute, then try again.";

type Params = Pick<URLSearchParams, "get">;

/** A call the sign-in service answered with an error status. Anything else that went wrong never got an answer. */
type Refusal = { status: number; code?: string; message?: string };

function refusal(error: unknown): Refusal | null {
  if (typeof error !== "object" || error === null) return null;
  const { status, code, message } = error as Record<string, unknown>;
  if (typeof status !== "number") return null;
  return { status, code: typeof code === "string" ? code : undefined, message: typeof message === "string" ? message : undefined };
}

/**
 * Runs one auth client call and returns what went wrong, or null. Better Auth's client
 * returns `{ error }`, but Neon's wrapper throws on any answer that is not 2xx, so both
 * are treated alike here.
 */
export async function errorOf(call: () => Promise<{ error: unknown }>): Promise<unknown> {
  try {
    return (await call()).error ?? null;
  } catch (thrown) {
    return thrown ?? new Error("The auth client threw nothing");
  }
}

/** `redirectTo` for a reset request: the emailed link ends up here with `?token=` or `?error=`. */
export function resetRedirect(origin: string): string {
  return `${origin}${RESET_PATH}`;
}

/**
 * The error to show after asking for a reset link, or null to show SENT_NOTICE.
 * Any answer other than rate limiting could depend on whether the account exists
 * (a failed email, for one), so those stay silent and the form cannot be used to
 * find out which addresses are registered.
 */
export function requestFailure(error: unknown): string | null {
  if (error === null) return null;
  const refused = refusal(error);
  if (!refused) return NETWORK_MESSAGE;
  return refused.status === 429 ? RATE_LIMIT_MESSAGE : null;
}

/** The token from the emailed link, or null when it is missing or the service already rejected it. */
export function readResetToken(params: Params): string | null {
  if (params.get("error")) return null;
  return params.get("token") || null;
}

/** Better Auth answers INVALID_TOKEN; Neon's client renames that to bad_jwt. */
const isRejectedToken = ({ code, message }: Refusal) => code === "INVALID_TOKEN" || code === "bad_jwt" || /invalid token/i.test(message ?? "");

/** Why the new password was not saved: the link no longer works, or a message to show. */
export function resetFailure(error: unknown): { expired: true } | { expired: false; message: string } {
  const refused = refusal(error);
  if (!refused) return { expired: false, message: NETWORK_MESSAGE };
  if (isRejectedToken(refused)) return { expired: true };
  if (refused.status === 429) return { expired: false, message: RATE_LIMIT_MESSAGE };
  return { expired: false, message: refused.message || "Could not change the password. Try again." };
}

/** The line the login page shows when the user arrives from a finished reset. */
export function passwordChangedNotice(params: Params): string | null {
  return params.get("reset") === "done" ? "Password changed. Sign in with the new one." : null;
}
