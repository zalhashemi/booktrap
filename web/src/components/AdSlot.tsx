import { useEffect, useRef, useState } from 'react';
import { ADSENSE_CLIENT, AD_SLOTS, adsEnabled, loadAdsense, requestAd, type AdPosition } from '../ads/ads';

/** Phones get a 320×100 banner, wider screens a 728×90 leaderboard: small, fixed, never a takeover. */
const SIZES = { phone: { width: 320, height: 100 }, wide: { width: 728, height: 90 } } as const;

/**
 * One ad, in a quiet card labelled "Advertisement". Its height is held before the ad arrives, so the page
 * never jumps, and the card disappears when Google has no ad for it (or the script is blocked).
 * Development shows an empty placeholder instead, to check the layout.
 */
export function AdSlot({ position, className = '' }: { position: AdPosition; className?: string }) {
  const live = adsEnabled();
  const [blocked, setBlocked] = useState(false);
  const pushed = useRef(false);
  // Chosen once: an ad unit can't change size after it's been filled.
  const [size] = useState(() => (window.matchMedia?.('(min-width: 768px)').matches ? SIZES.wide : SIZES.phone));

  useEffect(() => {
    if (!live || pushed.current) return;
    pushed.current = true;
    let active = true;
    void loadAdsense().then((ok) => {
      if (!active) return;
      if (ok) requestAd();
      else setBlocked(true);
    });
    return () => {
      active = false;
    };
  }, [live]);

  if (blocked || (!live && !import.meta.env.DEV)) return null;

  return (
    <aside aria-label="Advertisement" className={`ad-card mx-auto w-fit max-w-full ${className}`}>
      <p className="mb-1.5 text-center text-[0.68rem] font-bold tracking-[0.12em] text-text-faint uppercase">Advertisement</p>
      <div className="overflow-hidden rounded-[14px] bg-surface shadow-[inset_0_0_0_1.5px_var(--rule)]" style={{ width: size.width, height: size.height, maxWidth: '100%' }}>
        {live ? (
          <ins
            className="adsbygoogle"
            style={{ display: 'inline-block', width: size.width, height: size.height }}
            data-ad-client={ADSENSE_CLIENT}
            data-ad-slot={AD_SLOTS[position]}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-text-faint">
            Ad ({position}, {size.width}×{size.height})
          </div>
        )}
      </div>
    </aside>
  );
}
