import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  delete window.turnstile;
  document.head.querySelectorAll('script').forEach((script) => script.remove());
});

async function load(siteKey?: string) {
  if (siteKey) vi.stubEnv('VITE_TURNSTILE_SITE_KEY', siteKey);
  return (await import('./captcha')).captchaToken;
}

describe('captchaToken', () => {
  it('sends no token when CAPTCHA isn’t configured', async () => {
    const captchaToken = await load();
    await expect(captchaToken()).resolves.toBeUndefined();
    expect(document.head.querySelector('script')).toBeNull();
  });

  it('gets a fresh token from a widget and removes the widget afterwards', async () => {
    const remove = vi.fn();
    const render = vi.fn((_el: HTMLElement, options: Record<string, unknown>) => {
      queueMicrotask(() => (options.callback as (token: string) => void)(`token-${render.mock.calls.length}`));
      return `widget-${render.mock.calls.length}`;
    });
    window.turnstile = { render, remove };
    const captchaToken = await load('site-key');
    await expect(captchaToken()).resolves.toBe('token-1');
    await expect(captchaToken()).resolves.toBe('token-2');
    expect(render.mock.calls[0]![1]).toMatchObject({ sitekey: 'site-key', appearance: 'interaction-only' });
    expect(remove).toHaveBeenCalledWith('widget-1');
    expect(remove).toHaveBeenCalledWith('widget-2');
    expect(document.body.children).toHaveLength(0);
  });

  it('waits out a failed try while Turnstile retries', async () => {
    const remove = vi.fn();
    const render = vi.fn((_el: HTMLElement, options: Record<string, unknown>) => {
      queueMicrotask(() => {
        expect((options['error-callback'] as () => unknown)()).toBe(true);
        (options.callback as (token: string) => void)('token-after-retry');
      });
      return 'widget';
    });
    window.turnstile = { render, remove };
    const captchaToken = await load('site-key');
    await expect(captchaToken()).resolves.toBe('token-after-retry');
    expect(render.mock.calls[0]![1]).toMatchObject({ retry: 'auto' });
    expect(remove).toHaveBeenCalledWith('widget');
  });

  it('stops its own clock while a checkbox waits on the person', async () => {
    vi.useFakeTimers();
    try {
      let options: Record<string, unknown> = {};
      window.turnstile = {
        render: (_el, given) => {
          options = given;
          (given['before-interactive-callback'] as () => void)();
          return 'widget';
        },
        remove: vi.fn(),
      };
      const captchaToken = await load('site-key');
      const token = captchaToken();
      await vi.advanceTimersByTimeAsync(60_000);
      (options.callback as (token: string) => void)('token-after-click');
      await expect(token).resolves.toBe('token-after-click');
    } finally {
      vi.useRealTimers();
    }
  });

  it('explains a check that keeps failing in words', async () => {
    const render = (_el: HTMLElement, options: Record<string, unknown>) => {
      const onError = options['error-callback'] as () => void;
      queueMicrotask(() => [1, 2, 3].forEach(onError));
      return 'widget';
    };
    window.turnstile = { render, remove: vi.fn() };
    const captchaToken = await load('site-key');
    const error = await captchaToken().catch((caught: unknown) => caught);
    // A fresh module copy each test, so the class is matched by name.
    expect(error).toMatchObject({ name: 'AccountError', code: 'captcha' });
  });

  it('turns Turnstile throwing at the start into the same plain message, and cleans up', async () => {
    window.turnstile = {
      render: () => {
        throw new Error('Invalid sitekey');
      },
      remove: vi.fn(),
    };
    const captchaToken = await load('bad-key');
    const error = await captchaToken().catch((caught: unknown) => caught);
    expect(error).toMatchObject({ name: 'AccountError', code: 'captcha', message: expect.stringMatching(/Reload the page/) });
    expect(document.body.children).toHaveLength(0);
  });
});
