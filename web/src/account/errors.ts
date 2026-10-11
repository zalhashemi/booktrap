import { isAuthError, isAuthRetryableFetchError } from '@supabase/supabase-js';
import { NetworkError } from '../api/client';
import { AccountError } from './account-context';

/** Supabase's answers, in words the screens can show. */
export function toAccountError(error: unknown): AccountError {
  if (error instanceof AccountError) return error;
  if (isAuthRetryableFetchError(error) || error instanceof TypeError || error instanceof NetworkError) {
    return new AccountError('network', 'Couldn’t reach BookTrap. Check your connection and try again.');
  }
  if (isAuthError(error)) {
    switch (error.code) {
      case 'email_exists':
      case 'user_already_exists':
        return new AccountError('email_taken', 'That email already has a BookTrap account. Log in instead, and the books here join it.');
      case 'otp_expired':
        return new AccountError('bad_code', 'That code is wrong or has expired. Check the latest email, or send a new code.');
      case 'invalid_credentials':
        return new AccountError('bad_login', 'That email and password don’t match. Try again, or email yourself a code.');
      case 'otp_disabled':
      case 'signup_disabled':
      case 'user_not_found':
        return new AccountError('bad_login', 'No account uses that email. Save your shelf to make one.');
      case 'weak_password':
      case 'same_password':
        return new AccountError('weak_password', error.message);
      case 'over_email_send_rate_limit':
      case 'over_request_rate_limit':
        return new AccountError('rate_limited', 'Too many tries for now. Wait a few minutes, then try again.');
      case 'email_address_invalid':
        return new AccountError('unknown', 'That doesn’t look like an email address.');
      case 'email_address_not_authorized':
        return new AccountError('unknown', 'BookTrap can’t send email to that address yet. Try another one.');
    }
    if (error.status === 429) return new AccountError('rate_limited', 'Too many tries for now. Wait a few minutes, then try again.');
  }
  return new AccountError('unknown', 'Something went wrong on our side. Try again in a moment.');
}
