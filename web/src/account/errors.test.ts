import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { toAccountError } from './errors';

describe('toAccountError', () => {
  it.each([
    [new AuthApiError('A user with this email address has already been registered', 422, 'email_exists'), 'email_taken'],
    [new AuthApiError('Token has expired or is invalid', 403, 'otp_expired'), 'bad_code'],
    [new AuthApiError('Invalid login credentials', 400, 'invalid_credentials'), 'bad_login'],
    [new AuthApiError('Signups not allowed for otp', 422, 'otp_disabled'), 'bad_login'],
    [new AuthApiError('Password should be at least 8 characters.', 422, 'weak_password'), 'weak_password'],
    [new AuthApiError('Email rate limit exceeded', 429, 'over_email_send_rate_limit'), 'rate_limited'],
    [new AuthApiError('captcha protection: request disallowed (no captcha response)', 400, 'captcha_failed'), 'captcha'],
    [new AuthRetryableFetchError('Failed to fetch', 0), 'network'],
    [new TypeError('Failed to fetch'), 'network'],
  ])('maps %s', (error, code) => {
    expect(toAccountError(error).code).toBe(code);
  });

  it('says the email couldn’t be sent, not that the network is down, when Supabase’s mailer refuses', () => {
    const error = toAccountError(new AuthRetryableFetchError('Error sending email change email', 500));
    expect(error.code).toBe('unknown');
    expect(error.message).toMatch(/couldn’t send an email/);
  });
});
