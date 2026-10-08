export class UpstreamError extends Error {
  constructor(
    public readonly source: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

export async function fetchJson<T>(
  source: string,
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = 10_000, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  } catch (err) {
    const reason = err instanceof Error && err.name === "TimeoutError" ? "timed out" : "unreachable";
    throw new UpstreamError(source, 0, `${source} ${reason}`);
  }
  if (!res.ok) {
    const limited = res.status === 429 ? " (rate limited)" : "";
    throw new UpstreamError(source, res.status, `${source} returned ${res.status}${limited}`);
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new UpstreamError(source, res.status, `${source} sent invalid JSON`);
  }
}
