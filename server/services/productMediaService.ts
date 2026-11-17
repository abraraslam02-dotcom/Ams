import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { Request, Response } from 'express';
import { getDatabase } from '../db/connection.ts';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const MAX_DATA_URL_BYTES = 3 * 1024 * 1024; // 3MB compressed limit

export function getProductUploadsDir(): string {
  const dir = path.resolve(process.cwd(), 'data', 'uploads', 'items');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function parseDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } {
  const match = String(dataUrl || '').match(/^data:([a-zA-Z0-9/+.-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    throw new Error('Invalid image format. Expected a valid JPG, JPEG, PNG, or WebP image.');
  }
  const mimeType = match[1].toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error(`Unsupported image format (${mimeType}). Allowed formats: JPG, JPEG, PNG, WebP.`);
  }
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length === 0) {
    throw new Error('Uploaded image file is empty.');
  }
  if (buffer.length > MAX_DATA_URL_BYTES) {
    throw new Error('Image exceeds the maximum 3 MB limit after compression. Please choose a smaller image.');
  }
  return { mimeType: mimeType === 'image/jpg' ? 'image/jpeg' : mimeType, buffer };
}

function writeDiskMirror(imageKey: string, mimeType: string, fullBuf: Buffer, thumbBuf?: Buffer): void {
  try {
    const dir = getProductUploadsDir();
    const ext = MIME_TO_EXT[mimeType] || 'jpg';
    const fullPath = path.join(dir, `${imageKey}.${ext}`);
    fs.writeFileSync(fullPath, fullBuf);
    if (thumbBuf) {
      const thumbPath = path.join(dir, `${imageKey}_thumb.${ext}`);
      fs.writeFileSync(thumbPath, thumbBuf);
    }
  } catch (err) {
    console.warn('[AMS Product Media] Disk mirror write warning:', err);
  }
}

export interface StoredProductImage {
  id: number;
  image_key: string;
  mime_type: string;
  original_filename: string;
  size_bytes: number;
  width: number;
  height: number;
  image_url: string;
  thumbnail_url: string;
}

export function saveProductImage(params: {
  imageDataUrl: string;
  thumbnailDataUrl?: string;
  originalFilename?: string;
  width?: number;
  height?: number;
  createdBy?: string;
}): StoredProductImage {
  const db = getDatabase();
  const parsedMain = parseDataUrl(params.imageDataUrl);
  const parsedThumb = params.thumbnailDataUrl
    ? parseDataUrl(params.thumbnailDataUrl)
    : parsedMain;

  const imageKey = `img_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
  const cleanFilename = String(params.originalFilename || 'product-image')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 120);

  const normalizedMainDataUrl = `data:${parsedMain.mimeType};base64,${parsedMain.buffer.toString('base64')}`;
  const normalizedThumbDataUrl = `data:${parsedThumb.mimeType};base64,${parsedThumb.buffer.toString('base64')}`;

  const result = db
    .prepare(
      `INSERT INTO product_images (
        image_key, mime_type, original_filename, size_bytes, width, height,
        image_data_url, thumbnail_data_url, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      imageKey,
      parsedMain.mimeType,
      cleanFilename,
      parsedMain.buffer.length,
      Math.max(0, Math.round(Number(params.width || 0))),
      Math.max(0, Math.round(Number(params.height || 0))),
      normalizedMainDataUrl,
      normalizedThumbDataUrl,
      String(params.createdBy || 'Super Admin')
    );

  writeDiskMirror(imageKey, parsedMain.mimeType, parsedMain.buffer, parsedThumb.buffer);

  return {
    id: Number(result.lastInsertRowid),
    image_key: imageKey,
    mime_type: parsedMain.mimeType,
    original_filename: cleanFilename,
    size_bytes: parsedMain.buffer.length,
    width: Math.max(0, Math.round(Number(params.width || 0))),
    height: Math.max(0, Math.round(Number(params.height || 0))),
    image_url: `/api/product-images/${imageKey}`,
    thumbnail_url: `/api/product-images/${imageKey}?thumb=1`,
  };
}

export function deleteUnusedProductImage(imageId?: number | null, imageUrl?: string | null): void {
  try {
    const db = getDatabase();
    let imgRow: { id: number; image_key: string; mime_type: string } | undefined;

    if (imageId && Number(imageId) > 0) {
      imgRow = db
        .prepare('SELECT id, image_key, mime_type FROM product_images WHERE id = ?')
        .get(Number(imageId)) as { id: number; image_key: string; mime_type: string } | undefined;
    } else if (imageUrl && String(imageUrl).includes('/api/product-images/')) {
      const rawKey = String(imageUrl).split('/api/product-images/')[1]?.split('?')[0];
      if (rawKey) {
        imgRow = db
          .prepare('SELECT id, image_key, mime_type FROM product_images WHERE image_key = ?')
          .get(rawKey) as { id: number; image_key: string; mime_type: string } | undefined;
      }
    }

    if (!imgRow) return;

    const itemRefs = db
      .prepare('SELECT COUNT(*) as c FROM items WHERE image_id = ?')
      .get(imgRow.id) as { c: number };
    const varRefs = db
      .prepare('SELECT COUNT(*) as c FROM item_variants WHERE image_id = ?')
      .get(imgRow.id) as { c: number };

    if (Number(itemRefs?.c || 0) === 0 && Number(varRefs?.c || 0) === 0) {
      db.prepare('DELETE FROM product_images WHERE id = ?').run(imgRow.id);
      const dir = getProductUploadsDir();
      for (const ext of ['jpg', 'png', 'webp']) {
        const p1 = path.join(dir, `${imgRow.image_key}.${ext}`);
        const p2 = path.join(dir, `${imgRow.image_key}_thumb.${ext}`);
        if (fs.existsSync(p1)) fs.unlinkSync(p1);
        if (fs.existsSync(p2)) fs.unlinkSync(p2);
      }
    }
  } catch (err) {
    console.warn('[AMS Product Media] Cleanup warning:', err);
  }
}

/**
 * Express GET handler mounted at /api/product-images/:imageKey
 * Serves product & variant images cleanly to <img> tags without requiring Bearer headers.
 */
export function handleServeProductImage(req: Request, res: Response): void {
  try {
    const rawKey = String(req.params.imageKey || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!rawKey) {
      res.status(400).json({ success: false, error: 'Invalid image key' });
      return;
    }

    const wantThumb = req.query.thumb === '1' || req.query.thumb === 'true';
    const dir = getProductUploadsDir();

    // Fast path from disk mirror if present
    for (const ext of ['webp', 'jpg', 'png']) {
      const candidate = path.join(dir, wantThumb ? `${rawKey}_thumb.${ext}` : `${rawKey}.${ext}`);
      if (fs.existsSync(candidate)) {
        const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
        res.setHeader('Content-Type', mime);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.sendFile(candidate);
        return;
      }
    }

    // Rehydrate from SQLite product_images if disk file was cleared or synced across devices
    const db = getDatabase();
    const row = db
      .prepare('SELECT mime_type, image_data_url, thumbnail_data_url FROM product_images WHERE image_key = ?')
      .get(rawKey) as { mime_type: string; image_data_url: string; thumbnail_data_url: string } | undefined;

    if (!row) {
      res.status(404).json({ success: false, error: 'Product image not found' });
      return;
    }

    const sourceDataUrl = wantThumb && row.thumbnail_data_url ? row.thumbnail_data_url : row.image_data_url;
    const parsed = parseDataUrl(sourceDataUrl);
    writeDiskMirror(
      rawKey,
      parsed.mimeType,
      wantThumb ? parseDataUrl(row.image_data_url).buffer : parsed.buffer,
      wantThumb ? parsed.buffer : parseDataUrl(row.thumbnail_data_url || row.image_data_url).buffer
    );

    res.setHeader('Content-Type', parsed.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(parsed.buffer);
  } catch (err: unknown) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to serve product image',
    });
  }
}
