import { ButtonLink } from '../components/Button';

export function NotFoundPage() {
  return (
    <div className="max-w-[34rem] pt-4">
      <h1 className="font-display text-[2.15rem] leading-[1.08]">This page isn&rsquo;t on any shelf</h1>
      <p className="mt-3 text-text-muted">The link may be old or mistyped.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <ButtonLink to="/shelf">Go to your shelf</ButtonLink>
        <ButtonLink to="/" variant="quiet">
          Add books
        </ButtonLink>
      </div>
    </div>
  );
}
