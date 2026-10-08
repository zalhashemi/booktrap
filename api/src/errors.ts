import type { ApiError, ERROR_CODES } from '@booktrap/shared';

type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function errorBody(code: string, message: string): ApiError {
  return { error: { code, message } };
}
