import { describe, expect, it } from "vitest";
import { fitImages, IMAGE_DATA_URL, MAX_IMAGE_CHARS } from "./images";
import { chatRequestSchema } from "@/lib/validation";

const png = "data:image/png;base64,iVBORw0KGgo=";

describe("fitImages", () => {
  it("keeps every image when they fit", () => {
    const messages = [{ content: "a", images: ["12345"] }, { content: "b" }, { content: "c", images: ["12345"] }];
    expect(fitImages(messages, 10)).toEqual(messages);
  });

  it("drops images from the oldest messages first, and from everything older than the first that does not fit", () => {
    const messages = [{ content: "a", images: ["1"] }, { content: "b", images: ["123456"] }, { content: "c", images: ["12345"] }];
    const fitted = fitImages(messages, 10);
    expect(fitted.map((m) => m.images)).toEqual([undefined, undefined, ["12345"]]);
    expect(fitted.map((m) => m.content)).toEqual(["a", "b", "c"]);
  });

  it("does not change the messages it was given", () => {
    const messages = [{ content: "a", images: ["123456"] }];
    fitImages(messages, 1);
    expect(messages[0].images).toEqual(["123456"]);
  });
});

describe("chat request images", () => {
  const request = (images: string[]) => ({ provider: "codex", messages: [{ role: "user", content: "what is this?", images }] });

  it("accepts image data URLs", () => {
    expect(IMAGE_DATA_URL.test(png)).toBe(true);
    expect(chatRequestSchema.safeParse(request([png])).success).toBe(true);
  });

  it("rejects links, other file types, oversized images and too many images", () => {
    expect(chatRequestSchema.safeParse(request(["https://example.com/a.png"])).success).toBe(false);
    expect(chatRequestSchema.safeParse(request(["data:image/svg+xml;base64,AAAA"])).success).toBe(false);
    expect(chatRequestSchema.safeParse(request([`data:image/png;base64,${"A".repeat(MAX_IMAGE_CHARS)}`])).success).toBe(false);
    expect(chatRequestSchema.safeParse(request([png, png, png, png, png])).success).toBe(false);
  });
});
