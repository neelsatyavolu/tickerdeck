import { describe, expect, it } from "vitest";
import { moveItem } from "./reorder";

describe("moveItem", () => {
  it("moves items up and down without mutating", () => {
    const list = ["A", "B", "C", "D"];
    expect(moveItem(list, 0, 2)).toEqual(["B", "C", "A", "D"]);
    expect(moveItem(list, 3, 0)).toEqual(["D", "A", "B", "C"]);
    expect(moveItem(list, 1, 1)).toEqual(list);
    expect(moveItem(list, 2, 99)).toEqual(["A", "B", "D", "C"]);
    expect(list).toEqual(["A", "B", "C", "D"]);
  });
});
