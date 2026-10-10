/** Who runs BookTrap and where to reach them: shown in the policies, the footer and Settings. */
export const OPERATOR = 'VistaHunt Co.';
export const CONTACT_EMAIL = 'vistahuntco@gmail.com';

export function contactHref(subject?: string): string {
  return `mailto:${CONTACT_EMAIL}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`;
}
