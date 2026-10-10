import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ToastContext, type ShowToast, type ToastAction } from './toast-context';

interface Toast {
  id: number;
  message: string;
  action?: ToastAction;
  /** Milliseconds before it disappears. Toasts with an action stay longer. */
  duration: number;
  /**
   * The sheet open when it was shown, if any. A modal sheet makes the rest of the page inert (hidden
   * from screen readers, untappable), so the toast renders inside it, at the very bottom.
   */
  sheet: HTMLDialogElement | null;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((toast) => toast.id !== id)), []);
  const show = useCallback<ShowToast>((message, options = {}) => {
    const id = nextId.current++;
    // One toast at a time: a newer message replaces the older one.
    const sheet = document.querySelector<HTMLDialogElement>('dialog[open]');
    setToasts([{ id, message, action: options.action, duration: options.duration ?? (options.action ? 8000 : 3500), sheet }]);
  }, []);

  const sheet = toasts[0]?.sheet ?? null;
  const region = (
    <div
      aria-live="polite"
      className={`pointer-events-none fixed inset-x-0 z-40 flex px-4 ${
        sheet
          ? // In a sheet: start-aligned in its text column, so it never lands on a row's buttons.
            'bottom-[calc(1rem+env(safe-area-inset-bottom))] justify-start pr-[9rem] pl-5 md:inset-x-auto md:right-0 md:w-[480px]'
          : 'bottom-[calc(10rem+env(safe-area-inset-bottom))] justify-center md:bottom-24'
      }`}
    >
      {toasts.map((toast) => (
        <ToastView key={toast.id} toast={toast} onDone={dismiss} />
      ))}
    </div>
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      {sheet ? createPortal(region, sheet) : region}
    </ToastContext.Provider>
  );
}

/** onDone is the provider's stable dismiss, so re-renders never restart the timer. */
function ToastView({ toast, onDone }: { toast: Toast; onDone: (id: number) => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDone(toast.id), toast.duration);
    return () => window.clearTimeout(timer);
  }, [toast.id, toast.duration, onDone]);

  return (
    <div
      role="status"
      className={`toast-in flex ${toast.action ? 'pointer-events-auto' : ''} max-w-[30rem] items-center gap-4 rounded-pill bg-surface-strong py-1.5 pr-1.5 pl-5 text-[0.95rem] text-text shadow-[var(--elev-lift),inset_0_0_0_1px_var(--rule-accent)]`}
    >
      <span className="py-2">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action!.run();
            onDone(toast.id);
          }}
          className="min-h-11 shrink-0 rounded-pill bg-accent px-4 font-bold text-on-tab"
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}

