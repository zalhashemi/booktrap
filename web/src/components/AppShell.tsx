import { Books, GearSix, Plus, type Icon } from '@phosphor-icons/react';
import { Link, NavLink, Outlet } from 'react-router';
import { useDevice } from '../device/DeviceProvider';
import { ConnectionGate } from './ConnectionGate';

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
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:bg-surface focus:px-4 focus:py-2"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-20 border-b border-rule-gold bg-ground">
        <div className="mx-auto flex h-14 w-full max-w-[1080px] items-center justify-between px-4 md:h-16 md:px-8">
          <Link to="/" className="foil -mx-1 inline-flex min-h-11 items-center px-1 text-[1.05rem] md:text-[1.2rem]" aria-label="BookTrap home">
            BookTrap
          </Link>
          <nav aria-label="Main" className="hidden md:block">
            <ul className="flex items-center gap-1">
              {TABS.map((tab) => (
                <li key={tab.to}>
                  <NavLink
                    to={tab.to}
                    end={tab.to === '/'}
                    className={({ isActive }) =>
                      `relative flex h-11 items-center px-4 text-[0.95rem] transition-colors duration-200 ${
                        isActive
                          ? 'text-gold-ink after:absolute after:inset-x-4 after:-bottom-[11px] after:h-[2px] after:bg-gold'
                          : 'text-text-muted hover:text-text'
                      }`
                    }
                  >
                    {tab.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>

      <StorageNotice />

      <main id="main" className="mx-auto w-full max-w-[1080px] flex-1 px-4 pt-8 pb-32 md:px-8 md:pt-12 md:pb-20">
        <ConnectionGate>
          <Outlet />
        </ConnectionGate>
      </main>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-rule-gold bg-ground-raised pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul className="grid h-16 grid-cols-3">
          {TABS.map(({ to, label, icon: TabIcon }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `flex h-full flex-col items-center justify-center gap-1 text-[0.75rem] font-medium tracking-[0.02em] transition-colors duration-200 ${
                    isActive ? 'text-gold-ink' : 'text-text-muted'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <TabIcon size={24} weight={isActive ? 'fill' : 'regular'} aria-hidden="true" />
                    {label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

/** Shown only when the browser refuses to store anything: the shelf would vanish with the tab. */
function StorageNotice() {
  const { session } = useDevice();
  if (!session || session.durable) return null;
  return (
    <div role="status" className="border-b border-rule bg-ground-raised">
      <p className="mx-auto max-w-[1080px] px-4 py-3 text-sm text-rose-ink md:px-8">
        This browser isn&rsquo;t letting BookTrap save anything, so this shelf disappears when you close the tab.
        Private browsing is the usual cause.
      </p>
    </div>
  );
}
