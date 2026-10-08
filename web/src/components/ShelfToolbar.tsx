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

/**
 * Each page-tab wears the colour of the state it stands for (lime only for New, lilac for Unsure,
 * teal for Verified, the accent for everything): a soft tint at rest, full colour when pulled up.
 */
const TAB_FILL: Record<Flag, string> = {
  all: 'bg-[color-mix(in_srgb,var(--accent)_22%,var(--surface))] aria-pressed:bg-accent',
  new: 'bg-[color-mix(in_srgb,var(--lime)_20%,var(--surface))] aria-pressed:bg-lime',
  unsure: 'bg-[color-mix(in_srgb,var(--unsure)_26%,var(--surface))] aria-pressed:bg-unsure',
  verified: 'bg-[color-mix(in_srgb,var(--success)_34%,var(--surface))] aria-pressed:bg-success aria-pressed:text-on-tab',
};

export function ShelfToolbar({ query, onChange, counts, tags, view, onViewChange }: Props) {
  const ids = { search: useId(), status: useId(), tag: useId(), sort: useId(), pickers: useId() };
  const set = <K extends keyof ShelfQuery>(key: K, value: ShelfQuery[K]) => onChange({ ...query, [key]: value });
  // Phones fold the pickers away so books start near the top; desktop always shows them.
  const [pickersOpen, setPickersOpen] = useState(false);
  const activePickers = Number(query.status !== 'any') + Number(query.tagId !== 'any') + Number(query.sort !== 'added');

  return (
    <div className="mt-6 space-y-5">
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
            className="field rounded-pill pr-11 pl-12"
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

      <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0">
        <div className="tab-row min-w-max" role="group" aria-label="Show">
          {FLAGS.map((flag) => {
            const active = query.flag === flag.value;
            return (
              <button key={flag.value} type="button" aria-pressed={active} onClick={() => set('flag', flag.value)} className={`page-tab ${TAB_FILL[flag.value]}`}>
                {flag.label}
                <span className="tabular-nums opacity-80">{counts[flag.value]}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="md:hidden">
        <button
          type="button"
          aria-expanded={pickersOpen}
          aria-controls={ids.pickers}
          onClick={() => setPickersOpen((open) => !open)}
          className="inline-flex min-h-11 items-center gap-2 rounded-pill bg-surface px-4 text-[0.92rem] font-bold shadow-[inset_0_0_0_1.5px_var(--rule)]"
        >
          <FadersHorizontal size={18} weight="bold" aria-hidden="true" />
          Filter &amp; sort
          {activePickers > 0 && <span className="rounded-pill bg-accent px-2 text-[0.78rem] text-on-tab tabular-nums">{activePickers}</span>}
        </button>
      </div>

      <div id={ids.pickers} className={`${pickersOpen ? 'grid' : 'hidden'} grid-cols-2 gap-3 md:flex md:flex-wrap md:items-end`}>
        <Picker id={ids.status} label="Status">
          <select id={ids.status} value={query.status} onChange={(event) => set('status', event.target.value as ShelfQuery['status'])} className="field">
            <option value="any">Any status</option>
            {BOOK_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </Picker>
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
    <div className="inline-flex shrink-0 rounded-pill bg-surface p-1 shadow-[inset_0_0_0_1.5px_var(--rule)]" role="group" aria-label="View">
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
          className={`flex h-10 min-w-11 items-center justify-center gap-1.5 rounded-pill px-3 text-[0.85rem] font-bold transition-colors duration-200 ${
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
