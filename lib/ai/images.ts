// Screenshots the user attaches to a chat message. They travel as data URLs
// inside the chat request, so their size is capped to keep the request under
// the host's 4.5 MB body limit.

export const MAX_IMAGES_PER_MESSAGE = 4;
/** One image, in data-URL characters (about 600 KB of image). */
export const MAX_IMAGE_CHARS = 800_000;
/** Every image in one request, in data-URL characters. */
export const MAX_REQUEST_IMAGE_CHARS = 3_500_000;
export const IMAGE_DATA_URL = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;

/**
 * Keeps the newest messages' images within the request budget. Once a
 * message's images no longer fit, it and every older message are sent as text only.
 */
export function fitImages<T extends { images?: string[] }>(messages: T[], budget = MAX_REQUEST_IMAGE_CHARS): T[] {
  let left = budget;
  const newestFirst = [...messages].reverse().map((m) => {
    if (!m.images?.length) return m;
    const size = m.images.reduce((sum, image) => sum + image.length, 0);
    if (size > left) {
      left = 0;
      return { ...m, images: undefined };
    }
    left -= size;
    return m;
  });
  return newestFirst.reverse();
}
