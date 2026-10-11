// Client-side resize for progress photos, so a 12MP camera shot (several MB)
// becomes a small, consistent JPEG before it ever hits the network — keeps
// uploads fast and keeps the database small over years of weigh-ins.

const DEFAULT_MAX_DIM = 1280;
const DEFAULT_MAX_BYTES = 900_000; // well under the server's 6MB body limit

/**
 * Resize/re-encode an image file down to a target byte size. Always
 * re-encodes as JPEG, which also sidesteps format quirks (HEIC, odd PNGs)
 * from phone cameras — the server only has to deal with one input shape.
 * `imageOrientation: 'from-image'` applies the photo's EXIF rotation so a
 * portrait phone photo doesn't come out sideways.
 */
export async function resizeImage(file, { maxDim = DEFAULT_MAX_DIM, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  let { width, height } = bitmap;
  const scale = Math.min(1, maxDim / Math.max(width, height));
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  let quality = 0.85;
  let blob = await toBlob(canvas, quality);
  while (blob.size > maxBytes && quality > 0.4) {
    quality -= 0.1;
    blob = await toBlob(canvas, quality);
  }
  return { blob, width, height };
}

function toBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/** Blob -> base64 data URL, the shape the POST /api/photos body expects. */
export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
