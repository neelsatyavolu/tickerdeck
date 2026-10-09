import { describe, expect, it } from "vitest";
import { createSerialQueue } from "./serial";

describe("createSerialQueue", () => {
  it("finishes jobs in submission order even when earlier ones are slower", async () => {
    const run = createSerialQueue();
    const done: number[] = [];
    const wait = (ms: number, n: number) => () => new Promise<void>((r) => setTimeout(() => { done.push(n); r(); }, ms));
    await Promise.all([run(wait(30, 1)), run(wait(1, 2)), run(wait(10, 3))]);
    expect(done).toEqual([1, 2, 3]);
  });

  it("keeps going after a failure", async () => {
    const run = createSerialQueue();
    const failed = run(() => Promise.reject(new Error("nope")));
    const ok = run(() => Promise.resolve("next"));
    await expect(failed).rejects.toThrow("nope");
    await expect(ok).resolves.toBe("next");
  });
});
