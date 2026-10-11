import { Books, GearSix, Plus, type Icon } from '@phosphor-icons/react';
import { Link, NavLink, Outlet, useMatches } from 'react-router';
import { contactHref } from '../legal';
import { useAccount } from '../account/account-context';
import { AuthSheetProvider } from './AuthSheet';
import { ConnectionGate } from './ConnectionGate';
import { LibraryBackdrop, ShelfFooter } from './LibraryBackdrop';

interface Tab {
  to: string;
  label: string;
  icon: Icon;
}

const TABS: Tab[] = [
  { to: '/', label: 'Add', icon: Plus },
  { to: '/shelf', label: 'Shelf', icon: Books },
  { to: '/settings', label: 'Settings', icon: GearSix },
];

export function AppShell() {
  // Pages that don't need a shelf (the privacy policy and terms) skip the connection gate.
  const open = useMatches().some((match) => (match.handle as { open?: boolean } | undefined)?.open);
  return (
    <AuthSheetProvider>
      <div className="flex min-h-dvh flex-col">
        <LibraryBackdrop />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-pill focus:bg-surface focus:px-4 focus:py-2"
        >
          Skip to content
        </a>

        <header className="sticky top-0 z-20 bg-ground">
          <div className="mx-auto flex h-16 w-full max-w-[1080px] items-center justify-between px-4 md:h-[4.5rem] md:px-8">
            <Link to="/" className="wordmark -mx-1 inline-flex min-h-11 items-center px-1 text-[1.45rem] md:text-[1.6rem]" aria-label="BookTrap home">
              BookTrap
            </Link>
            <nav aria-label="Main" className="hidden md:block">
              <ul className="flex items-center gap-1 rounded-pill bg-surface p-1 shadow-[inset_0_0_0_1.5px_var(--rule)]">
                {TABS.map(({ to, label, icon: TabIcon }) => (
                  <li key={to}>
                    <NavLink
                      to={to}
                      end={to === '/'}
                      className={({ isActive }) =>
                        `flex h-11 items-center gap-2 rounded-pill px-4 text-[0.95rem] font-bold transition-colors duration-200 ${
                          isActive ? 'bg-accent text-on-tab' : 'text-text-muted hover:text-text'
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <TabIcon size={18} weight={isActive ? 'fill' : 'bold'} aria-hidden="true" />
                          {label}
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </header>

        <StorageNotice />

        <main id="main" className="mx-auto w-full max-w-[1080px] flex-1 px-4 pt-6 pb-36 md:px-8 md:pt-10 md:pb-20">
          <ConnectionGate open={open}>
            <Outlet />
          </ConnectionGate>
          <SiteFooter />
        </main>
        <ShelfFooter />

        {/* Phones: a floating tab bar within thumb reach, clear of the home indicator. */}
        <nav aria-label="Main" className="fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-20 md:hidden">
          <ul className="grid h-16 grid-cols-3 gap-1 rounded-[22px] bg-ground-raised p-1.5 shadow-[var(--elev-lift),inset_0_0_0_1.5px_var(--rule)]">
            {TABS.map(({ to, label, icon: TabIcon }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={to === '/'}
                  className={({ isActive }) =>
                    `flex h-full flex-col items-center justify-center gap-0.5 rounded-[16px] text-[0.75rem] font-bold transition-colors duration-200 ${
                      isActive ? 'bg-accent text-on-tab' : 'text-text-muted active:bg-surface'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <TabIcon size={22} weight={isActive ? 'fill' : 'bold'} aria-hidden="true" />
                      {label}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </AuthSheetProvider>
  );
}

function SiteFooter() {
  const link = 'inline-flex min-h-11 items-center px-2 underline-offset-[0.2em] hover:text-text hover:underline';
  return (
    <footer className="mt-16 border-t-[1.5px] border-rule pt-4 text-sm text-text-muted md:mt-20">
      <nav aria-label="About BookTrap">
        <ul className="-mx-2 flex flex-wrap items-center">
          <li>
            <Link to="/privacy" className={link}>
              Privacy
            </Link>
          </li>
          <li>
            <Link to="/terms" className={link}>
              Terms
            </Link>
          </li>
          <li>
            <a href={contactHref()} className={link}>
              Contact
            </a>
          </li>
        </ul>
      </nav>
    </footer>
  );
}

/** Shown only when the browser refuses to store anything: the shelf would vanish with the tab. */
function StorageNotice() {
  const { user, durable } = useAccount();
  if (!user || durable) return null;
  return (
    <div role="status" className="mx-auto mt-2 w-full max-w-[1080px] px-4 md:px-8">
      <p className="rounded-card bg-surface px-4 py-3 text-sm text-note-ink shadow-[inset_0_0_0_1.5px_var(--note)]">
        This browser isn’t letting BookTrap save anything, so this shelf disappears when you close the tab.
        Private browsing is the usual cause.
      </p>
    </div>
  );
}
