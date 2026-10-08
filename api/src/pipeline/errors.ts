/**
 * A failure with a message written for the reader, shown next to the link in the job panel
 * (brief §11: deleted video, private account, region lock, scraper timeout...).
 */
export type PipelineErrorCode =
  | 'not_a_post'
  | 'unreachable'
  | 'unavailable'
  | 'private_collection'
  | 'collection_unsupported'
  | 'scraper_failed'
  | 'media_failed'
  | 'extraction_failed'
  | 'budget_exhausted'
  | 'paused';

export class PipelineError extends Error {
  constructor(
    readonly code: PipelineErrorCode,
    /** Shown to the user as-is. */
    readonly userMessage: string,
    /** Retrying might work (timeouts, 5xx). */
    readonly retryable = false,
    /** The underlying error (server logs only) and any money already spent before failing. */
    options?: { cause?: unknown; costUsd?: number },
  ) {
    super(userMessage, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'PipelineError';
    this.costUsd = options?.costUsd ?? 0;
  }

  /** Spend incurred before the failure (paid scraper runs, billed model calls). */
  costUsd: number;
}
