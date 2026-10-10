/** Saves text or a blob as a file the browser downloads. */
export function downloadFile(name: string, content: string | Blob, type = 'text/plain;charset=utf-8') {
  const blob = typeof content === 'string' ? new Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked a moment later: some browsers (Safari) start the download asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** booktrap-goodreads-2026-10-09.csv, dated in the reader's own time zone. */
export function exportFileName(kind: string, extension: string, now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `booktrap-${kind}-${date}.${extension}`;
}
