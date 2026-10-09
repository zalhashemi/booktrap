import { authorSimilarity, normalizeTitle, similarity } from './normalize';

/**
 * Verification and enrichment (brief §6): look each extracted book up in Google Books,
 * fall back to Open Library, and accept a match only when title and author agree.
 */

export interface Candidate {
  title: string;
  subtitle?: string | null;
  authors: string[];
  isbn10: string | null;
  isbn13: string | null;
  coverUrl: string | null;
  publishedYear: number | null;
}

export interface Verification {
  verified: boolean;
  title: string;
  author: string | null;
  isbn10: string | null;
  isbn13: string | null;
  coverUrl: string | null;
  publishedYear: number | null;
  /** Why a match was accepted or rejected, for logs and tuning. */
  score: number;
}

/** Tuned against the Phase 2 fixtures; see verify.test.ts for the boundary cases. */
export const MATCH_THRESHOLDS = {
  title: 0.82,
  titleWithoutAuthor: 0.92,
  author: 0.75,
} as const;

type Fetch = typeof fetch;
const TIMEOUT_MS = 8000;

export function scoreCandidate(title: string, author: string | null, candidate: Candidate): { accept: boolean; score: number } {
  const wanted = normalizeTitle(title);
  const titleScore = Math.max(
    similarity(wanted, normalizeTitle(candidate.title)),
    candidate.subtitle ? similarity(wanted, normalizeTitle(`${candidate.title} ${candidate.subtitle}`)) : 0,
  );
  if (!author) {
    return { accept: titleScore >= MATCH_THRESHOLDS.titleWithoutAuthor, score: titleScore };
  }
  const authorScore = Math.max(0, ...candidate.authors.map((name) => authorSimilarity(author, name)));
  return {
    accept: titleScore >= MATCH_THRESHOLDS.title && authorScore >= MATCH_THRESHOLDS.author,
    score: titleScore + authorScore,
  };
}

function bestMatch(title: string, author: string | null, candidates: Candidate[]) {
  let best: { candidate: Candidate; score: number } | null = null;
  for (const candidate of candidates) {
    const { accept, score } = scoreCandidate(title, author, candidate);
    if (!accept) continue;
    // Prefer entries that carry an ISBN and a cover when scores tie closely.
    const bonus = (candidate.isbn13 ? 0.02 : 0) + (candidate.coverUrl ? 0.01 : 0);
    if (!best || score + bonus > best.score) best = { candidate, score: score + bonus };
  }
  return best;
}

async function getJson(fetchImpl: Fetch, url: string): Promise<unknown> {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${new URL(url).hostname} responded ${response.status}`);
  return response.json();
}

function year(value: unknown): number | null {
  const match = typeof value === 'string' ? /^(\d{4})/.exec(value) : null;
  return match ? Number(match[1]) : typeof value === 'number' ? value : null;
}

function httpsCover(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  return url.replace(/^http:/, 'https:').replace('&edge=curl', '');
}

interface GoogleVolume {
  volumeInfo?: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    publishedDate?: string;
    industryIdentifiers?: { type: string; identifier: string }[];
    imageLinks?: { thumbnail?: string; smallThumbnail?: string };
  };
}

export async function searchGoogleBooks(fetchImpl: Fetch, apiKey: string | undefined, title: string, author: string | null): Promise<Candidate[]> {
  const terms = [`intitle:${title}`];
  if (author) terms.push(`inauthor:${author}`);
  // English editions first: otherwise ISBNs and covers can come from any translation.
  const params = new URLSearchParams({ q: terms.join(' '), maxResults: '8', printType: 'books', langRestrict: 'en' });
  if (apiKey) params.set('key', apiKey);
  const data = (await getJson(fetchImpl, `https://www.googleapis.com/books/v1/volumes?${params}`)) as { items?: GoogleVolume[] };
  return (data.items ?? []).flatMap(({ volumeInfo: info }) => {
    if (!info?.title) return [];
    const ids = info.industryIdentifiers ?? [];
    return [
      {
        title: info.title,
        subtitle: info.subtitle ?? null,
        authors: info.authors ?? [],
        isbn10: ids.find((id) => id.type === 'ISBN_10')?.identifier ?? null,
        isbn13: ids.find((id) => id.type === 'ISBN_13')?.identifier ?? null,
        coverUrl: httpsCover(info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail),
        publishedYear: year(info.publishedDate),
      },
    ];
  });
}

interface OpenLibraryDoc {
  title?: string;
  subtitle?: string;
  author_name?: string[];
  isbn?: string[];
  first_publish_year?: number;
  cover_i?: number;
}

export async function searchOpenLibrary(fetchImpl: Fetch, title: string, author: string | null): Promise<Candidate[]> {
  const params = new URLSearchParams({ title, limit: '8', language: 'eng', fields: 'title,subtitle,author_name,isbn,first_publish_year,cover_i' });
  if (author) params.set('author', author);
  const data = (await getJson(fetchImpl, `https://openlibrary.org/search.json?${params}`)) as { docs?: OpenLibraryDoc[] };
  return (data.docs ?? []).flatMap((doc) => {
    if (!doc.title) return [];
    // Open Library lists every edition's ISBN. Prefer English-language groups (978-0, 978-1).
    const isbns = [...(doc.isbn ?? [])].sort((a, b) => Number(!/^97[89][01]/.test(a)) - Number(!/^97[89][01]/.test(b)));
    return [
      {
        title: doc.title,
        subtitle: doc.subtitle ?? null,
        authors: doc.author_name ?? [],
        isbn10: isbns.find((isbn) => isbn.length === 10) ?? null,
        isbn13: isbns.find((isbn) => isbn.length === 13 && /^97[89]/.test(isbn)) ?? null,
        coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : null,
        publishedYear: doc.first_publish_year ?? null,
      },
    ];
  });
}

export interface VerifyDeps {
  fetch?: Fetch;
  googleBooksApiKey?: string;
  log?: (message: string, detail?: unknown) => void;
}

/**
 * Never throws: a lookup outage just means the book is added as read, without a cover or ISBN,
 * which matches the "never lose a book" rule.
 */
export async function verifyBook(title: string, author: string | null, deps: VerifyDeps = {}): Promise<Verification> {
  const fetchImpl = deps.fetch ?? fetch;
  const unverified: Verification = {
    verified: false,
    title,
    author,
    isbn10: null,
    isbn13: null,
    coverUrl: null,
    publishedYear: null,
    score: 0,
  };

  const sources: [string, () => Promise<Candidate[]>][] = [
    ['google', () => searchGoogleBooks(fetchImpl, deps.googleBooksApiKey, title, author)],
    ['openlibrary', () => searchOpenLibrary(fetchImpl, title, author)],
  ];

  for (const [name, search] of sources) {
    let candidates: Candidate[];
    try {
      candidates = await search();
    } catch (error) {
      deps.log?.(`${name} lookup failed`, { title, error: (error as Error).message });
      continue;
    }
    const match = bestMatch(title, author, candidates);
    if (!match) continue;
    const { candidate } = match;
    // Fill a missing ISBN-13 cover from Open Library's ISBN covers endpoint.
    const coverUrl =
      candidate.coverUrl ?? (candidate.isbn13 ? `https://covers.openlibrary.org/b/isbn/${candidate.isbn13}-L.jpg?default=false` : null);
    return {
      verified: true,
      title: candidate.title,
      author: candidate.authors[0] ?? author,
      isbn10: candidate.isbn10,
      isbn13: candidate.isbn13,
      coverUrl,
      publishedYear: candidate.publishedYear,
      score: match.score,
    };
  }
  return unverified;
}
