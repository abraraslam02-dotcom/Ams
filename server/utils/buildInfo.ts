import fs from 'fs';
import path from 'path';

export const APP_VERSION = '2.12.0-ERP';

export interface BuildMetadata {
  version: string;
  buildId: string;
  buildHash: string;
  builtAt: string | null;
  assetUrls: string[];
}

export function computeSwBuildHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function getBuildMetadata(serveStaticDist?: boolean): BuildMetadata {
  const distPath = path.resolve(process.cwd(), 'dist');
  const distIndexHtml = path.resolve(distPath, 'index.html');
  const isProdStatic =
    typeof serveStaticDist === 'boolean'
      ? serveStaticDist
      : (process.env.NODE_ENV === 'production' ||
          process.env.npm_lifecycle_event === 'start' ||
          String(process.env.K_SERVICE || '').toLowerCase().startsWith('ais-pre-')) &&
        fs.existsSync(distIndexHtml);

  if (isProdStatic) {
    const distVersionFile = path.join(distPath, 'version.json');
    try {
      if (fs.existsSync(distVersionFile)) {
        const parsed = JSON.parse(fs.readFileSync(distVersionFile, 'utf8'));
        if (parsed && typeof parsed.buildHash === 'string' && Array.isArray(parsed.assets)) {
          const validAssets = parsed.assets.filter((assetUrl: unknown) => {
            if (typeof assetUrl !== 'string' || !assetUrl.startsWith('/')) return false;
            const absAsset = path.join(distPath, assetUrl.slice(1));
            return fs.existsSync(absAsset);
          });
          if (validAssets.length > 0) {
            return {
              version: typeof parsed.version === 'string' ? parsed.version : APP_VERSION,
              buildId: String(parsed.buildId || parsed.buildHash),
              buildHash: parsed.buildHash,
              builtAt: typeof parsed.builtAt === 'string' ? parsed.builtAt : null,
              assetUrls: validAssets,
            };
          }
        }
      }
    } catch {
      // fallback below
    }
  }

  const assetUrls: string[] = [];
  let indexHtmlContent = '';
  let builtAt: string | null = null;
  try {
    const assetsDir = path.join(distPath, 'assets');
    if (fs.existsSync(assetsDir)) {
      for (const file of fs.readdirSync(assetsDir).sort()) {
        if (/\.(js|css|woff2?|ttf|svg|png)$/i.test(file)) {
          assetUrls.push(`/assets/${file}`);
        }
      }
    }
    if (fs.existsSync(distIndexHtml)) {
      indexHtmlContent = fs.readFileSync(distIndexHtml, 'utf8');
      builtAt = fs.statSync(distIndexHtml).mtime.toISOString();
    }
  } catch {
    // ignore
  }

  const buildHash =
    isProdStatic && (assetUrls.length > 0 || indexHtmlContent.length > 0)
      ? computeSwBuildHash(`${assetUrls.join('|')}::${indexHtmlContent}`)
      : `dev-${process.pid}`;

  return {
    version: APP_VERSION,
    buildId: buildHash,
    buildHash,
    builtAt,
    assetUrls,
  };
}
