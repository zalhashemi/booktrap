import { createContext, useContext } from 'react';

export interface ToastAction {
  label: string;
  run: () => void;
}

export type ShowToast = (message: string, options?: { action?: ToastAction; duration?: number }) => void;

/** Kept apart from the provider component so hot reloads never re-create the context mid-session. */
export const ToastContext = createContext<ShowToast | null>(null);

export function useToast(): ShowToast {
  const show = useContext(ToastContext);
  if (!show) throw new Error('useToast must be used inside <ToastProvider>');
  return show;
}
