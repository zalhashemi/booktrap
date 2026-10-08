/**
 * Text normalisation and fuzzy matching for book titles and authors.
 * Used for duplicate detection (brief §7) and for accepting Google Books / Open Library matches (§6).
 */

const LEADING_ARTICLE = /^(the|a|an)\s+/;
/** Bracketed noise TikTok captions and catalogues add: "(Book 1)", "[Special Edition]". */
const BRACKETED = /\s*[([][^)\]]*[)\]]\s*/g;

function fold(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** "The Secret History: A Novel (Penguin Classics)" -> "secret history" */
export function normalizeTitle(title: string): string {
  const main = title.replace(BRACKETED, ' ').split(/\s[:–—-]\s|:\s/)[0] ?? title;
  return fold(main).replace(LEADING_ARTICLE, '').trim();
}

export function normalizeAuthor(author: string | null | undefined): string {
  if (!author) return '';
  // "Baldwin, James" -> "james baldwin"
  const flipped = author.includes(',') ? author.split(',').reverse().join(' ') : author;
  return fold(flipped);
}

/** Surname-ish key: the last token of the normalised author, or "" when unknown. */
export function authorKey(author: string | null | undefined): string {
  const tokens = normalizeAuthor(author).split(' ').filter(Boolean);
  return tokens.at(-1) ?? '';
}

export function normalizedKey(title: string, author: string | null | undefined): string {
  return `${normalizeTitle(title)}|${authorKey(author)}`;
}

function bigrams(text: string): Map<string, number> {
  const compact = text.replace(/\s+/g, ' ');
  const grams = new Map<string, number>();
  for (let i = 0; i < compact.length - 1; i++) {
    const gram = compact.slice(i, i + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

function dice(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return 0;
  const left = bigrams(a);
  const right = bigrams(b);
  let overlap = 0;
  for (const [gram, count] of left) overlap += Math.min(count, right.get(gram) ?? 0);
  return (2 * overlap) / (a.length - 1 + (b.length - 1));
}

/** Optimal string alignment distance: Levenshtein plus adjacent transpositions (typical misreads). */
function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, d[i - 2]![j - 2]! + 1);
      d[i]![j] = best;
    }
  }
  return d[a.length]![b.length]!;
}

/**
 * Similarity 0..1: the better of bigram overlap (robust to word order and extra words)
 * and normalised edit distance (robust to single-letter misreads like "Histroy").
 */
export function similarity(a: string, b: string): number {
  if (a === b) return a.length > 0 ? 1 : 0;
  if (!a || !b) return 0;
  const edit = 1 - editDistance(a, b) / Math.max(a.length, b.length);
  return Math.max(dice(a, b), edit);
}

export function titleSimilarity(a: string, b: string): number {
  return similarity(normalizeTitle(a), normalizeTitle(b));
}

/**
 * How well two author strings agree, 0..1. A shared surname with compatible initials
 * counts as a strong match ("J. Baldwin" vs "James Baldwin").
 */
export function authorSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const left = normalizeAuthor(a);
  const right = normalizeAuthor(b);
  if (!left || !right) return 0;
  const direct = similarity(left, right);
  if (authorKey(a) && authorKey(a) === authorKey(b)) {
    const firstA = left.split(' ')[0]?.[0];
    const firstB = right.split(' ')[0]?.[0];
    return Math.max(direct, firstA === firstB ? 0.95 : 0.8);
  }
  return direct;
}

/** True when two books are the same work (used before inserting a new shelf entry). */
export function isSameBook(
  a: { title: string; author: string | null; isbn13?: string | null },
  b: { title: string; author: string | null; isbn13?: string | null },
): boolean {
  if (a.isbn13 && b.isbn13 && a.isbn13 === b.isbn13) return true;
  const titles = titleSimilarity(a.title, b.title);
  if (titles < 0.9) return false;
  // Unknown author on either side: rely on a near-exact title.
  if (!authorKey(a.author) || !authorKey(b.author)) return titles >= 0.95;
  return authorSimilarity(a.author, b.author) >= 0.75;
}
