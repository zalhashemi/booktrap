/**
 * Where the Turnstile checkbox shows, should Cloudflare want a click (`captchaToken` renders into the
 * newest slot on the page). It takes no room until then: captcha.ts marks it `data-captcha-shown`, and
 * `className` gives the spacing for that state.
 */
export function CaptchaSlot({ className = '' }: { className?: string }) {
  return <div data-captcha-slot="" className={className} />;
}
