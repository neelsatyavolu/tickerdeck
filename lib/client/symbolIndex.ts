"use client";
import type { Listing } from "../market/symbolSearch";
import { api } from "./api";

// The listing index for instant search: kept in memory, and in localStorage for
// a day so later visits don't download it again. Missing storage just means a refetch.

const KEY = "tickerdeck.listings.v1";
const TTL = 24 * 60 * 60_000;
let inMemory: Listing[] | null = null;
let loading: Promise<Listing[]> | null = null;

function readStored(): Listing[] | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const { at, list } = JSON.parse(raw) as { at: number; list: Listing[] };
    return Date.now() - at < TTL && Array.isArray(list) && list.length > 1000 ? list : null;
  } catch {
    return null;
  }
}

export function cachedListings(): Listing[] | null {
  if (!inMemory) inMemory = readStored();
  return inMemory;
}

export function loadListings(): Promise<Listing[]> {
  const ready = cachedListings();
  if (ready) return Promise.resolve(ready);
  if (!loading) {
    loading = api<Listing[]>("/api/market/symbols")
      .then((list) => {
        inMemory = list;
        try {
          localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), list }));
        } catch {
          /* storage full or unavailable */
        }
        return list;
      })
      .finally(() => {
        loading = null;
      });
  }
  return loading;
}
