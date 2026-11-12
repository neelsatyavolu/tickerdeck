import { deriveKey, seal, unseal } from "../ai/seal";

// A Plaid access token reads a brokerage account for as long as the link
// lives, so it is encrypted before it reaches the database and bound to the
// user and link it belongs to: a row copied onto another user won't open.

const context = (userId: string, itemId: string) => `plaid:${userId}:${itemId}`;
const key = (tokenKey: string) => deriveKey(tokenKey, "plaid-access-token");

export function sealToken(tokenKey: string, userId: string, itemId: string, accessToken: string): string {
  return seal(key(tokenKey), accessToken, context(userId, itemId));
}

/** The access token, or null when it was sealed for someone else, with another key, or tampered with. */
export function openToken(tokenKey: string, userId: string, itemId: string, sealed: string): string | null {
  return unseal(key(tokenKey), sealed, context(userId, itemId));
}
