"use client";
import type { LinkInput, LinkResult } from "../plaid/sync";
import type { PlaidItem, SyncResult } from "../plaid/types";
import { api, postJson } from "./api";

export const listBrokerages = () => api<{ enabled: boolean; items: PlaidItem[] }>("/api/plaid/items");
/** A token that opens Plaid Link; with itemId, to sign in again to that link. */
export const createLinkToken = async (itemId?: string) => (await postJson<{ linkToken: string }>("/api/plaid/link-token", { itemId })).linkToken;
export const finishLink = (input: LinkInput) => postJson<LinkResult>("/api/plaid/exchange", input);
export const syncBrokerage = (id: string) => api<SyncResult>(`/api/plaid/items/${id}/sync`, { method: "POST" });
export const unlinkBrokerage = (id: string) => api<null>(`/api/plaid/items/${id}`, { method: "DELETE" });
