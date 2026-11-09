"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createSerialQueue } from "@/lib/client/serial";
import * as client from "@/lib/client/watchlist";
import type { WatchItem, WatchList } from "@/lib/client/watchlist";

// All of the user's watchlists. The primary list is what "Watch" means by
// default; custom lists are named and optional. Every change is optimistic and
// rolls back (by reloading) if the server refuses.

type Ctx = {
  lists: WatchList[];
  primary: WatchList | null;
  /** The primary list's items (most screens only care about this one). */
  items: WatchItem[];
  loading: boolean;
  error: string | null;
  isWatched: (symbol: string, listId?: string) => boolean;
  listsWith: (symbol: string) => WatchList[];
  add: (symbol: string, name?: string | null, listId?: string) => Promise<void>;
  remove: (symbol: string, listId?: string) => Promise<void>;
  /** Save a list's order (symbols top to bottom). */
  reorder: (symbols: string[], listId?: string) => Promise<void>;
  createList: (name: string) => Promise<string>;
  renameList: (id: string, name: string) => Promise<void>;
  deleteList: (id: string) => Promise<void>;
};

const WatchlistCtx = createContext<Ctx | null>(null);
const saves = createSerialQueue();

function load(): Promise<WatchList[] | Error> {
  return client.listWatchlists().catch((err) => new Error(err instanceof Error ? err.message : "Could not load watchlists."));
}

export function WatchlistProvider({ children }: { children: React.ReactNode }) {
  const [lists, setLists] = useState<WatchList[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((r: WatchList[] | Error) => {
    if (r instanceof Error) setError(r.message);
    else {
      setLists(r);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    load().then((r) => !cancelled && apply(r));
    return () => {
      cancelled = true;
    };
  }, [apply]);

  const primary = lists.find((l) => l.is_primary) ?? null;
  const primaryId = primary?.id;
  const target = useCallback((listId?: string) => listId ?? primaryId, [primaryId]);

  /** Optimistically edit one list, then run the save; reload on failure. */
  const change = useCallback(
    async (listId: string | undefined, edit: (items: WatchItem[]) => WatchItem[], save: () => Promise<unknown>) => {
      const id = target(listId);
      setLists((prev) => prev.map((l) => (l.id === id ? { ...l, items: edit(l.items) } : l)));
      try {
        await saves(save);
      } catch (err) {
        apply(await load());
        throw err;
      }
    },
    [target, apply],
  );

  const add = useCallback(
    (symbol: string, name?: string | null, listId?: string) =>
      change(
        listId,
        (items) => (items.some((i) => i.symbol === symbol) ? items : [...items, { symbol, name: name ?? null, added_at: new Date().toISOString() }]),
        () => client.addToWatchlist(symbol, name, listId),
      ),
    [change],
  );

  const remove = useCallback(
    (symbol: string, listId?: string) => change(listId, (items) => items.filter((i) => i.symbol !== symbol), () => client.removeFromWatchlist(symbol, listId)),
    [change],
  );

  const reorder = useCallback(
    (symbols: string[], listId?: string) =>
      change(
        listId,
        (items) => {
          const bySymbol = new Map(items.map((i) => [i.symbol, i]));
          const ordered = symbols.map((s) => bySymbol.get(s)).filter((i): i is WatchItem => Boolean(i));
          return [...ordered, ...items.filter((i) => !symbols.includes(i.symbol))];
        },
        () => client.reorderWatchlist(symbols, listId),
      ),
    [change],
  );

  const createList = useCallback(
    async (name: string) => {
      const id = await saves(() => client.createWatchlist(name));
      apply(await load());
      return id;
    },
    [apply],
  );

  const renameList = useCallback(
    async (id: string, name: string) => {
      setLists((prev) => prev.map((l) => (l.id === id ? { ...l, name } : l)));
      try {
        await saves(() => client.renameWatchlist(id, name));
      } catch (err) {
        apply(await load());
        throw err;
      }
    },
    [apply],
  );

  const deleteList = useCallback(
    async (id: string) => {
      setLists((prev) => prev.filter((l) => l.id !== id));
      try {
        await saves(() => client.deleteWatchlist(id));
      } catch (err) {
        apply(await load());
        throw err;
      }
    },
    [apply],
  );

  const isWatched = useCallback(
    (symbol: string, listId?: string) => Boolean(lists.find((l) => l.id === target(listId))?.items.some((i) => i.symbol === symbol)),
    [lists, target],
  );
  const listsWith = useCallback((symbol: string) => lists.filter((l) => l.items.some((i) => i.symbol === symbol)), [lists]);

  const value = useMemo(
    () => ({ lists, primary, items: primary?.items ?? [], loading, error, isWatched, listsWith, add, remove, reorder, createList, renameList, deleteList }),
    [lists, primary, loading, error, isWatched, listsWith, add, remove, reorder, createList, renameList, deleteList],
  );
  return <WatchlistCtx.Provider value={value}>{children}</WatchlistCtx.Provider>;
}

export function useWatchlist(): Ctx {
  const ctx = useContext(WatchlistCtx);
  if (!ctx) throw new Error("useWatchlist must be used inside WatchlistProvider");
  return ctx;
}

/**
 * "Watch" toggles the primary list; the ▾ menu adds or removes the symbol from
 * any custom list, or creates a new list with it.
 */
export function WatchButton({ symbol, name }: { symbol: string; name?: string | null }) {
  const { lists, isWatched, add, remove, createList, loading } = useWatchlist();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  const watched = isWatched(symbol);
  const custom = lists.filter((l) => !l.is_primary);
  const inCustom = custom.filter((l) => l.items.some((i) => i.symbol === symbol)).length;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (menu.current && !menu.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const run = async (job: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await job();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update the watchlist.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="watch-split" ref={menu}>
      <button className="btn btn-ghost" onClick={() => run(() => (watched ? remove(symbol) : add(symbol, name)))} disabled={busy || loading} aria-pressed={watched}>
        {watched ? (
          <>
            <span className="dot live" aria-hidden="true" /> Watching
          </>
        ) : (
          "Watch"
        )}
      </button>
      <button className="btn btn-ghost watch-more" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu" aria-label="Add to another watchlist" disabled={loading}>
        {inCustom > 0 ? `+${inCustom}` : ""} ▾
      </button>
      {open && (
        <div className="watch-menu" role="menu">
          <div className="label" style={{ marginBottom: 4 }}>Lists</div>
          {lists.map((l) => {
            const on = l.items.some((i) => i.symbol === symbol);
            return (
              <label key={l.id} className="watch-menu-item" role="menuitemcheckbox" aria-checked={on}>
                <input type="checkbox" checked={on} disabled={busy} onChange={() => run(() => (on ? remove(symbol, l.id) : add(symbol, name, l.id)))} />
                <span>{l.name}</span>
                {l.is_primary && <span className="faint mono" style={{ fontSize: 11 }}>primary</span>}
              </label>
            );
          })}
          <form
            className="row"
            style={{ gap: 6, marginTop: 6 }}
            onSubmit={(e) => {
              e.preventDefault();
              const n = newName.trim();
              if (!n) return;
              run(async () => {
                const id = await createList(n);
                await add(symbol, name, id);
                setNewName("");
              });
            }}
          >
            <input className="input" style={{ padding: "4px 8px", fontSize: 13, flex: 1 }} placeholder="New list…" value={newName} maxLength={60} onChange={(e) => setNewName(e.target.value)} aria-label="New list name" />
            <button className="btn-text" disabled={!newName.trim() || busy}>Create</button>
          </form>
        </div>
      )}
      {error && <span className="error">{error}</span>}
    </div>
  );
}
