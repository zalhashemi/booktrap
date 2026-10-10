import { useEffect, useId, useRef, useState } from 'react';
import { FadersHorizontal, ListChecks, MagnifyingGlass, Rows, SquaresFour, X } from '@phosphor-icons/react';
import type { Tag } from '@booktrap/shared';
import { activeTab, tabQuery, type ShelfQuery, type ShelfTab, type SortKey } from '../library/filters';

export type ViewMode = 'shelf' | 'list';

interface Props {
  query: ShelfQuery;
  onChange: (query: ShelfQuery) => void;
  counts: Record<ShelfTab, number>;
  tags: Tag[];
  view: ViewMode;
  onViewChange: (view: ViewMode) => void;
  /** Phones start select mode from the tab row (desktop has a Select button in the header). */
  onSelect?: () => void;
}

const TABS: { value: ShelfTab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'want_to_read', label: 'Want to read' },
  { value: 'reading', label: 'Reading' },
  { value: 'read', label: 'Read' },
];

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'added', label: 'Recently added' },
  { value: 'title', label: 'Title' },
  { value: 'author', label: 'Author' },
];

/**
 * Each page-tab wears the colour of the state it stands for, the same colours as the tabs on the
 * covers (lime only for New, slate for Reading, honeydew for Read, the accent for All and Want to read):
 * a soft tint at rest, full colour when pulled up.
 */
const TAB_FILL: Record<ShelfTab, string> = {
  all: 'bg-[color-mix(in_srgb,var(--accent)_22%,var(--surface))] aria-pressed:bg-accent',
  new: 'bg-[var(--tab-new-rest)] shadow-[inset_0_0_0_1.5px_var(--tab-new-ring)] aria-pressed:bg-lime aria-pressed:shadow-none',
  want_to_read: 'bg-[color-mix(in_srgb,var(--accent)_12%,var(--surface))] aria-pressed:bg-accent',
  reading: 'bg-[color-mix(in_srgb,var(--reading)_28%,var(--surface))] aria-pressed:bg-reading',
  read: 'bg-[color-mix(in_srgb,var(--read)_45%,var(--surface))] shadow-[inset_0_0_0_1.5px_var(--cover-tab-edge)] aria-pressed:bg-read',
};

export function ShelfToolbar({ query, onChange, counts, tags, view, onViewChange, onSelect }: Props) {
  const ids = { search: useId(), tag: useId(), sort: useId(), pickers: useId() };
  const set = <K extends keyof ShelfQuery>(key: K, value: ShelfQuery[K]) => onChange({ ...query, [key]: value });
  // Phones fold the pickers away so books start near the top; desktop always shows them.
  const [pickersOpen, setPickersOpen] = useState(false);
  const activePickers = Number(query.tagId !== 'any') + Number(query.sort !== 'added');
  const current = activeTab(query);
  // On phones the tab row scrolls: a fade on the right edge says so until the last tab is in view.
  const scroller = useRef<HTMLDivElement>(null);
  const [moreRight, setMoreRight] = useState(false);
  const checkScroll = () => {
    const element = scroller.current;
    if (element) setMoreRight(element.scrollLeft + element.clientWidth < element.scrollWidth - 2);
  };
  useEffect(() => {
    checkScroll();
    window.addEventListener('resize', checkScroll);
    return () => window.removeEventListener('resize', checkScroll);
  }, [counts]);

  return (
    <div className="mt-5 space-y-4 md:mt-6 md:space-y-5">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <label htmlFor={ids.search} className="sr-only">
            Search your shelf
          </label>
          <MagnifyingGlass size={20} weight="bold" className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-text-faint" aria-hidden="true" />
          <input
            id={ids.search}
            type="search"
            value={query.search}
            onChange={(event) => set('search', event.target.value)}
            placeholder="Search your shelf"
            autoComplete="off"
            className="field min-h-12 rounded-pill pr-11 pl-12"
          />
          {query.search && (
            <button
              type="button"
              onClick={() => set('search', '')}
              aria-label="Clear search"
              className="absolute top-1/2 right-1 flex size-10 -translate-y-1/2 items-center justify-center rounded-pill text-text-muted hover:text-text"
            >
              <X size={18} weight="bold" aria-hidden="true" />
            </button>
          )}
        </div>
        <ViewToggle view={view} onViewChange={onViewChange} />
      </div>

      <div className="flex items-end gap-2">
        <div
          ref={scroller}
          onScroll={checkScroll}
          className={`-ml-4 min-w-0 flex-1 overflow-x-auto pl-4 [scrollbar-width:none] md:mx-0 md:px-0 ${
            moreRight ? '[mask-image:linear-gradient(to_right,#000_calc(100%-2.5rem),transparent)]' : ''
          }`}
        >
          <div className="tab-row min-w-max" role="group" aria-label="Show">
            {TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                aria-pressed={current === tab.value}
                onClick={() => onChange({ ...query, ...tabQuery(tab.value) })}
                className={`page-tab ${TAB_FILL[tab.value]}`}
              >
                {tab.label}
                <span className="tabular-nums">{counts[tab.value]}</span>
              </button>
            ))}
          </div>
        </div>
        {/* Phones: filter and select sit on the tab row instead of taking rows of their own. */}
        <div className="flex shrink-0 gap-1.5 pb-1 md:hidden">
          <button
            type="button"
            aria-expanded={pickersOpen}
            aria-controls={ids.pickers}
            aria-label={`Filter and sort${activePickers > 0 ? `, ${activePickers} on` : ''}`}
            onClick={() => setPickersOpen((open) => !open)}
            className={`relative flex size-11 items-center justify-center rounded-pill shadow-[inset_0_0_0_1.5px_var(--rule)] ${pickersOpen ? 'bg-accent text-on-tab' : 'bg-surface text-text'}`}
          >
            <FadersHorizontal size={20} weight="bold" aria-hidden="true" />
            {activePickers > 0 && (
              <span className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-pill bg-accent text-[0.7rem] font-bold text-on-tab tabular-nums" aria-hidden="true">
                {activePickers}
              </span>
            )}
          </button>
          {onSelect && (
            <button
              type="button"
              onClick={onSelect}
              aria-label="Select books"
              className="flex size-11 items-center justify-center rounded-pill bg-surface text-text shadow-[inset_0_0_0_1.5px_var(--rule)]"
            >
              <ListChecks size={20} weight="bold" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div id={ids.pickers} className={`${pickersOpen ? 'grid' : 'hidden'} grid-cols-2 gap-3 md:flex md:flex-wrap md:items-end`}>
        {tags.length > 0 && (
          <Picker id={ids.tag} label="Shelf">
            <select id={ids.tag} value={query.tagId} onChange={(event) => set('tagId', event.target.value)} className="field">
              <option value="any">All shelves</option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </select>
          </Picker>
        )}
        <Picker id={ids.sort} label="Sort by">
          <select id={ids.sort} value={query.sort} onChange={(event) => set('sort', event.target.value as SortKey)} className="field">
            {SORTS.map((sort) => (
              <option key={sort.value} value={sort.value}>
                {sort.label}
              </option>
            ))}
          </select>
        </Picker>
      </div>
    </div>
  );
}

function Picker({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 md:w-48">
      <label htmlFor={id} className="mb-1 block pl-1 text-[0.8rem] font-bold text-text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

function ViewToggle({ view, onViewChange }: { view: ViewMode; onViewChange: (view: ViewMode) => void }) {
  return (
    <div className="inline-flex shrink-0 rounded-pill bg-surface p-0.5 shadow-[inset_0_0_0_1.5px_var(--rule)]" role="group" aria-label="View">
      {(
        [
          ['shelf', 'Shelf', SquaresFour],
          ['list', 'List', Rows],
        ] as const
      ).map(([value, label, Icon]) => (
        <button
          key={value}
          type="button"
          aria-pressed={view === value}
          onClick={() => onViewChange(value)}
          className={`flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-pill px-3 text-[0.85rem] font-bold transition-colors duration-200 ${
            view === value ? 'bg-accent text-on-tab' : 'text-text-muted hover:text-text'
          }`}
        >
          <Icon size={18} weight={view === value ? 'fill' : 'bold'} aria-hidden="true" />
          <span className="hidden lg:inline">{label}</span>
          <span className="sr-only lg:hidden">{label}</span>
        </button>
      ))}
    </div>
  );
}
