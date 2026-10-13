import { createContext, useCallback, useContext } from 'react';
import { useToast } from '../components/toast-context';
import type { IssueContext } from './issue-report';

/** Opens the "Report an issue" sheet, with what the app knew about the problem. */
export type OpenIssueReport = (context?: IssueContext) => void;

/** Kept apart from the provider component so hot reloads never re-create the context mid-session. */
export const ReportIssueContext = createContext<OpenIssueReport | null>(null);

export function useReportIssue(): OpenIssueReport {
  const open = useContext(ReportIssueContext);
  if (!open) throw new Error('useReportIssue must be used inside <ReportIssueProvider>');
  return open;
}

/** A toast for something that went wrong, with a Report button that opens the sheet already filled in. */
export function useErrorToast(): (message: string, context?: Omit<IssueContext, 'error'>) => void {
  const toast = useToast();
  const report = useReportIssue();
  return useCallback(
    (message, context = {}) => toast(message, { action: { label: 'Report', run: () => report({ ...context, error: message }) } }),
    [toast, report],
  );
}
