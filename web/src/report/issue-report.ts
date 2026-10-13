import { ISSUE_EMAIL } from '../legal';

/** What the app knew when "Report" was pressed: the error shown, and the link it was about. */
export interface IssueContext {
  error?: string | null;
  link?: string | null;
}

export interface IssueReportInput {
  what: string;
  steps: string;
  context: IssueContext;
  page: string;
  browser: string;
  account: string;
  at: Date;
}

/** Mail apps cut off (or refuse) very long mailto links: the reader's own text is trimmed to fit. */
const MAX_BODY_CHARS = 1800;

/** The details the app adds, shown in the sheet too so the reader sees exactly what's sent. */
export function issueDetails({ context, page, browser, account, at }: Omit<IssueReportInput, 'what' | 'steps'>): [string, string][] {
  const rows: [string, string][] = [];
  if (context.error) rows.push(['Error', context.error]);
  if (context.link) rows.push(['Link', context.link]);
  rows.push(['Page', page], ['Time', at.toISOString()], ['Account', account], ['Browser', browser]);
  return rows;
}

export function issueReport(input: IssueReportInput): { subject: string; body: string } {
  const details = issueDetails(input)
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n');
  const tail = `\n\n-- Added by BookTrap --\n${details}`;
  const room = Math.max(200, MAX_BODY_CHARS - tail.length);
  const what = input.what.trim() || '(not filled in)';
  const steps = input.steps.trim() || '(not filled in)';
  let story = `What went wrong:\n${what}\n\nWhat I was doing:\n${steps}`;
  if (story.length > room) story = `${story.slice(0, room - 1)}…`;
  const summary = (input.what.trim() || input.context.error || 'Something isn’t working').replace(/\s+/g, ' ');
  return {
    subject: `BookTrap issue: ${summary.length > 60 ? `${summary.slice(0, 59)}…` : summary}`,
    body: story + tail,
  };
}

export function issueMailto({ subject, body }: { subject: string; body: string }): string {
  // encodeURIComponent, not URLSearchParams: mail apps read "+" as a plus, not a space.
  return `mailto:${ISSUE_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
