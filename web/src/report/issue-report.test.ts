import { describe, expect, it } from 'vitest';
import { issueMailto, issueReport } from './issue-report';

const base = {
  page: '/shelf',
  browser: 'Mozilla/5.0 Test',
  account: 'Guest (user 1234)',
  at: new Date('2026-10-13T10:00:00Z'),
};

describe('issueReport', () => {
  it('puts the reader’s words first and the app’s details after', () => {
    const { subject, body } = issueReport({ ...base, what: 'The PDF never downloads', steps: 'Export → PDF', context: { error: 'Couldn’t make the PDF.' } });
    expect(subject).toBe('BookTrap issue: The PDF never downloads');
    expect(body).toMatch(/^What went wrong:\nThe PDF never downloads\n\nWhat I was doing:\nExport → PDF\n\n-- Added by BookTrap --\nError: Couldn’t make the PDF\.\nPage: \/shelf/);
    expect(body).toContain('Account: Guest (user 1234)');
  });

  it('names the error in the subject when the reader wrote nothing', () => {
    const { subject, body } = issueReport({ ...base, what: ' ', steps: '', context: { error: 'Instagram didn’t return this post.', link: 'https://instagram.com/p/x' } });
    expect(subject).toBe('BookTrap issue: Instagram didn’t return this post.');
    expect(body).toContain('(not filled in)');
    expect(body).toContain('Link: https://instagram.com/p/x');
  });

  it('trims a long story so the mail link stays short, keeping the details', () => {
    const { body } = issueReport({ ...base, what: 'x'.repeat(5000), steps: 'y'.repeat(5000), context: {} });
    expect(body.length).toBeLessThanOrEqual(1800);
    expect(body).toContain('-- Added by BookTrap --');
    expect(body).toContain('Browser: Mozilla/5.0 Test');
  });
});

describe('issueMailto', () => {
  it('encodes spaces as %20 and new lines as %0A', () => {
    expect(issueMailto({ subject: 'a b+c', body: 'one\ntwo' })).toBe('mailto:issues@booktrap.app?subject=a%20b%2Bc&body=one%0Atwo');
  });
});
