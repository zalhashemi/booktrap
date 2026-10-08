import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
  /** Milliseconds before it disappears. Toasts with an action stay longer. */
  duration: number;
}

type Show = (message: string, options?: { action?: Toast['action']; duration?: number }) => void;

const ToastContext = createContext<Show | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((toast) => toast.id !== id)), []);
  const show = useCallback<Show>((message, options = {}) => {
    const id = nextId.current++;
    // One toast at a time: a newer message replaces the older one.
    setToasts([{ id, message, action: options.action, duration: options.duration ?? (options.action ? 8000 : 3500) }]);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom)+0.75rem)] z-40 flex justify-center px-4 md:bottom-6"
      >
        {toasts.map((toast) => (
          <ToastView key={toast.id} toast={toast} onDone={dismiss} />
        ))}
      </div>
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
      className="toast-in pointer-events-auto flex max-w-[30rem] items-center gap-4 rounded-board bg-surface-strong py-2 pr-2 pl-4 text-[0.95rem] text-text shadow-[0_12px_32px_-12px_rgb(0_0_0/0.6),inset_0_0_0_1px_var(--rule-gold)]"
    >
      <span className="py-2">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action!.run();
            onDone(toast.id);
          }}
          className="min-h-11 shrink-0 rounded-board px-3 font-semibold text-gold-ink underline-offset-4 hover:underline"
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}

export function useToast(): Show {
  const show = useContext(ToastContext);
  if (!show) throw new Error('useToast must be used inside <ToastProvider>');
  return show;
}
