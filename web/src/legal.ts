/** Who runs BookTrap and where to reach them: shown in the policies, the footer and Settings. */
export const OPERATOR = 'VistaHunt Co.';
// Cloudflare Email Routing forwards it to the operator's inbox.
export const CONTACT_EMAIL = 'hello@booktrap.app';

/** Tips for the operator (Ko-fi): voluntary, unlock nothing (terms). */
export const SUPPORT_URL = 'https://ko-fi.com/zalhashemi';

export function contactHref(subject?: string): string {
  return `mailto:${CONTACT_EMAIL}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`;
}
