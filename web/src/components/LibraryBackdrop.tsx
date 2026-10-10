/**
 * The reading room around the page (change request 001 §3): a cozy, slightly magical library drawn
 * in the side gutters on wide screens. Pure decoration: hidden from assistive tech, never clickable,
 * painted behind everything, and it only ever occupies the space outside the content column.
 *
 * Each wing is a size container, so every piece decides from the wing's own width whether it fits
 * (see .library-* rules in index.css). Colours come from the --deco-* tokens, tuned per theme.
 */

const sparkle = (x: number, y: number, r: number) =>
  `M${x} ${y - r}L${x + r * 0.25} ${y - r * 0.25}L${x + r} ${y}L${x + r * 0.25} ${y + r * 0.25}L${x} ${y + r}L${x - r * 0.25} ${y + r * 0.25}L${x - r} ${y}L${x - r * 0.25} ${y - r * 0.25}Z`;

const STARS: [number, number, number][] = [
  [72, 104, 6],
  [112, 70, 4],
  [194, 168, 5],
  [62, 214, 4],
  [150, 262, 6],
  [96, 312, 4],
  [182, 300, 3],
];
const STAR_DOTS: [number, number][] = [
  [92, 150],
  [176, 214],
  [130, 196],
  [58, 290],
  [196, 250],
  [140, 330],
];

function ArchedWindow() {
  return (
    <svg className="library-window" viewBox="0 0 240 384" fill="none">
      <defs>
        <linearGradient id="deco-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="deco-sky-top" />
          <stop offset="1" className="deco-sky-bottom" />
        </linearGradient>
      </defs>
      {/* Curtains, tied back */}
      <path className="deco-curtain" d="M4 28H60C56 92 40 172 46 252C34 292 30 330 40 370H4Z" />
      <path className="deco-curtain" d="M236 28H180C184 92 200 172 194 252C206 292 210 330 200 370H236Z" />
      <path className="deco-line" d="M18 32C20 120 16 200 30 252M34 32C36 116 28 196 40 252M222 32C220 120 224 200 210 252M206 32C204 116 212 196 200 252" />
      <circle className="deco-tie" cx="42" cy="252" r="4" />
      <circle className="deco-tie" cx="198" cy="252" r="4" />

      <path d="M34 362V128A86 86 0 0 1 206 128V362Z" fill="url(#deco-sky)" />

      <g className="deco-night">
        <path className="deco-moon" d="M164 66a28 28 0 1 0 24 44a22 22 0 1 1 -24 -44z" />
        {STARS.map(([x, y, r]) => (
          <path key={`${x}-${y}`} className="deco-star" d={sparkle(x, y, r)} />
        ))}
        {STAR_DOTS.map(([x, y]) => (
          <circle key={`${x}-${y}`} className="deco-star" cx={x} cy={y} r="1.3" />
        ))}
      </g>
      <g className="deco-day">
        <circle className="deco-sun" cx="156" cy="96" r="20" />
        <path className="deco-cloud" d="M56 176h50a11 11 0 0 0 0-22a15 15 0 0 0-28-6a11 11 0 0 0-22 6a11 11 0 0 0 0 22z" />
        <path className="deco-cloud" d="M132 246h38a8 8 0 0 0 0-16a11 11 0 0 0-21-4a8 8 0 0 0-17 4a8 8 0 0 0 0 16z" />
        <path className="deco-line" d="M82 120q6-6 12 0q6-6 12 0M118 98q4-4 8 0q4-4 8 0" />
      </g>

      {/* Glazing bars and frame */}
      <path className="deco-line" d="M120 44V362M34 128H206M34 246H206" />
      <path className="deco-line" d="M34 362V128A86 86 0 0 1 206 128V362" />
      <path className="deco-frame" d="M22 368V128A98 98 0 0 1 218 128V368" />
      <path className="deco-frame-fill" d="M120 22l7 9-7 9-7-9z" />

      {/* Sill with a small stack and a plant */}
      <rect className="deco-wood" x="4" y="362" width="232" height="14" rx="5" />
      <rect className="deco-spine-2" x="40" y="350" width="48" height="12" rx="2" />
      <rect className="deco-spine-1" x="45" y="340" width="38" height="10" rx="2" />
      <path className="deco-leaf" d="M186 338C176 322 168 320 160 308C176 310 184 320 186 338ZM186 338C196 322 204 320 212 308C196 310 188 320 186 338ZM186 338C184 318 188 304 194 294C197 310 193 326 186 338Z" />
      <path className="deco-pot" d="M172 338h28l-4 24h-20z" />
    </svg>
  );
}

function CandleStack() {
  return (
    <svg className="library-stack" viewBox="0 0 176 330" fill="none">
      <defs>
        <radialGradient id="deco-candle-glow">
          <stop offset="0" className="deco-glow-core" />
          <stop offset="1" className="deco-glow-edge" />
        </radialGradient>
      </defs>
      <ellipse className="deco-shadow" cx="86" cy="322" rx="82" ry="6" />

      <circle className="library-glow" cx="83" cy="112" r="56" fill="url(#deco-candle-glow)" />

      <rect className="deco-spine-1" x="8" y="284" width="152" height="34" rx="4" />
      <path className="deco-band" d="M22 284v34M146 284v34" />
      <rect className="deco-label" x="60" y="297" width="48" height="7" rx="3" />

      <rect className="deco-spine-3" x="18" y="254" width="132" height="30" rx="4" />
      <path className="deco-band" d="M30 254v30M138 254v30" />

      <g transform="rotate(-4 85 240)">
        <rect className="deco-spine-2" x="4" y="228" width="140" height="27" rx="4" />
        <path className="deco-band" d="M16 228v27M132 228v27" />
        <rect className="deco-label" x="50" y="239" width="40" height="6" rx="3" />
        {/* A bookmark ribbon hangs out of the pages */}
        <path className="deco-ribbon" d="M112 254v20l-4-4-4 4v-20z" />
      </g>

      <rect className="deco-spine-4" x="28" y="204" width="110" height="24" rx="4" />
      <path className="deco-band" d="M40 204v24M126 204v24" />
      <rect className="deco-spine-1" x="44" y="186" width="80" height="18" rx="3" />

      {/* The candle, with a teal flame: this library is a little bit magic */}
      <ellipse className="deco-wood" cx="84" cy="186" rx="24" ry="4.5" />
      <rect className="deco-candle" x="74" y="132" width="20" height="54" rx="3" />
      <path className="deco-candle-shade" d="M89 132v16a3 3 0 0 1-6 0v-16z" />
      <path className="deco-line" d="M84 132v-7" />
      <g className="library-flame">
        <path className="deco-flame" d="M84 98C94 111 94 121 84 126C74 121 74 111 84 98Z" />
        <path className="deco-flame-core" d="M84 109C88 115 88 120 84 123C80 120 80 115 84 109Z" />
      </g>

      {/* A bookworm in reading glasses, peeking out between the pages */}
      <path className="deco-worm" d="M148 279C158 279 161 271 161 263" />
      <circle className="deco-worm-head" cx="162" cy="258" r="8.5" />
      <circle className="deco-glasses" cx="158.5" cy="257" r="3" />
      <circle className="deco-glasses" cx="166" cy="257" r="3" />
      <path className="deco-glasses" d="M161.5 257h1.5M159 262.5q3 2 6 0" />
      <circle className="deco-eye" cx="158.5" cy="257" r="1" />
      <circle className="deco-eye" cx="166" cy="257" r="1" />
    </svg>
  );
}

/** Dust motes drifting through the lamplight: offset, drift and timing per mote. */
const MOTES: { x: number; y: number; r: number; dx: number; dur: number; delay: number; o: number }[] = [
  { x: 92, y: 520, r: 1.8, dx: 14, dur: 14, delay: 0, o: 0.9 },
  { x: 70, y: 470, r: 1.2, dx: -10, dur: 18, delay: 3, o: 0.7 },
  { x: 120, y: 560, r: 1.5, dx: 8, dur: 16, delay: 6, o: 0.8 },
  { x: 104, y: 430, r: 1, dx: 12, dur: 20, delay: 2, o: 0.6 },
  { x: 58, y: 580, r: 1.6, dx: -6, dur: 17, delay: 9, o: 0.75 },
  { x: 140, y: 500, r: 1.1, dx: -12, dur: 19, delay: 5, o: 0.65 },
  { x: 86, y: 600, r: 1.3, dx: 10, dur: 15, delay: 11, o: 0.7 },
  { x: 128, y: 450, r: 0.9, dx: 6, dur: 21, delay: 8, o: 0.55 },
];

function HangingLamp() {
  return (
    <svg className="library-lamp" viewBox="0 0 200 640" fill="none">
      <defs>
        <linearGradient id="deco-cone" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="deco-cone-top" />
          <stop offset="1" className="deco-glow-edge" />
        </linearGradient>
        <radialGradient id="deco-lamp-glow">
          <stop offset="0" className="deco-glow-core" />
          <stop offset="1" className="deco-glow-edge" />
        </radialGradient>
      </defs>
      <path d="M72 356L14 640H186L128 356Z" fill="url(#deco-cone)" />
      <circle className="library-glow library-glow-slow" cx="100" cy="356" r="70" fill="url(#deco-lamp-glow)" />
      {MOTES.map((mote) => (
        <circle
          key={`${mote.x}-${mote.y}`}
          className="library-mote"
          cx={mote.x}
          cy={mote.y}
          r={mote.r}
          style={{ '--dx': `${mote.dx}px`, '--dur': `${mote.dur}s`, '--delay': `-${mote.delay}s`, '--o': mote.o } as React.CSSProperties}
        />
      ))}

      <path className="deco-cord" d="M100 0V304" />
      <circle className="deco-line" cx="100" cy="307" r="3.5" />
      <path className="deco-shade" d="M68 354Q72 316 100 310Q128 316 132 354Z" />
      <path className="deco-band" d="M77 334Q100 327 123 334" />
      <ellipse className="deco-shade-rim" cx="100" cy="354" rx="33" ry="5" />
      <circle className="deco-bulb" cx="100" cy="358" r="7" />
    </svg>
  );
}

/** Spines per shelf: width, height (of 100) and colour index, in order from the left. */
const SHELVES: [number, number, number][][] = [
  [[14, 92, 1], [10, 80, 3], [16, 96, 2], [12, 86, 4], [9, 74, 1], [18, 98, 3], [11, 82, 2], [14, 90, 4], [10, 78, 1]],
  [[12, 84, 2], [16, 96, 4], [10, 76, 1], [13, 88, 3], [15, 94, 2], [9, 70, 4]],
  [[11, 86, 3], [14, 94, 1], [10, 80, 4], [17, 98, 2], [12, 84, 3], [13, 90, 1], [10, 74, 2], [15, 92, 4]],
  [[16, 96, 4], [12, 84, 2], [10, 78, 3], [14, 92, 1], [11, 82, 4], [13, 88, 2], [15, 94, 3]],
];
const SHELF_TOPS = [64, 184, 304, 424];
const SHELF_HEIGHT = 108;

function BookcaseLadder() {
  return (
    <svg className="library-case" viewBox="0 0 290 600" fill="none">
      <ellipse className="deco-shadow" cx="140" cy="594" rx="138" ry="6" />
      {/* Crown, with a globe and two books on top */}
      <path className="deco-frame" d="M24 52Q112 18 200 52" />
      <circle className="deco-globe" cx="62" cy="26" r="14" />
      <path className="deco-line" d="M48 26h28M62 12q-8 14 0 28q8-14 0-28M50 16a18 18 0 0 0 0 22" />
      <path className="deco-wood" d="M54 46h16l-3-6h-10z" />
      <rect className="deco-spine-3" x="132" y="38" width="44" height="9" rx="2" />
      <rect className="deco-spine-1" x="136" y="30" width="36" height="8" rx="2" />

      <rect className="deco-case" x="18" y="52" width="188" height="540" rx="6" />
      {SHELVES.map((row, shelf) => {
        const top = SHELF_TOPS[shelf]!;
        // Fill the row from the left, leaving room at the end for one leaning book.
        const books: [number, number, number][] = [];
        for (let i = 0, used = 0; used < 128; i++) {
          const book = row[i % row.length]!;
          books.push(book);
          used += book[0] + 1.5;
        }
        let x = 30;
        return (
          <g key={shelf}>
            {books.map(([width, height, colour], i) => {
              const h = (height / 100) * (SHELF_HEIGHT - 10);
              const book = (
                <g key={i}>
                  <rect className={`deco-spine-${colour}`} x={x} y={top + SHELF_HEIGHT - h} width={width} height={h} rx="1.5" />
                  <path className="deco-band" d={`M${x} ${top + SHELF_HEIGHT - h + 8}h${width}`} />
                </g>
              );
              x += width + 1.5;
              return book;
            })}
            {/* One book leans in the gap at the end of the row */}
            <rect
              className={`deco-spine-${(shelf % 4) + 1}`}
              x={x + 14}
              y={top + SHELF_HEIGHT - 80}
              width="12"
              height="80"
              rx="1.5"
              transform={`rotate(-16 ${x + 26} ${top + SHELF_HEIGHT})`}
            />
            <rect className="deco-wood" x="22" y={top + SHELF_HEIGHT} width="180" height="8" rx="2" />
          </g>
        );
      })}
      <rect className="deco-wood" x="22" y="544" width="180" height="48" rx="3" />
      <path className="deco-line" d="M70 568h84" />

      {/* The library ladder, hooked over the top */}
      <g className="deco-ladder">
        <path d="M212 596L156 58M252 596L194 58" />
        {Array.from({ length: 11 }, (_, i) => {
          const t = 0.06 + i * 0.088;
          const y = 596 - t * 538;
          return <path key={i} d={`M${212 - t * 56} ${y}H${252 - t * 58}`} />;
        })}
        <path d="M156 58q-2-10 8-12M194 58q-2-10 8-12" />
      </g>
    </svg>
  );
}

export function LibraryBackdrop() {
  return (
    <div className="library" aria-hidden="true">
      <div className="library-wing library-wing-left">
        <ArchedWindow />
        <CandleStack />
      </div>
      <div />
      <div className="library-wing library-wing-right">
        <HangingLamp />
        <BookcaseLadder />
      </div>
    </div>
  );
}

/** A low run of spines along the foot of the page, so tablets get a little of the room too. */
export function ShelfFooter() {
  return (
    <div className="library-footer" aria-hidden="true">
      <svg width="100%" height="58">
        <defs>
          <pattern id="deco-footer-books" width="236" height="58" patternUnits="userSpaceOnUse">
            {[
              [0, 30, 2],
              [14, 40, 1],
              [26, 26, 3],
              [40, 44, 4],
              [56, 34, 2],
              [68, 38, 1],
              [96, 28, 3],
              [110, 42, 2],
              [126, 32, 4],
              [138, 46, 1],
              [156, 36, 3],
              [170, 30, 4],
              [198, 40, 1],
              [212, 34, 2],
            ].map(([x, h, colour]) => (
              <rect key={x} className={`deco-spine-${colour}`} x={x} y={52 - h!} width={x === 40 || x === 138 ? 14 : 11} height={h} rx="1.5" />
            ))}
            {/* A fallen book in each run */}
            <rect className="deco-spine-4" x="80" y="44" width="14" height="8" rx="1.5" transform="rotate(-62 80 52)" />
          </pattern>
        </defs>
        <rect width="100%" height="52" fill="url(#deco-footer-books)" />
        <rect className="deco-wood" y="52" width="100%" height="6" />
      </svg>
    </div>
  );
}

const STRIP_SPINES: [x: number, height: number, width: number, colour: number][] = [
  [96, 50, 14, 1],
  [111, 40, 17, 3],
  [129, 58, 12, 2],
  [142, 46, 16, 4],
  [159, 62, 13, 1],
  [178, 44, 15, 2],
  [194, 54, 17, 3],
  [212, 36, 12, 4],
];

/**
 * A slim slice of the reading room for screens too narrow for the side wings (the user's pick for
 * phones, 2026-10-09): the arched window, a shelf run with one book leaning, and the candle on its
 * stack. Same tokens and motion as the wings, so it follows day and night and reduced motion.
 */
export function ReadingRoomStrip({ className = '' }: { className?: string }) {
  return (
    <div className={`library-strip ${className}`} aria-hidden="true">
      <svg viewBox="0 0 358 96" className="block h-auto w-full max-w-[480px]" fill="none">
        <defs>
          <linearGradient id="deco-strip-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className="deco-sky-top" />
            <stop offset="1" className="deco-sky-bottom" />
          </linearGradient>
          <radialGradient id="deco-strip-glow">
            <stop offset="0" className="deco-glow-core" />
            <stop offset="1" className="deco-glow-edge" />
          </radialGradient>
        </defs>

        {/* Arched window: crescent moon and stars at night, sun and a cloud by day */}
        <path d="M14 92V36a28 28 0 0 1 56 0V92Z" fill="url(#deco-strip-sky)" />
        <g className="deco-night">
          <path className="deco-moon" d="M52 20a9 9 0 1 0 8 14a7 7 0 1 1 -8 -14z" />
          <path className="deco-star" d={sparkle(28, 30, 3.5)} />
          <circle className="deco-star" cx="36" cy="50" r="1" />
          <circle className="deco-star" cx="58" cy="58" r="1" />
        </g>
        <g className="deco-day">
          <circle className="deco-sun" cx="54" cy="30" r="7" />
          <path className="deco-cloud" d="M22 58h20a5 5 0 0 0 0-10a7 7 0 0 0-13-3a5 5 0 0 0-7 3a5 5 0 0 0 0 10z" />
        </g>
        <path className="deco-frame" d="M14 92V36a28 28 0 0 1 56 0V92ZM42 8V92M14 62H70" style={{ strokeWidth: 2.5 }} />

        {/* A shelf run, one book leaning on the last */}
        {STRIP_SPINES.map(([x, h, w, colour]) => (
          <rect key={x} className={`deco-spine-${colour}`} x={x} y={90 - h} width={w} height={h} rx="2" />
        ))}
        <rect className="deco-spine-2" x="226" y="46" width="15" height="44" rx="2" transform="rotate(14 233 90)" />
        <rect className="deco-wood" x="88" y="90" width="176" height="6" rx="2" />

        {/* The candle on its stack */}
        <circle cx="314" cy="40" r="26" fill="url(#deco-strip-glow)" className="library-glow" />
        <rect className="deco-spine-4" x="284" y="80" width="58" height="12" rx="2" />
        <rect className="deco-spine-3" x="290" y="68" width="48" height="12" rx="2" />
        <rect className="deco-candle" x="308" y="44" width="12" height="24" rx="2" />
        <path className="deco-flame library-flame" d="M314 30c5 6 5 11 0 13c-5 -2 -5 -7 0 -13Z" />
        <path className="deco-flame-core" d="M314 36c2 3 2 5 0 6c-2 -1 -2 -3 0 -6Z" />
      </svg>
    </div>
  );
}
