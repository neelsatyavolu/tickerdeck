import "server-only";
import { UserFacingError } from "../errors";
import { PlaidError, type PlaidGateway } from "./client";
import { mapHoldings } from "./map";
import { deleteItem, findItem, hasInstitution, insertItem, markItemFailed, replaceHoldings, type StoredItem } from "./repo";
import { openToken, sealToken } from "./tokens";
import type { ItemStatus, SyncResult } from "./types";

// Linking, syncing and unlinking a brokerage: Plaid on one side, the
// database on the other.

export type PlaidContext = { gateway: PlaidGateway; tokenKey: string };

/** Plaid error codes that mean the user has to sign in at the brokerage again. */
const NEEDS_SIGN_IN = new Set(["ITEM_LOGIN_REQUIRED", "ACCESS_NOT_GRANTED", "USER_PERMISSION_REVOKED"]);
/** Plaid no longer knows the link, so there is nothing left to remove there. */
const ALREADY_GONE = new Set(["ITEM_NOT_FOUND", "INVALID_ACCESS_TOKEN"]);

async function itemWithToken(ctx: PlaidContext, userId: string, id: string): Promise<{ item: StoredItem; accessToken: string | null }> {
  const item = await findItem(userId, id);
  if (!item) throw new UserFacingError("Brokerage link not found.", 404);
  return { item, accessToken: openToken(ctx.tokenKey, userId, item.itemId, item.sealedToken) };
}

function unreadable(item: StoredItem): UserFacingError {
  return new UserFacingError(`The saved ${item.institution} link can't be read any more. Unlink it and connect again.`, 409);
}

export async function syncBrokerage(ctx: PlaidContext, userId: string, id: string): Promise<SyncResult> {
  const { item, accessToken } = await itemWithToken(ctx, userId, id);
  if (!accessToken) throw unreadable(item);

  /** Shows the failure on the link (Settings, and the next visit), then reports it. */
  const fail = async (message: string, httpStatus: number, status: ItemStatus = "ok"): Promise<never> => {
    await markItemFailed(userId, id, status, message);
    throw new UserFacingError(message, httpStatus);
  };

  let data;
  try {
    data = await ctx.gateway.getHoldings(accessToken);
  } catch (err) {
    if (!(err instanceof PlaidError)) throw err;
    console.warn(`[plaid] sync failed: ${err.code ?? "no response"}`);
    if (err.code !== null && NEEDS_SIGN_IN.has(err.code)) return fail(`Sign in to ${item.institution} again to keep it in sync.`, 409, "login_required");
    return fail(`Couldn't sync ${item.institution}${err.code ? ` (${err.code})` : ""}. Try again later.`, 502);
  }

  const accounts = mapHoldings(item.institution, data);
  // Not a successful sync: an empty answer must never look like "everything was sold".
  if (accounts.length === 0) return fail(`${item.institution} reported no investment accounts.`, 502);
  try {
    await replaceHoldings(userId, id, accounts);
  } catch (err) {
    if (err instanceof UserFacingError) throw err;
    console.error("[plaid] sync could not be saved", err);
    return fail(`Couldn't save the ${item.institution} positions. Try again later.`, 500);
  }
  return {
    portfolios: accounts.length,
    lots: accounts.reduce((n, a) => n + a.lots.length, 0),
    skipped: accounts.flatMap((a) => a.skipped),
  };
}

export type LinkInput = { publicToken: string; institutionId: string; institutionName: string };
export type LinkResult = { id: string; sync: SyncResult | null; error: string | null };

/**
 * Finishes a Plaid Link session: swaps the one-time public token for an
 * access token, stores it sealed, and pulls the positions. A brokerage that is
 * already linked is refused before the swap, because the swap is what uses up
 * one of the Plaid plan's links.
 */
export async function linkBrokerage(ctx: PlaidContext, userId: string, input: LinkInput): Promise<LinkResult> {
  if (await hasInstitution(userId, input.institutionId)) {
    throw new UserFacingError(`${input.institutionName} is already linked. Use Reconnect instead.`, 409);
  }

  let exchanged;
  try {
    exchanged = await ctx.gateway.exchangePublicToken(input.publicToken);
  } catch (err) {
    if (!(err instanceof PlaidError)) throw err;
    console.warn(`[plaid] token exchange failed: ${err.code ?? "no response"}`);
    throw new UserFacingError(`Couldn't finish linking ${input.institutionName}${err.code ? ` (${err.code})` : ""}. Try again.`, 502);
  }

  let id: string;
  try {
    id = await insertItem(userId, {
      itemId: exchanged.itemId,
      sealedToken: sealToken(ctx.tokenKey, userId, exchanged.itemId, exchanged.accessToken),
      institutionId: input.institutionId,
      institutionName: input.institutionName,
    });
  } catch (err) {
    // Nothing was saved, so don't leave a live link at Plaid that nobody can use.
    await ctx.gateway.removeItem(exchanged.accessToken).catch((e) => console.warn(`[plaid] cleanup failed: ${e instanceof PlaidError ? e.code : "unknown"}`));
    throw err;
  }

  try {
    return { id, sync: await syncBrokerage(ctx, userId, id), error: null };
  } catch (err) {
    if (!(err instanceof UserFacingError)) throw err;
    return { id, sync: null, error: err.message };
  }
}

async function linkToken(ctx: PlaidContext, input: Parameters<PlaidGateway["createLinkToken"]>[0]): Promise<string> {
  try {
    return await ctx.gateway.createLinkToken(input);
  } catch (err) {
    if (!(err instanceof PlaidError)) throw err;
    console.warn(`[plaid] link token failed: ${err.code ?? "no response"}`);
    // Plaid's own message names the setting to fix (for example an unregistered redirect address).
    throw new UserFacingError(`Plaid couldn't start the link: ${err.message}`, 502);
  }
}

/** A Link token for connecting a new brokerage. */
export function connectToken(ctx: PlaidContext, userId: string, redirectUri: string): Promise<string> {
  return linkToken(ctx, { userId, redirectUri });
}

/** A Link token that signs in again to an existing link (Plaid's update mode) instead of creating a new one. */
export async function reconnectToken(ctx: PlaidContext, userId: string, id: string, redirectUri: string): Promise<string> {
  const { item, accessToken } = await itemWithToken(ctx, userId, id);
  if (!accessToken) throw unreadable(item);
  return linkToken(ctx, { userId, redirectUri, accessToken });
}

/** Removes the link at Plaid, then here. Its portfolios stay as ordinary ones. */
export async function unlinkBrokerage(ctx: PlaidContext, userId: string, id: string): Promise<void> {
  const { item, accessToken } = await itemWithToken(ctx, userId, id);
  if (accessToken) {
    try {
      await ctx.gateway.removeItem(accessToken);
    } catch (err) {
      if (!(err instanceof PlaidError)) throw err;
      if (err.code === null || !ALREADY_GONE.has(err.code)) {
        console.warn(`[plaid] unlink failed: ${err.code ?? "no response"}`);
        throw new UserFacingError(`Couldn't unlink ${item.institution} at Plaid${err.code ? ` (${err.code})` : ""}. Try again.`, 502);
      }
    }
  }
  await deleteItem(userId, id);
}
