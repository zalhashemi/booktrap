/**
 * Every size and count limit BookTrap enforces (user-approved, 2026-10-11). The web app reads them to
 * say so before the server refuses, and the API enforces them, so the two always agree.
 */
export const LIMITS = {
  /** Largest request body the API accepts. The biggest real one, 30 links, is about 62 KB. */
  requestBodyBytes: 128 * 1024,
  /** Distinct links in one paste. */
  linksPerPaste: 30,
  /** Entries in one submission before duplicates are dropped (a cheap bound; the 30 above is what counts). */
  linksPerRequest: 200,
  /** Characters of pasted text the paste box reads links from. */
  pasteChars: 20_000,
  linkChars: 2048,

  titleChars: 500,
  authorChars: 300,
  notesChars: 5000,
  shelfNameChars: 60,
  shelvesPerUser: 100,
  shelvesPerBook: 50,
  /** Live books (the Undo bin doesn't count) on a signed-in reader's shelf, and on a guest's. */
  booksPerAccount: 5000,
  booksPerGuest: 500,
  /** Books in one request that acts on a selection (delete, restore), and books merged at once. */
  booksPerRequest: 500,
  booksPerMerge: 20,
  /** Books one PDF prints; bigger shelves export "This view" or "Selected" (CSV and JSON have no cap). */
  booksPerPdf: 1000,

  /** What extraction sends Claude from a post's text: it bounds the cost of one read. */
  captionChars: 5000,
  hashtags: 30,

  /** Finished jobs are deleted after this many days (only the last few are shown). */
  jobHistoryDays: 30,

  reportsPerDay: 20,
  reportNoteChars: 500,
} as const;

/** Server-side limits on a post's media and on the cover pass-through. */
export const MEDIA_LIMITS = {
  maxSlides: 20,
  maxFrames: 30,
  /** One frame every this many seconds at most (brief: about one every 2s). */
  minFrameIntervalSec: 2,
  /** Frames are scaled to this width: legible spines without paying for full 720p. */
  frameWidth: 720,
  /** Raw download cap for a slide; slides are then re-encoded well under the API's 5MB per image. */
  maxImageBytes: 15 * 1024 * 1024,
  /** Long edge for slides sent to the model (the API downsamples beyond ~1568px anyway). */
  slideLongEdge: 1568,
  maxVideoBytes: 150 * 1024 * 1024,
  maxSubtitleChars: 8000,
  /** A book cover passed through `GET /v1/books/:id/cover`. */
  maxCoverBytes: 2 * 1024 * 1024,
} as const;

/** The most live books a shelf holds: guests get fewer until they save their shelf. */
export const bookLimitFor = (isGuest: boolean) => (isGuest ? LIMITS.booksPerGuest : LIMITS.booksPerAccount);

/**
 * Said when a shelf is at its book limit: when a paste is refused, or (with `skipped`) on an item
 * whose post filled the shelf part-way. Guests are told saving their shelf raises the limit.
 */
export function shelfFullMessage(guest: boolean, skipped?: number): string {
  const limit = bookLimitFor(guest).toLocaleString('en-US');
  const next = guest ? `Save your shelf to keep up to ${LIMITS.booksPerAccount.toLocaleString('en-US')}.` : 'Delete some to make room.';
  if (skipped === undefined) return `Your shelf is full (${limit} books). ${next}`;
  return `Your shelf is full (${limit} books), so ${skipped} ${skipped === 1 ? 'book' : 'books'} from this post ${skipped === 1 ? 'wasn’t' : 'weren’t'} added. ${next}`;
}
