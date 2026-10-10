// Runs before the app draws, so a dark-mode reader never sees a light flash. A file rather than an
// inline script, so the Content-Security-Policy can allow scripts from this site only.
try {
  if (localStorage.getItem('booktrap.theme') === 'dark') {
    document.documentElement.dataset.theme = 'dark';
    document.querySelector('meta[name="theme-color"]').setAttribute('content', '#2B2733');
  }
} catch {
  // Storage blocked: stay on the light default.
}
