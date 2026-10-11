import { createContext, useContext } from 'react';

export type AuthSheetMode = 'save' | 'login';

export interface AuthSheetContextValue {
  /** Opens the Save your shelf / Log in sheet. */
  openAuth: (mode: AuthSheetMode) => void;
}

export const AuthSheetContext = createContext<AuthSheetContextValue | null>(null);

export function useAuthSheet(): AuthSheetContextValue {
  const value = useContext(AuthSheetContext);
  if (!value) throw new Error('useAuthSheet must be used inside <AuthSheetProvider>');
  return value;
}
