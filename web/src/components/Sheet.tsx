import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Id of the heading that names the sheet. */
  labelledBy: string;
  children: ReactNode;
}

/**
 * The app's side sheet (a native modal dialog): rises from the bottom on phones, slides in from the
 * right on wider screens. Escape and a tap on the dimmed backdrop both close it.
 */
export function Sheet({ open, onClose, labelledBy, children }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      // The browser can close a modal dialog itself (a second Esc skips "cancel"). Ask the owner; if it
      // keeps the sheet open (e.g. unsaved edits), put the dialog back once React has settled.
      onClose={() => {
        onClose();
        requestAnimationFrame(() => {
          const element = dialog.current;
          if (openRef.current && element && !element.open) element.showModal();
        });
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // Clicking the dimmed backdrop (the dialog element itself) closes the sheet.
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      aria-labelledby={labelledBy}
      className="sheet m-0 mt-auto h-[calc(100dvh-1.5rem)] max-h-none w-full max-w-none overflow-hidden rounded-t-[26px] bg-ground-raised p-0 text-text shadow-[var(--elev-lift)] backdrop:bg-[rgb(31_28_36/0.6)] md:mt-0 md:mr-0 md:ml-auto md:h-dvh md:w-[480px] md:rounded-l-[26px] md:rounded-r-none"
    >
      {children}
    </dialog>
  );
}
