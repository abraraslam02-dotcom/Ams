/**
 * Client-side image validation & lightweight resize/compression for Product & Variant Pictures.
 * Supports JPG, JPEG, PNG, and WebP formats.
 */

export interface CompressedProductImage {
  dataUrl: string;
  thumbnailDataUrl: string;
  mimeType: string;
  fileName: string;
}

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

export function validateImageFile(file: File): void {
  const mime = String(file.type || '').toLowerCase();
  const ext = String(file.name || '')
    .split('.')
    .pop()
    ?.toLowerCase();
  const extAllowed = ext && ['jpg', 'jpeg', 'png', 'webp'].includes(ext);

  if (!ALLOWED_MIME_TYPES.has(mime) && !extAllowed) {
    throw new Error('Unsupported image format. Please select a JPG, JPEG, PNG, or WebP picture.');
  }
  if (file.size > 15 * 1024 * 1024) {
    throw new Error('Selected picture exceeds 15 MB. Please choose a smaller image.');
  }
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode the selected image file.'));
    img.src = src;
  });
}

function renderResizedDataUrl(
  img: HTMLImageElement,
  maxSide: number,
  preferredMime: string,
  quality: number
): string {
  const srcW = img.naturalWidth || img.width || 1;
  const srcH = img.naturalHeight || img.height || 1;
  const ratio = Math.min(1, maxSide / Math.max(srcW, srcH));
  const targetW = Math.max(1, Math.round(srcW * ratio));
  const targetH = Math.max(1, Math.round(srcH * ratio));

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Browser canvas rendering is unavailable.');
  }

  // Fill clean white background for transparent PNGs when exporting JPEG
  if (preferredMime === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);
  }
  ctx.drawImage(img, 0, 0, targetW, targetH);

  const outMime =
    preferredMime === 'image/png' || preferredMime === 'image/webp'
      ? preferredMime
      : 'image/jpeg';
  return canvas.toDataURL(outMime, quality);
}

export async function compressImageFileForUpload(file: File): Promise<CompressedProductImage> {
  validateImageFile(file);

  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read the selected image file.'));
    reader.readAsDataURL(file);
  });

  const img = await loadHtmlImage(rawDataUrl);
  const rawMime = String(file.type || '').toLowerCase();
  const outputMime =
    rawMime === 'image/png'
      ? 'image/png'
      : rawMime === 'image/webp'
      ? 'image/webp'
      : 'image/jpeg';

  const dataUrl = renderResizedDataUrl(img, 960, outputMime, 0.85);
  const thumbnailDataUrl = renderResizedDataUrl(img, 140, outputMime === 'image/png' ? 'image/png' : 'image/webp', 0.8);

  return {
    dataUrl,
    thumbnailDataUrl,
    mimeType: outputMime,
    fileName: file.name || 'product.webp',
  };
}

export async function compressCanvasVideoFrame(video: HTMLVideoElement): Promise<CompressedProductImage> {
  const w = video.videoWidth || 640;
  const h = video.videoHeight || 480;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to capture frame from camera.');
  ctx.drawImage(video, 0, 0, w, h);

  const rawDataUrl = canvas.toDataURL('image/jpeg', 0.9);
  const img = await loadHtmlImage(rawDataUrl);

  return {
    dataUrl: renderResizedDataUrl(img, 960, 'image/jpeg', 0.85),
    thumbnailDataUrl: renderResizedDataUrl(img, 140, 'image/jpeg', 0.8),
    mimeType: 'image/jpeg',
    fileName: `camera_capture_${Date.now()}.jpg`,
  };
}
