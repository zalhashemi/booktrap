import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowCounterClockwise, ArrowLeft, ArrowSquareOut, LockSimple, Prohibit, SignOut } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ADMIN_TABS,
  PLATFORM_LABELS,
  REPORT_REASON_LABELS,
  type AdminPost,
  type AdminTab,
  type BlockedKind,
  type ReportReason,
} from '@booktrap/shared';
import { createAdminClient, type AdminClient } from '../api/admin';
import { ApiRequestError } from '../api/client';
import { Button } from '../components/Button';
import { PlatformIcon } from '../components/PlatformIcon';
import { useToast } from '../components/toast-context';

/** Kept for this tab only: closing it forgets the key. */
const KEY_STORAGE = 'booktrap.admin-key';
const readKey = () => {
  try {
    return sessionStorage.getItem(KEY_STORAGE);
  } catch {
    return null;
  }
};

const TAB_LABELS: Record<AdminTab, string> = { open: 'Open', blocked: 'Auto-blocked', removed: 'Taken down', dismissed: 'Dismissed' };
const EMPTY: Record<AdminTab, string> = {
  open: 'No open reports. Nothing is waiting.',
  blocked: 'No posts have been blocked by the content check.',
  removed: 'Nothing has been taken down.',
  dismissed: 'No dismissed reports.',
};
const BLOCKED_LABELS: Record<BlockedKind, string> = {
  explicit: 'Explicit, not books',
  graphic: 'Graphic violence',
  refused: 'Claude declined to read it',
  removed: 'Taken down',
};
const HOT: ReportReason[] = ['explicit', 'graphic'];
const day = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const keyOf = (post: Pick<AdminPost, 'platform' | 'postId'>) => `${post.platform}:${post.postId}`;
const whoOf = (post: AdminPost) => (post.creatorHandle ? `@${post.creatorHandle}` : `${PLATFORM_LABELS[post.platform]} post`);

/** The hidden admin page (user's pick, option B): reported posts beside the chosen one's detail. Linked from nowhere. */
export function AdminPage() {
  const [key, setKey] = useState<string | null>(readKey);
  const queryClient = useQueryClient();
  const lock = () => {
    try {
      sessionStorage.removeItem(KEY_STORAGE);
    } catch {
      // Private mode: the key was only ever in memory.
    }
    queryClient.removeQueries({ queryKey: ['admin'] });
    setKey(null);
  };

  return (
    <div className="min-h-dvh bg-ground text-text">
      <title>Admin · BookTrap</title>
      <meta name="robots" content="noindex, nofollow" />
      <header className="mx-auto flex h-16 w-full max-w-[1080px] items-center justify-between px-4 md:h-[4.5rem] md:px-8">
        <span className="wordmark text-[1.45rem] md:text-[1.6rem]">
          BookTrap <span className="ml-1 align-middle font-sans text-[0.8rem] font-bold text-note-ink">admin</span>
        </span>
        {key && (
          <Button variant="ghost" onClick={lock} className="px-4 text-[0.92rem]">
            <SignOut size={18} weight="bold" aria-hidden="true" />
            Lock
          </Button>
        )}
      </header>
      <main className="mx-auto w-full max-w-[1080px] px-4 pt-2 pb-16 md:px-8 md:pt-6">
        {key ? <Reports client={createAdminClient(key)} onLocked={lock} /> : <KeyGate onKey={setKey} />}
      </main>
    </div>
  );
}

function KeyGate({ onKey }: { onKey: (key: string) => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = { field: useId(), error: useId() };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const key = value.trim();
    if (!key || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createAdminClient(key).check();
      try {
        sessionStorage.setItem(KEY_STORAGE, key);
      } catch {
        // Private mode: keep it in memory for this visit.
      }
      onKey(key);
    } catch (failure) {
      setError(failure instanceof ApiRequestError && failure.status === 401 ? 'That admin key isn’t right.' : 'Couldn’t reach BookTrap. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="mx-auto mt-[8vh] max-w-[440px] rounded-card bg-surface p-5 shadow-[inset_0_0_0_1.5px_var(--rule)] md:p-6">
      <h1 className="font-display text-[1.7rem] leading-tight">Admin</h1>
      <p className="mt-1.5 text-text-muted">Enter the admin key. It stays in this tab only.</p>
      <label htmlFor={ids.field} className="mt-5 block text-[0.92rem] font-bold">
        Admin key
      </label>
      <input
        id={ids.field}
        type="password"
        autoComplete="off"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? ids.error : undefined}
        className="field mt-1.5"
      />
      {error && (
        <p id={ids.error} role="alert" className="mt-2 text-sm text-note-ink">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy || !value.trim()} className="mt-5">
        <LockSimple size={18} weight="bold" aria-hidden="true" />
        {busy ? 'Checking…' : 'Open reports'}
      </Button>
    </form>
  );
}

function Reports({ client, onLocked }: { client: AdminClient; onLocked: () => void }) {
  const [tab, setTab] = useState<AdminTab>('open');
  const [selected, setSelected] = useState<string | null>(null);
  const posts = useQuery({ queryKey: ['admin', tab], queryFn: () => client.posts(tab) });

  // The key stopped working (rotated on the server): back to the key screen.
  useEffect(() => {
    if (posts.error instanceof ApiRequestError && posts.error.status === 401) onLocked();
  }, [posts.error, onLocked]);

  const list = posts.data?.posts ?? [];
  const chosen = list.find((post) => keyOf(post) === selected) ?? null;
  const counts = posts.data?.counts;
  const waiting = counts?.open ?? 0;

  return (
    <>
      <h1 className="font-display text-[2.2rem] leading-[1.05] md:text-[3.1rem]">Reports</h1>
      <p className="mt-3 max-w-[60ch] text-[1.05rem] text-text-muted">
        {counts ? `${waiting} ${waiting === 1 ? 'report' : 'reports'} waiting. ` : ''}Taking a post down removes it from every shelf and stops it being read again.
      </p>

      <TakedownByLink client={client} />

      <div className="mt-6 overflow-x-auto [scrollbar-width:none]">
        <div className="tab-row min-w-max" role="group" aria-label="Show">
          {ADMIN_TABS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={tab === value}
              onClick={() => {
                setTab(value);
                setSelected(null);
              }}
              className="page-tab bg-[color-mix(in_srgb,var(--accent)_14%,var(--surface))] aria-pressed:bg-accent"
            >
              {TAB_LABELS[value]}
              {counts && <span className="tabular-nums">{counts[value]}</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="h-1.5 rounded-[3px] bg-accent" />

      <div className="mt-5" aria-live="polite">
        {posts.isPending ? (
          <p className="text-text-muted">Loading…</p>
        ) : posts.isError ? (
          <p role="alert" className="text-note-ink">
            Couldn’t load this list. <button type="button" onClick={() => void posts.refetch()} className="inline-flex min-h-11 items-center font-bold text-accent-ink underline underline-offset-4">Try again</button>
          </p>
        ) : list.length === 0 ? (
          <p className="text-text-muted">{EMPTY[tab]}</p>
        ) : (
          <div className="grid gap-5 min-[900px]:grid-cols-[340px_minmax(0,1fr)] min-[900px]:items-start">
            <ul className={`grid gap-1 ${chosen ? 'max-[899px]:hidden' : ''}`} aria-label={`${TAB_LABELS[tab]} posts`}>
              {list.map((post) => (
                <li key={keyOf(post)}>
                  <button
                    type="button"
                    aria-current={chosen && keyOf(chosen) === keyOf(post) ? 'true' : undefined}
                    onClick={() => setSelected(keyOf(post))}
                    className={`flex min-h-14 w-full items-center gap-3 rounded-[14px] px-3 py-2 text-left transition-shadow duration-150 ${
                      chosen && keyOf(chosen) === keyOf(post) ? 'bg-surface shadow-[inset_0_0_0_2px_var(--accent-ink)]' : 'hover:bg-surface'
                    }`}
                  >
                    <PlatformIcon platform={post.platform} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.92rem] font-bold">{whoOf(post)}</span>
                      <span className="block truncate text-[0.8rem] text-text-muted">
                        {post.reports[0] ? REPORT_REASON_LABELS[post.reports[0].reason].label : post.blocked ? BLOCKED_LABELS[post.blocked] : ''}, {day.format(new Date(post.last))}
                      </span>
                    </span>
                    {post.reports.length > 0 && <CountPill n={post.reports.length} />}
                  </button>
                </li>
              ))}
            </ul>
            {chosen ? (
              <PostDetail key={keyOf(chosen)} post={chosen} tab={tab} client={client} onBack={() => setSelected(null)} />
            ) : (
              <p className="hidden rounded-card bg-surface-sunk px-5 py-6 text-text-muted min-[900px]:block">Choose a post to see its reports and what a takedown would remove.</p>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function CountPill({ n }: { n: number }) {
  return (
    <span className="shrink-0 rounded-pill bg-[color-mix(in_srgb,var(--note)_40%,var(--surface))] px-2.5 py-0.5 text-[0.8rem] font-extrabold text-note-ink tabular-nums">
      {n}
      <span className="sr-only"> {n === 1 ? 'report' : 'reports'}</span>
    </span>
  );
}

function PostDetail({ post, tab, client, onBack }: { post: AdminPost; tab: AdminTab; client: AdminClient; onBack: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const queryClient = useQueryClient();
  const toast = useToast();
  const done = (message: string) => {
    toast(message);
    void queryClient.invalidateQueries({ queryKey: ['admin'] });
  };
  const failed = (error: unknown) => toast(error instanceof ApiRequestError ? error.message : 'Couldn’t reach BookTrap. Try again.');
  const ref = { platform: post.platform, postId: post.postId };
  // Asked for the chosen post only: what a takedown would remove right now.
  const reachQuery = useQuery({ queryKey: ['admin', 'reach', post.platform, post.postId], queryFn: () => client.reach(ref), enabled: tab !== 'removed' });
  const takeDown = useMutation({
    mutationFn: () => client.takeDown(ref),
    onSuccess: (r) => done(`Taken down: ${r.sourcesRemoved} ${r.sourcesRemoved === 1 ? 'source' : 'sources'} removed, ${r.booksDeleted} deleted, ${r.booksKept} kept.`),
    onError: failed,
  });
  const dismiss = useMutation({ mutationFn: () => client.dismiss(ref), onSuccess: () => done('Reports dismissed.'), onError: failed });
  const unblock = useMutation({
    mutationFn: () => client.unblock(ref),
    onSuccess: (r) => done(r.unblocked ? 'Unblocked.' : 'It wasn’t blocked any more.'),
    onError: failed,
  });
  const busy = takeDown.isPending || dismiss.isPending || unblock.isPending;
  const reasons = Object.entries(
    post.reports.reduce<Record<string, number>>((tally, report) => ({ ...tally, [report.reason]: (tally[report.reason] ?? 0) + 1 }), {}),
  ) as [ReportReason, number][];
  const notes = post.reports.filter((report) => report.note);
  const reach = reachQuery.data ?? null;

  return (
    <article className="grid gap-3.5 rounded-card bg-surface p-4 shadow-[inset_0_0_0_1.5px_var(--rule)] md:px-6 md:py-5" aria-labelledby="post-who">
      <button type="button" onClick={onBack} className="-my-1 inline-flex min-h-11 items-center gap-1.5 justify-self-start text-[0.92rem] font-bold text-text-muted min-[900px]:hidden">
        <ArrowLeft size={18} weight="bold" aria-hidden="true" />
        All {TAB_LABELS[tab].toLowerCase()} posts
      </button>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {post.url ? (
          <a id="post-who" href={post.url} target="_blank" rel="noreferrer" className="-my-2 inline-flex min-h-11 items-center gap-2 font-bold underline-offset-4 hover:underline">
            <PlatformIcon platform={post.platform} />
            {whoOf(post)}
            <ArrowSquareOut size={18} className="text-text-faint" aria-label="Opens the post in a new tab" />
          </a>
        ) : (
          <span id="post-who" className="inline-flex items-center gap-2 font-bold">
            <PlatformIcon platform={post.platform} />
            {whoOf(post)}
          </span>
        )}
        {post.reports.length > 0 && (
          <span className="ml-auto">
            <CountPill n={post.reports.length} />
          </span>
        )}
      </div>

      {(reasons.length > 0 || post.blocked) && (
        <p className="flex flex-wrap gap-1.5">
          {post.blocked && <Tag hot>{BLOCKED_LABELS[post.blocked]}</Tag>}
          {reasons.map(([reason, n]) => (
            <Tag key={reason} hot={HOT.includes(reason)}>
              {REPORT_REASON_LABELS[reason].label}
              {n > 1 ? ` ×${n}` : ''}
            </Tag>
          ))}
        </p>
      )}
      {notes.length > 0 && (
        <ul className="grid gap-1.5 text-[0.92rem] text-text-muted italic">
          {notes.map((report) => (
            <li key={report.id}>“{report.note}”</li>
          ))}
        </ul>
      )}
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-[0.82rem] text-text-faint tabular-nums">
        {reach && (
          <>
            <span>
              On {reach.shelves} {reach.shelves === 1 ? 'shelf' : 'shelves'}
            </span>
            <span>
              {reach.onlyHere} {reach.onlyHere === 1 ? 'book' : 'books'} seen only here{reach.edited ? ` (${reach.edited} changed by readers, kept)` : ''}
            </span>
          </>
        )}
        <span>{post.reports.length ? `First ${day.format(new Date(post.since))}, last ${day.format(new Date(post.last))}` : day.format(new Date(post.since))}</span>
        <span>
          {PLATFORM_LABELS[post.platform]} {post.postId}
        </span>
      </p>

      {tab === 'blocked' && <p className="text-[0.92rem] text-text-muted">Unblocking marks it as a book post: the next paste shelves its books without reading it again.</p>}
      {tab === 'removed' && <p className="text-[0.92rem] text-text-muted">Unblocking lets it be read again. Books it already lost don’t come back.</p>}

      {confirming ? (
        <div role="alert" className="rounded-[16px] bg-surface-sunk p-4 shadow-[inset_0_0_0_1.5px_var(--note)]">
          <p className="font-display text-[1.2rem]">Take down {whoOf(post)}’s post?</p>
          <p className="mt-1 text-text-muted">
            {reach
              ? `It leaves ${reach.shelves} ${reach.shelves === 1 ? 'shelf' : 'shelves'}, ${reach.onlyHere - reach.edited} ${reach.onlyHere - reach.edited === 1 ? 'book' : 'books'} seen only in it ${reach.onlyHere - reach.edited === 1 ? 'is' : 'are'} deleted, and pasting it again won’t read it.`
              : 'It leaves every shelf, and pasting it again won’t read it.'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2.5">
            <Button variant="quiet" autoFocus onClick={() => setConfirming(false)} className="px-5 text-[0.92rem]">
              Keep it
            </Button>
            <Button variant="quiet" disabled={busy} onClick={() => takeDown.mutate()} className="px-5 text-[0.92rem] text-note-ink shadow-[inset_0_0_0_1.5px_var(--note)]">
              <Prohibit size={18} weight="bold" aria-hidden="true" />
              {takeDown.isPending ? 'Taking down…' : 'Take it down'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2.5">
          {tab !== 'removed' && (
            <Button variant="quiet" disabled={busy} onClick={() => setConfirming(true)} className="px-5 text-[0.92rem] text-note-ink shadow-[inset_0_0_0_1.5px_var(--note)]">
              <Prohibit size={18} weight="bold" aria-hidden="true" />
              Take down
            </Button>
          )}
          {tab === 'open' && (
            <Button variant="ghost" disabled={busy} onClick={() => dismiss.mutate()} className="px-5 text-[0.92rem]">
              Dismiss
            </Button>
          )}
          {(tab === 'blocked' || tab === 'removed') && (
            <Button variant="quiet" disabled={busy} onClick={() => unblock.mutate()} className="px-5 text-[0.92rem]">
              <ArrowCounterClockwise size={18} weight="bold" aria-hidden="true" />
              Unblock
            </Button>
          )}
        </div>
      )}
    </article>
  );
}

function Tag({ hot = false, children }: { hot?: boolean; children: ReactNode }) {
  return (
    <span
      className={`rounded-pill px-2.5 py-0.5 text-[0.8rem] font-bold ${hot ? 'bg-surface text-note-ink shadow-[inset_0_0_0_1.5px_var(--note)]' : 'bg-surface-sunk text-text-muted'}`}
    >
      {children}
    </span>
  );
}

/** For removal requests that arrive by email: paste the post's link and take it down. */
function TakedownByLink({ client }: { client: AdminClient }) {
  const [url, setUrl] = useState('');
  const [confirming, setConfirming] = useState(false);
  const queryClient = useQueryClient();
  const toast = useToast();
  const ids = { field: useId(), help: useId() };
  const takeDown = useMutation({
    mutationFn: () => client.takeDown({ url: url.trim() }),
    onSuccess: (r) => {
      toast(`Taken down: ${r.sourcesRemoved} ${r.sourcesRemoved === 1 ? 'source' : 'sources'} removed, ${r.booksDeleted} deleted, ${r.booksKept} kept.`);
      setUrl('');
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (error) => {
      setConfirming(false);
      toast(error instanceof ApiRequestError ? error.message : 'Couldn’t reach BookTrap. Try again.');
    },
  });

  return (
    <form
      className="mt-6 grid gap-2 rounded-card bg-surface p-4 shadow-[inset_0_0_0_1.5px_var(--rule)] md:px-6 md:py-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (url.trim()) setConfirming(true);
      }}
    >
      <label htmlFor={ids.field} className="text-[0.92rem] font-bold">
        Take down a link
      </label>
      <p id={ids.help} className="text-sm text-text-muted">
        For removal requests by email. Paste the post’s link.
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          id={ids.field}
          type="url"
          inputMode="url"
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            setConfirming(false);
          }}
          placeholder="https://www.tiktok.com/@…/video/…"
          aria-describedby={ids.help}
          className="field min-w-0 flex-[1_1_16rem]"
        />
        {confirming ? (
          <>
            <Button type="button" variant="quiet" disabled={takeDown.isPending} onClick={() => takeDown.mutate()} className="px-5 text-[0.92rem] text-note-ink shadow-[inset_0_0_0_1.5px_var(--note)]">
              <Prohibit size={18} weight="bold" aria-hidden="true" />
              {takeDown.isPending ? 'Taking down…' : 'Yes, take it down'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)} className="px-4 text-[0.92rem]">
              Cancel
            </Button>
          </>
        ) : (
          <Button type="submit" variant="quiet" disabled={!url.trim()} className="px-5 text-[0.92rem]">
            <Prohibit size={18} weight="bold" aria-hidden="true" />
            Take down
          </Button>
        )}
      </div>
    </form>
  );
}
