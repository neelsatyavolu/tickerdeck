import { MAX_IMAGE_CHARS } from "@/lib/ai/images";

// Turns an attached or pasted image into a JPEG data URL small enough to send
// with a chat message, shrinking it further if the first try is still too big.

const LONG_EDGES = [1600, 1200, 800];
const QUALITY = 0.85;

export async function toDataUrl(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    for (const edge of LONG_EDGES) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) break;
      // JPEG has no transparency; without this a transparent screenshot turns black.
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL("image/jpeg", QUALITY);
      if (url.length <= MAX_IMAGE_CHARS) return url;
    }
  } finally {
    bitmap.close();
  }
  throw new Error("That image is too large to send.");
}
