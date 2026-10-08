/**
 * Claude prices per million tokens (first-party API; claude-api skill pricing table cached 2026-10-06).
 * Cache writes bill at 1.25x input, cache reads at 0.1x input.
 */
export const CLAUDE_PRICES: Record<string, { input: number; output: number }> = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-fable-5-1': { input: 10, output: 50 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
};

/** Unknown models (e.g. a refusal fallback we did not plan for) are priced at the most expensive tier. */
const FALLBACK_PRICE = { input: 10, output: 50 };

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export function claudeCostUsd(model: string, usage: TokenUsage): number {
  const price = CLAUDE_PRICES[model] ?? FALLBACK_PRICE;
  const input =
    usage.input_tokens * price.input +
    (usage.cache_creation_input_tokens ?? 0) * price.input * 1.25 +
    (usage.cache_read_input_tokens ?? 0) * price.input * 0.1;
  return (input + usage.output_tokens * price.output) / 1_000_000;
}
