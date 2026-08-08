/**
 * logo.ts
 * -------
 * The exam paper always shows a logo at the very top of the header.
 *
 * Priority:
 *   1. a logo the user uploaded in this browser (kept in localStorage)
 *   2. the bundled institution logo in /public  (logo.png -> logo.jpg -> logo.svg)
 *
 * Everything is normalised to a PNG data-URL because the .docx exporter
 * (docx -> ImageRun) can only embed raster PNG/JPEG bytes.
 */

/** Files tried, in order, from the /public folder. */
export const DEFAULT_LOGO_CANDIDATES = ['/logo.png', '/logo.jpg', '/logo.jpeg', '/logo.svg'];

/** Draw any image source onto a canvas and return a PNG data-URL. */
export function toPngDataUrl(src: string, maxSize = 512): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width || maxSize, img.height || maxSize));
      const w = Math.max(1, Math.round((img.width || maxSize) * scale));
      const h = Math.max(1, Math.round((img.height || maxSize) * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('canvas unavailable'));
      ctx.drawImage(img, 0, 0, w, h);
      try {
        resolve(canvas.toDataURL('image/png'));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = src;
  });
}

/** Read a File (upload) as a PNG data-URL. */
export function fileToPngDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = async () => {
      const raw = reader.result as string;
      try {
        resolve(await toPngDataUrl(raw));
      } catch {
        resolve(raw); // fall back to the original data-URL
      }
    };
    reader.onerror = () => reject(new Error('could not read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Look for a logo shipped with the app in /public and return it as a PNG
 * data-URL, or null when the institution has not dropped one in yet.
 */
export async function loadBundledLogo(): Promise<string | null> {
  for (const path of DEFAULT_LOGO_CANDIDATES) {
    try {
      const res = await fetch(path, { method: 'GET' });
      if (!res.ok) continue;
      const type = res.headers.get('content-type') || '';
      if (!type.startsWith('image/')) continue; // dev server returns index.html for 404s
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      try {
        const png = await toPngDataUrl(objectUrl);
        return png;
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}
