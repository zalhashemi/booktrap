import { useRouteError } from 'react-router';
import { Button } from '../components/Button';
import { useReportIssue } from '../report/report-issue-context';

/** A page that crashed: a way back, and a Report button with the error already filled in. */
export function CrashPage() {
  const failure = useRouteError();
  const report = useReportIssue();
  const message = failure instanceof Error ? `${failure.name}: ${failure.message}` : String(failure);
  return (
    <main id="main" className="mx-auto max-w-[34rem] px-4 pt-16">
      <h1 className="font-display text-[2.15rem] leading-[1.08]">Something on this page broke</h1>
      <p className="mt-3 text-text-muted">Your shelf is safe. Reload to try again, and if it keeps happening, tell us so we can fix it.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Button type="button" onClick={() => window.location.reload()}>
          Reload
        </Button>
        <Button type="button" variant="quiet" onClick={() => report({ error: `The page crashed. ${message}` })}>
          Report an issue
        </Button>
      </div>
    </main>
  );
}
