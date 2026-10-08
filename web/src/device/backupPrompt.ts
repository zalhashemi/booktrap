/** Whether the reader has saved their backup code on this browser (a convenience flag only). */
const SAVED_KEY = 'booktrap.backup.saved';

export function backupSaved(): boolean {
  try {
    return localStorage.getItem(SAVED_KEY) === '1';
  } catch {
    return false;
  }
}

export function markBackupSaved(): void {
  try {
    localStorage.setItem(SAVED_KEY, '1');
  } catch {
    // Private mode: the reminder may show again, which is harmless.
  }
}
