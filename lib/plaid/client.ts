import "server-only";
import { Configuration, CountryCode, InvestmentAccountSubtype, PlaidApi, PlaidEnvironments, Products } from "plaid";
import type { PlaidConfig } from "./config";
import type { PlaidHoldingsData } from "./map";

// The four Plaid calls tickerdeck makes, behind an interface so the sync
// logic can be tested without the network.

export type PlaidGateway = {
  /** A token that opens Plaid Link: for a new brokerage, or (with accessToken) to sign in again to an existing link. */
  createLinkToken(input: { userId: string; redirectUri: string; accessToken?: string }): Promise<string>;
  exchangePublicToken(publicToken: string): Promise<{ accessToken: string; itemId: string }>;
  getHoldings(accessToken: string): Promise<PlaidHoldingsData>;
  removeItem(accessToken: string): Promise<void>;
};

/** A failed Plaid call. `code` is Plaid's error_code, or null when Plaid never answered. */
export class PlaidError extends Error {
  constructor(public readonly code: string | null, message: string) {
    super(message);
    this.name = "PlaidError";
  }
}

/**
 * The SDK throws axios errors that carry the request, including our secret
 * and the access token. Keep only Plaid's own code and message so nothing
 * sensitive can end up in a log.
 */
export function toPlaidError(err: unknown): PlaidError {
  const data = (err as { response?: { data?: { error_code?: unknown; error_message?: unknown } } } | null)?.response?.data;
  if (typeof data?.error_code === "string") return new PlaidError(data.error_code, typeof data.error_message === "string" ? data.error_message : data.error_code);
  return new PlaidError(null, "Plaid could not be reached.");
}

export function plaidGateway(config: PlaidConfig): PlaidGateway {
  const api = new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[config.env],
      baseOptions: { headers: { "PLAID-CLIENT-ID": config.clientId, "PLAID-SECRET": config.secret } },
    }),
  );
  const call = async <T>(request: () => Promise<{ data: T }>): Promise<T> => {
    try {
      return (await request()).data;
    } catch (err) {
      throw toPlaidError(err);
    }
  };

  return {
    async createLinkToken({ userId, redirectUri, accessToken }) {
      const base = { user: { client_user_id: userId }, client_name: "tickerdeck", language: "en", country_codes: [CountryCode.Us], redirect_uri: redirectUri };
      // Signing in again reuses the link's products; a new link asks for investment accounts only.
      const request = accessToken
        ? { ...base, access_token: accessToken }
        : { ...base, products: [Products.Investments], account_filters: { investment: { account_subtypes: [InvestmentAccountSubtype.All] } } };
      return (await call(() => api.linkTokenCreate(request))).link_token;
    },
    async exchangePublicToken(publicToken) {
      const data = await call(() => api.itemPublicTokenExchange({ public_token: publicToken }));
      return { accessToken: data.access_token, itemId: data.item_id };
    },
    async getHoldings(accessToken) {
      const { accounts, holdings, securities } = await call(() => api.investmentsHoldingsGet({ access_token: accessToken }));
      return { accounts, holdings, securities };
    },
    async removeItem(accessToken) {
      await call(() => api.itemRemove({ access_token: accessToken }));
    },
  };
}
