import sharp from "sharp";

const COVER_SIZE = 500;
const OPEN_LIBRARY_COVER_URL = "https://covers.openlibrary.org/b/id";
const IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"];

export interface DownloadCoverOptions {
  coverUrl?: string;
  coverId?: number;
  fetchFn?: typeof fetch;
}

export async function downloadAndResizeCover(
  options: DownloadCoverOptions,
): Promise<Buffer | null> {
  const { coverUrl, coverId, fetchFn = fetch } = options;

  let imageUrl: string | null = null;

  if (coverUrl) {
    imageUrl = coverUrl;
  } else if (coverId && coverId > 0) {
    imageUrl = `${OPEN_LIBRARY_COVER_URL}/${coverId}-L.jpg`;
  }

  if (!imageUrl) return null;

  try {
    const response = await fetchFn(imageUrl);
    if (!response.ok) return null;

    const contentType = response.headers.get("content-type");
    if (contentType && !IMAGE_CONTENT_TYPES.some((t) => contentType.includes(t))) {
      return null;
    }

    const imageBuffer = Buffer.from(await response.arrayBuffer());

    const resized = await sharp(imageBuffer)
      .resize(COVER_SIZE, COVER_SIZE, { fit: "cover" })
      .jpeg({ quality: 85 })
      .toBuffer();

    return resized;
  } catch {
    return null;
  }
}
