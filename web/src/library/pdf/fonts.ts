import { Font } from '@react-pdf/renderer';

type Weights = { 400: string; 700: string; 800: string };

export interface PdfFontSources {
  youngSerif: { latin: string; latinExt: string };
  kalam: { latin: string; latinExt: string };
  nunito: { latin: Weights; latinExt: Weights; cyrillic: Weights; vietnamese: Weights };
}

/**
 * Each face is a list: react-pdf falls back glyph by glyph, so a Polish author's "ł" or a Russian
 * title still prints. Young Serif and Kalam have no Cyrillic, so Nunito's stands in for both.
 * (No CJK face is bundled: it would add megabytes to every PDF.)
 */
export const PDF_FONTS = {
  display: ['Young Serif', 'Young Serif Ext', 'Nunito Cyrillic', 'Nunito Vietnamese'],
  body: ['Nunito', 'Nunito Ext', 'Nunito Cyrillic', 'Nunito Vietnamese'],
  hand: ['Kalam', 'Kalam Ext', 'Nunito Cyrillic', 'Nunito Vietnamese'],
};

let registered = false;

/**
 * The app's own faces in the PDF. react-pdf reads WOFF, not WOFF2, so these are the fontsource
 * .woff files. Only the files a document actually uses are fetched. Words are never hyphenated.
 */
export function registerPdfFonts(sources: PdfFontSources) {
  if (registered) return;
  registered = true;
  const weighted = (family: string, weights: Weights) =>
    Font.register({
      family,
      fonts: ([400, 700, 800] as const).map((fontWeight) => ({ src: weights[fontWeight], fontWeight })),
    });
  Font.register({ family: 'Young Serif', src: sources.youngSerif.latin });
  Font.register({ family: 'Young Serif Ext', src: sources.youngSerif.latinExt });
  Font.register({ family: 'Kalam', src: sources.kalam.latin });
  Font.register({ family: 'Kalam Ext', src: sources.kalam.latinExt });
  weighted('Nunito', sources.nunito.latin);
  weighted('Nunito Ext', sources.nunito.latinExt);
  weighted('Nunito Cyrillic', sources.nunito.cyrillic);
  weighted('Nunito Vietnamese', sources.nunito.vietnamese);
  Font.registerHyphenationCallback((word) => [word]);
}
