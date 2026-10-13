/**
 * Google AdSense: two small ads on the Add, Shelf and Settings pages (user's pick, 13 Oct 2026). The
 * publisher and ad unit ids are public (they're in every page that shows an ad). Google's own consent
 * message (AdSense, Privacy & messaging) comes with the same script and asks visitors in the EEA, UK
 * and Switzerland before any ad cookie is set.
 */
export const ADSENSE_CLIENT = 'ca-pub-2177461915964216';

/** The two ad units made in AdSense ("BookTrap top" and "BookTrap bottom"). */
export const AD_SLOTS = { top: '8145933886', bottom: '3017905296' } as const;
export type AdPosition = keyof typeof AD_SLOTS;

const SCRIPT_URL = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`;

/** Only the live site shows ads: never local development, previews or tests (AdSense counts those as invalid traffic). */
export function adsEnabled(hostname = window.location.hostname): boolean {
  return hostname === 'booktrap.app' || hostname === 'www.booktrap.app';
}

declare global {
  interface Window {
    adsbygoogle?: unknown[];
    googlefc?: { callbackQueue?: unknown[]; showRevocationMessage?: () => void };
  }
}

let loading: Promise<boolean> | null = null;

/** Loads the AdSense script once. False when it can't load (an ad blocker, say): ad spaces then stay hidden. */
export function loadAdsense(): Promise<boolean> {
  loading ??= new Promise<boolean>((resolve) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.append(script);
  });
  return loading;
}

/** Fills one ad space (an <ins class="adsbygoogle"> already in the page). */
export function requestAd(): void {
  (window.adsbygoogle ??= []).push({});
}

/** Reopens Google's consent message, so a visitor can change their ad choices ("Privacy choices"). */
export function showPrivacyChoices(): void {
  const fc = (window.googlefc ??= {});
  (fc.callbackQueue ??= []).push(() => window.googlefc?.showRevocationMessage?.());
}
