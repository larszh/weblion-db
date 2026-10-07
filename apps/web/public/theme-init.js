// Applies the stored theme before first paint to avoid a flash. Kept as a file so the
// Content-Security-Policy does not need to allow inline scripts.
try {
  var t = localStorage.getItem('wl-theme');
  var dark = t === 'dark' || (t !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) document.documentElement.classList.add('dark');
} catch (e) {}
