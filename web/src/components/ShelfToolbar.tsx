import { useId, useState } from 'react';
import { FadersHorizontal, MagnifyingGlass, Rows, SquaresFour, X } from '@phosphor-icons/react';
import { BOOK_STATUSES, type Tag } from '@booktrap/shared';
import { STATUS_LABELS, type Flag, type ShelfQuery, type SortKey } from '../library/filters';

export type ViewMode = 'shelf' | 'list';

interface Props {
  query: ShelfQuery;
  onChange: (query: ShelfQuery) => void;
  counts: Record<Flag, number>;
  tags: Tag[];
  view: ViewMode;
  onViewChange: (view: ViewMode) => void;
}

const FLAGS: { value: Flag; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'unsure', label: 'Unsure' },
  { value: 'verified', label: 'Verified' },
];

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'added', label: 'Recently added' },
  { value: 'title', label: 'Title' },
  { value: 'author', label: 'Author' },
];

/** Active chip colours carry meaning: lime only for New, rose for Unsure, emerald for Verified. */
const ACTIVE: Record<Flag, string> = {
  all: 'bg-surface-strong text-text',
  new: 'bg-lime text-on-lime',
  unsure: 'bg-rose text-ground',
  verified: 'bg-emerald text-on-cloth',
};

export function ShelfToolbar({ query, onChange, counts, tags, view, onViewChange }: Props) {
  const ids = { search: useId(), status: useId(), tag: useId(), sort: useId() };
  const set = <K extends keyof ShelfQuery>(key: K, value: ShelfQuery[K]) => onChange({ ...query, [key]: value });
  // Phones fold the pickers away so books start near the top; desktop always shows them.
  const [pickersOpen, setPickersOpen] = useState(false);
  const activePickers = Number(query.status !== 'any') + Number(query.tagId !== 'any') + Number(query.sort !== 'added');
  const pickersId = useId();

  return (
    <div className="mt-6 space-y-4">
      <div className="relative">
        <label htmlFor={ids.search} className="sr-only">
          Search your shelf
        </label>
        <MagnifyingGlass size={20} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-text-faint" aria-hidden="true" />
        <input
          id={ids.search}
          type="search"
          value={query.search}
          onChange={(event) => set('search', event.target.value)}
          placeholder="Search titles, authors, shelves"
          autoComplete="off"
          className="field pl-11"
        />
        {query.search && (
          <button
            type="button"
            onClick={() => set('search', '')}
            aria-label="Clear search"
            className="absolute top-1/2 right-1 flex size-10 -translate-y-1/2 items-center justify-center text-text-muted hover:text-text"
          >
            <X size={18} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:px-0" role="group" aria-label="Show">
        {FLAGS.map((flag) => {
          const active = query.flag === flag.value;
          return (
            <button
              key={flag.value}
              type="button"
              aria-pressed={active}
              onClick={() => set('flag', flag.value)}
              className={`flex min-h-11 shrink-0 items-center gap-2 rounded-board px-3.5 text-[0.9rem] transition-colors duration-150 ${
                active ? `${ACTIVE[flag.value]} font-semibold` : 'text-text-muted shadow-[inset_0_0_0_1px_var(--rule)] hover:text-text'
              }`}
            >
              {flag.label}
              <span className={`tabular-nums ${active ? 'opacity-80' : 'text-text-faint'}`}>{counts[flag.value]}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3 md:hidden">
        <button
          type="button"
          aria-expanded={pickersOpen}
          aria-controls={pickersId}
          onClick={() => setPickersOpen((open) => !open)}
          className="inline-flex min-h-11 items-center gap-2 rounded-board px-3.5 text-[0.9rem] text-text shadow-[inset_0_0_0_1px_var(--rule)]"
        >
          <FadersHorizontal size={18} aria-hidden="true" />
          Filter &amp; sort
          {activePickers > 0 && <span className="rounded-[2px] bg-surface-strong px-1.5 text-[0.8rem] tabular-nums">{activePickers}</span>}
        </button>
        <ViewToggle view={view} onViewChange={onViewChange} />
      </div>

      <div id={pickersId} className={`${pickersOpen ? 'flex' : 'hidden'} flex-wrap items-end gap-3 md:flex`}>
        <div className="min-w-[9.5rem] flex-1 md:flex-none">
          <label htmlFor={ids.status} className="block text-[0.8rem] text-text-muted">
            Status
          </label>
          <select id={ids.status} value={query.status} onChange={(event) => set('status', event.target.value as ShelfQuery['status'])} className="field mt-1">
            <option value="any">Any status</option>
            {BOOK_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>
        {tags.length > 0 && (
          <div className="min-w-[9.5rem] flex-1 md:flex-none">
            <label htmlFor={ids.tag} className="block text-[0.8rem] text-text-muted">
              Shelf
            </label>
            <select id={ids.tag} value={query.tagId} onChange={(event) => set('tagId', event.target.value)} className="field mt-1">
              <option value="any">All shelves</option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="min-w-[9.5rem] flex-1 md:flex-none">
          <label htmlFor={ids.sort} className="block text-[0.8rem] text-text-muted">
            Sort by
          </label>
          <select id={ids.sort} value={query.sort} onChange={(event) => set('sort', event.target.value as SortKey)} className="field mt-1">
            {SORTS.map((sort) => (
              <option key={sort.value} value={sort.value}>
                {sort.label}
              </option>
            ))}
          </select>
        </div>

        <div className="ml-auto hidden md:block">
          <ViewToggle view={view} onViewChange={onViewChange} />
        </div>
      </div>
    </div>
  );
}

function ViewToggle({ view, onViewChange }: { view: ViewMode; onViewChange: (view: ViewMode) => void }) {
  return (
    <div className="inline-grid grid-cols-2 rounded-board p-1 shadow-[inset_0_0_0_1px_var(--rule)]" role="group" aria-label="View">
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
          className={`flex min-h-10 min-w-11 items-center justify-center gap-1.5 rounded-[2px] px-3 text-[0.85rem] transition-colors duration-150 ${
            view === value ? 'bg-surface-strong text-text' : 'text-text-muted hover:text-text'
          }`}
        >
          <Icon size={18} weight={view === value ? 'fill' : 'regular'} aria-hidden="true" />
          <span className="hidden sm:inline">{label}</span>
          <span className="sr-only sm:hidden">{label}</span>
        </button>
      ))}
    </div>
  );
}
