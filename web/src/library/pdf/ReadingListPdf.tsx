import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { Book, BookStatus } from '@booktrap/shared';
import { clothIndex } from '../covers';
import { PDF_FONTS } from './fonts';

/**
 * The PDF reading list: the shelf as a printed, annotated paperback page. Paper colours are the
 * light theme's (web/src/styles/index.css), since a PDF is read on white screens and printed.
 */
const PAPER = {
  ground: '#fbfdfc',
  ink: '#2b2733',
  muted: '#54506a',
  faint: '#6a6680',
  rule: '#cfdcd5',
  accent: '#85baa1',
  accentInk: '#3e7a60',
  note: '#67597a',
  tagInk: '#4f6670',
  reading: '#9db3bd',
  read: '#ceeddb',
  wantToRead: '#d4e1da',
  lime: '#c6e04a',
  onCloth: '#f2faf5',
  cloths: ['#67597a', '#544e61', '#4f6670', '#3f6b58'],
} as const;

/** Reading now first: it's what the reader is in the middle of. */
const GROUPS: { status: BookStatus; label: string; tab: string }[] = [
  { status: 'reading', label: 'Reading now', tab: PAPER.reading },
  { status: 'want_to_read', label: 'Want to read', tab: PAPER.accent },
  { status: 'read', label: 'Read', tab: PAPER.read },
];

/** Five covers across. A heading stays on the page with its first row, so it never sits alone at a page foot. */
const PER_ROW = 5;
const COVER_WIDTH = 74;

export interface ReadingListPdfProps {
  books: Book[];
  /** Cover images by book id, as data URLs. Missing ones get the bookcloth plate. */
  covers: Map<string, string>;
  createdAt: Date;
  pageSize: 'A4' | 'LETTER';
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: PAPER.ground,
    color: PAPER.ink,
    fontFamily: PDF_FONTS.body,
    fontSize: 10,
    paddingTop: 46,
    paddingBottom: 56,
    paddingLeft: 58,
    paddingRight: 46,
  },
  pageEdge: { position: 'absolute', top: 0, bottom: 0, left: 0, width: 7, backgroundColor: PAPER.accent },
  title: { fontFamily: PDF_FONTS.display, fontSize: 30, lineHeight: 1.1 },
  margin: { fontFamily: PDF_FONTS.hand, fontSize: 13, color: PAPER.note, marginTop: 5, marginLeft: 2, transform: 'rotate(-1.5deg)' },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 58,
    right: 46,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 8.5,
    color: PAPER.faint,
  },
  wordmark: { fontFamily: PDF_FONTS.display, fontSize: 10, color: PAPER.accentInk },
  group: { marginTop: 26 },
  groupHead: { flexDirection: 'row', alignItems: 'flex-end', borderBottomWidth: 1.5, borderBottomColor: PAPER.accent, marginBottom: 14 },
  groupTab: {
    paddingTop: 4,
    paddingBottom: 3,
    paddingHorizontal: 11,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    fontWeight: 800,
    fontSize: 10,
    color: PAPER.ink,
  },
  groupCount: { fontFamily: PDF_FONTS.hand, fontSize: 11, color: PAPER.note, marginLeft: 8, marginBottom: 1 },
});

export function ReadingListPdf({ books, covers, createdAt, pageSize }: ReadingListPdfProps) {
  const date = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(createdAt);
  const groups = GROUPS.map((group) => ({ ...group, books: books.filter((book) => book.status === group.status) })).filter(
    (group) => group.books.length > 0,
  );

  return (
    <Document title="My reading list" author="BookTrap" creator="BookTrap" producer="BookTrap">
      <Page size={pageSize} style={styles.page}>
        <View fixed style={styles.pageEdge} />
        <Text style={styles.title}>My reading list</Text>
        <Text style={styles.margin}>
          {books.length} {books.length === 1 ? 'book' : 'books'}, as of {date}
        </Text>

        {groups.map((group) => (
          <View key={group.status} style={styles.group}>
            <View wrap={false}>
              <View style={styles.groupHead}>
                <Text style={[styles.groupTab, { backgroundColor: group.tab }]}>{group.label}</Text>
                <Text style={styles.groupCount}>{group.books.length}</Text>
              </View>
              <Shelf books={group.books.slice(0, PER_ROW)} covers={covers} />
            </View>
            <Shelf books={group.books.slice(PER_ROW)} covers={covers} />
          </View>
        ))}

        <View fixed style={styles.footer}>
          <Text style={styles.wordmark}>BookTrap</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/** A title with the lime highlighter behind it, line by line, when the book is New (the app's own mark). */
function Title({ book }: { book: Book }) {
  return (
    <Text style={{ fontFamily: PDF_FONTS.display, fontSize: 8.5, lineHeight: 1.3, marginTop: 6, maxLines: 3, textOverflow: 'ellipsis' }}>
      {book.isNew ? <Text style={{ backgroundColor: PAPER.lime }}>{book.title}</Text> : book.title}
    </Text>
  );
}

/** The cover, or a bookcloth plate with the title when there isn't one (as on the shelf). */
function Cover({ book, src }: { book: Book; src: string | undefined }) {
  if (src) return <Image src={src} style={{ width: COVER_WIDTH, height: COVER_WIDTH * 1.5, borderRadius: 3, objectFit: 'cover' }} />;
  return (
    <View
      style={{
        width: COVER_WIDTH,
        height: COVER_WIDTH * 1.5,
        borderRadius: 3,
        backgroundColor: PAPER.cloths[clothIndex(book.title)],
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 4,
      }}
    >
      <View style={{ width: COVER_WIDTH * 0.45, height: 0.75, backgroundColor: PAPER.accent }} />
      <Text style={{ fontFamily: PDF_FONTS.display, fontSize: 8, color: PAPER.onCloth, textAlign: 'center', marginVertical: 4, maxLines: 5, textOverflow: 'ellipsis' }}>
        {book.title}
      </Text>
      {book.author && (
        <Text style={{ fontFamily: PDF_FONTS.hand, fontSize: 6.5, color: PAPER.onCloth, opacity: 0.9, textAlign: 'center', marginBottom: 4, maxLines: 1, textOverflow: 'ellipsis' }}>
          {book.author}
        </Text>
      )}
      <View style={{ width: COVER_WIDTH * 0.45, height: 0.75, backgroundColor: PAPER.accent }} />
    </View>
  );
}

/** Covers on a shelf, five across, titles below like shelf labels; New books carry a lime page-tab. */
function Shelf({ books, covers }: { books: Book[]; covers: Map<string, string> }) {
  if (books.length === 0) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -7 }}>
      {books.map((book) => (
        <View key={book.id} wrap={false} style={{ width: `${100 / PER_ROW}%`, paddingHorizontal: 7, marginBottom: 16 }}>
          <View style={{ position: 'relative' }}>
            {book.isNew && (
              <View style={{ position: 'absolute', top: -5, right: 6, width: 11, height: 9, backgroundColor: PAPER.lime, borderTopLeftRadius: 3, borderTopRightRadius: 3 }} />
            )}
            <Cover book={book} src={covers.get(book.id)} />
          </View>
          <Title book={book} />
          <Text style={{ fontSize: 7.5, color: PAPER.muted, marginTop: 1.5, maxLines: 1, textOverflow: 'ellipsis' }}>
            {book.author ?? 'Author unknown'}
          </Text>
        </View>
      ))}
    </View>
  );
}
