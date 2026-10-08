"use client";
import type { z } from "zod";
import type { Portfolio } from "../portfolio/types";
import type { holdingInputSchema, portfolioInputSchema } from "../validation";
import { api } from "./api";

type PortfolioInput = z.input<typeof portfolioInputSchema>;
type HoldingInput = z.input<typeof holdingInputSchema>;

const send = <T,>(url: string, method: string, body?: unknown) =>
  api<T>(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

export const listPortfolios = () => api<Portfolio[]>("/api/portfolios");
export const createPortfolio = async (v: PortfolioInput) => (await send<{ id: string }>("/api/portfolios", "POST", v)).id;
export const updatePortfolio = (id: string, v: PortfolioInput) => send<null>(`/api/portfolios/${id}`, "PATCH", v);
export const deletePortfolio = (id: string) => send<null>(`/api/portfolios/${id}`, "DELETE");
export const addHolding = (portfolioId: string, v: HoldingInput) => send<null>(`/api/portfolios/${portfolioId}/holdings`, "POST", v);
export const updateHolding = (id: string, v: HoldingInput) => send<null>(`/api/holdings/${id}`, "PATCH", v);
export const deleteHolding = (id: string) => send<null>(`/api/holdings/${id}`, "DELETE");
