// Brokerage linking is off unless every Plaid variable is set, and then only
// for one user: a free Plaid plan allows ten links for the whole deployment.

export const PLAID_ENVS = ["sandbox", "production"] as const;
export type PlaidEnv = (typeof PLAID_ENVS)[number];

export type PlaidConfig = { clientId: string; secret: string; tokenKey: string; ownerUserId: string; env: PlaidEnv };

type Env = Record<string, string | undefined>;

const MIN_TOKEN_KEY = 32;

/** The Plaid settings, or null when linking isn't set up. Throws on values that are set but unusable. */
export function readPlaidConfig(env: Env = process.env): PlaidConfig | null {
  const { PLAID_CLIENT_ID: clientId, PLAID_SECRET: secret, PLAID_TOKEN_KEY: tokenKey, PLAID_OWNER_USER_ID: ownerUserId } = env;
  if (!clientId || !secret || !tokenKey || !ownerUserId) return null;
  if (tokenKey.length < MIN_TOKEN_KEY) throw new Error(`PLAID_TOKEN_KEY must be at least ${MIN_TOKEN_KEY} characters`);
  const plaidEnv = env.PLAID_ENV || "sandbox";
  if (!PLAID_ENVS.some((e) => e === plaidEnv)) throw new Error(`PLAID_ENV must be one of: ${PLAID_ENVS.join(", ")}`);
  return { clientId, secret, tokenKey, ownerUserId, env: plaidEnv as PlaidEnv };
}

/** The Plaid settings when this user may link brokerages, otherwise null. */
export function plaidConfigFor(userId: string, env: Env = process.env): PlaidConfig | null {
  const config = readPlaidConfig(env);
  return config && config.ownerUserId === userId ? config : null;
}
