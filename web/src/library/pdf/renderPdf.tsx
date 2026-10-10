/**
 * Builds the PDF reading list in the browser. Loaded with a dynamic import from the export sheet,
 * so the PDF engine (react-pdf) never weighs on the app's first load.
 */
import { pdf } from '@react-pdf/renderer';
import { Buffer } from 'buffer';
import kalam from '@fontsource/kalam/files/kalam-latin-400-normal.woff?url';
import kalamExt from '@fontsource/kalam/files/kalam-latin-ext-400-normal.woff?url';
import nunitoCyrillic400 from '@fontsource/nunito/files/nunito-cyrillic-400-normal.woff?url';
import nunitoCyrillic700 from '@fontsource/nunito/files/nunito-cyrillic-700-normal.woff?url';
import nunitoCyrillic800 from '@fontsource/nunito/files/nunito-cyrillic-800-normal.woff?url';
import nunito400 from '@fontsource/nunito/files/nunito-latin-400-normal.woff?url';
import nunito700 from '@fontsource/nunito/files/nunito-latin-700-normal.woff?url';
import nunito800 from '@fontsource/nunito/files/nunito-latin-800-normal.woff?url';
import nunitoExt400 from '@fontsource/nunito/files/nunito-latin-ext-400-normal.woff?url';
import nunitoExt700 from '@fontsource/nunito/files/nunito-latin-ext-700-normal.woff?url';
import nunitoExt800 from '@fontsource/nunito/files/nunito-latin-ext-800-normal.woff?url';
import nunitoViet400 from '@fontsource/nunito/files/nunito-vietnamese-400-normal.woff?url';
import nunitoViet700 from '@fontsource/nunito/files/nunito-vietnamese-700-normal.woff?url';
import nunitoViet800 from '@fontsource/nunito/files/nunito-vietnamese-800-normal.woff?url';
import youngSerif from '@fontsource/young-serif/files/young-serif-latin-400-normal.woff?url';
import youngSerifExt from '@fontsource/young-serif/files/young-serif-latin-ext-400-normal.woff?url';
import type { Book } from '@booktrap/shared';
import { hashString } from '../covers';
import { registerPdfFonts } from './fonts';
import { ReadingListPdf } from './ReadingListPdf';

/** Covers are drawn 74pt wide; three times that keeps them sharp in print and the file small. */
const COVER_PIXELS_WIDE = 222;
const PARALLEL_COVERS = 6;

/**
 * Re-encodes a cover as a small JPEG data URL. This also turns WebP (which react-pdf can't draw)
 * into JPEG. Null when the image can't be decoded, so the book gets its bookcloth plate.
 */
async function toJpegDataUrl(blob: Blob): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, COVER_PIXELS_WIDE / bitmap.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return null;
    // JPEG has no transparency: transparent corners would print black, so they get the paper colour.
    context.fillStyle = '#fbfdfc';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch {
    return null;
  }
}

/** Fetches a book's cover; `version` identifies the cover URL so a changed cover is never served from cache. */
export type CoverFetcher = (bookId: string, version: string) => Promise<Blob | null>;

/** A short, stable fingerprint of a cover URL. */
const coverVersion = (url: string) => hashString(url).toString(36);
export type PdfProgress = (done: number, total: number) => void;

async function loadCovers(books: Book[], fetchCover: CoverFetcher, onProgress: PdfProgress, signal?: AbortSignal): Promise<Map<string, string>> {
  const covers = new Map<string, string>();
  const queue = books.filter((book) => book.coverUrl);
  const total = queue.length;
  let done = 0;
  onProgress(0, total);
  const worker = async () => {
    for (let book = queue.shift(); book; book = queue.shift()) {
      if (signal?.aborted) throw signal.reason;
      const blob = await fetchCover(book.id, coverVersion(book.coverUrl!));
      const dataUrl = blob && (await toJpegDataUrl(blob));
      if (dataUrl) covers.set(book.id, dataUrl);
      onProgress(++done, total);
    }
  };
  await Promise.all(Array.from({ length: PARALLEL_COVERS }, worker));
  return covers;
}

/** US and Canadian readers print on Letter; everyone else on A4. */
function pageSizeFor(locale: string): 'A4' | 'LETTER' {
  return /-(US|CA)$/i.test(locale) ? 'LETTER' : 'A4';
}

export async function renderReadingListPdf(
  books: Book[],
  fetchCover: CoverFetcher,
  { onProgress = () => {}, signal }: { onProgress?: PdfProgress; signal?: AbortSignal } = {},
): Promise<Blob> {
  // react-pdf's image loader checks Buffer.isBuffer after every image; browsers have no Buffer.
  globalThis.Buffer ??= Buffer;
  registerPdfFonts({
    youngSerif: { latin: youngSerif, latinExt: youngSerifExt },
    kalam: { latin: kalam, latinExt: kalamExt },
    nunito: {
      latin: { 400: nunito400, 700: nunito700, 800: nunito800 },
      latinExt: { 400: nunitoExt400, 700: nunitoExt700, 800: nunitoExt800 },
      cyrillic: { 400: nunitoCyrillic400, 700: nunitoCyrillic700, 800: nunitoCyrillic800 },
      vietnamese: { 400: nunitoViet400, 700: nunitoViet700, 800: nunitoViet800 },
    },
  });
  const covers = await loadCovers(books, fetchCover, onProgress, signal);
  if (signal?.aborted) throw signal.reason;
  const doc = <ReadingListPdf books={books} covers={covers} createdAt={new Date()} pageSize={pageSizeFor(navigator.language)} />;
  return pdf(doc).toBlob();
}
