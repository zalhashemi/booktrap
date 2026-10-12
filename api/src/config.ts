import { z } from 'zod';

const csv = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
  );

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value?.trim() ? value.trim() : undefined));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8787),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Number of reverse proxies in front of the API whose X-Forwarded-For we trust. */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).optional(),

  // Accept either the project URL or the Data API URL Supabase also shows (…/rest/v1/):
  // supabase-js wants the bare origin and appends its own paths.
  SUPABASE_URL: optionalString.pipe(
    z
      .string()
      .url()
      .transform((value) => new URL(value).origin)
      .optional(),
  ),
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  // Used from phase 2 on. Optional here so the foundation runs without them.
  APIFY_TOKEN: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  GOOGLE_BOOKS_API_KEY: optionalString,
  /** Key for hashing client IPs (raw IPs are never stored). Required in production; development falls back. */
  IP_HASH_KEY: optionalString,
  /** Cached posts (books, link, creator, thumbnail) older than this are deleted; re-reading one costs again. */
  POST_CACHE_DAYS: z.coerce.number().int().min(1).default(90),
  /** The hidden admin page's key (reports and takedowns). Unset: the admin API doesn't exist. */
  ADMIN_TOKEN: optionalString.pipe(z.string().min(32, 'ADMIN_TOKEN must be at least 32 characters.').optional()),

  ALLOWED_ORIGIN: csv.default(['http://localhost:5180']),
  /** Posts a day for a signed-in user, and for a guest (an anonymous user who hasn't added an email). */
  DAILY_LINK_CAP_PER_USER: z.coerce.number().int().positive().default(40),
  DAILY_LINK_CAP_GUEST: z.coerce.number().int().positive().default(5),
  DAILY_LINK_CAP_PER_IP: z.coerce.number().int().positive().default(120),
  /** Estimated Apify + Claude spend per calendar month before processing pauses for everyone. */
  MONTHLY_BUDGET_USD: z.coerce.number().positive().default(20),
  MAX_VIDEOS_PER_COLLECTION: z.coerce.number().int().positive().default(100),
  /** Claude model that reads the posts. Sonnet 5.5 matched Opus 5.5 on the Phase 2 fixtures at half the cost. */
  EXTRACTION_MODEL: z.string().default('claude-sonnet-5-5'),
  EXTRACTION_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),
  /** Also add books only visible in the background of a post (e.g. a shelf behind the creator). */
  INCLUDE_BACKGROUND_BOOKS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  JOB_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  GLOBAL_SPEND_KILL_SWITCH: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  /**
   * Load-test mode (api/scripts/load): sessions signed by the load script's key (LOAD_TEST_JWKS_FILE),
   * Apify, Claude and the catalogue stubbed, delays times LOAD_TEST_TIME_SCALE. Refused in production.
   */
  LOAD_TEST: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  LOAD_TEST_JWKS_FILE: optionalString,
  LOAD_TEST_TIME_SCALE: z.coerce.number().positive().max(1).default(1),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`);
  }
  const config = parsed.data;

  const hasSupabase = Boolean(config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY);
  if (Boolean(config.SUPABASE_URL) !== Boolean(config.SUPABASE_SERVICE_ROLE_KEY)) {
    throw new Error('Set both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or neither.');
  }
  if (config.NODE_ENV === 'production' && !hasSupabase) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in production.');
  }

  // Its own key in production: borrowing the Supabase key would reset every network's count when it's rotated.
  if (config.NODE_ENV === 'production' && !config.IP_HASH_KEY) throw new Error('IP_HASH_KEY is required in production.');
  if (config.LOAD_TEST && config.NODE_ENV === 'production') throw new Error('LOAD_TEST is never allowed in production.');
  if (config.LOAD_TEST && (!config.LOAD_TEST_JWKS_FILE || !config.SUPABASE_URL)) {
    throw new Error('LOAD_TEST needs LOAD_TEST_JWKS_FILE and SUPABASE_URL (see api/scripts/load).');
  }

  return {
    ...config,
    ipHashKey: config.IP_HASH_KEY ?? config.SUPABASE_SERVICE_ROLE_KEY ?? 'booktrap-dev-ip-key',
    // Render: its in-container proxy, load balancer and Cloudflare (measured, Phase 10). Only while
    // api.booktrap.app stays a DNS-only CNAME: proxying it through our own Cloudflare zone adds a hop.
    TRUST_PROXY_HOPS: config.TRUST_PROXY_HOPS ?? (config.NODE_ENV === 'production' ? 3 : 0),
    storage: hasSupabase ? ('supabase' as const) : ('memory' as const),
  };
}
