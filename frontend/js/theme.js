// Light / dark toggle. The initial theme is set by the inline script in index.html's
// <head> (saved choice, else the OS preference) so the page never flashes the wrong theme.
const Theme = (() => {
  const KEY = 'eco-theme';

  function current() {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  }

  function apply(theme, save) {
    document.documentElement.dataset.theme = theme;
    const btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
      btn.setAttribute('aria-pressed', String(theme === 'dark'));
    }
    if (save) {
      try { localStorage.setItem(KEY, theme); } catch (e) { /* storage blocked: keep in memory only */ }
    }
    GraphView.applyTheme();
  }

  function init() {
    apply(current(), false);
    document.getElementById('theme-toggle').addEventListener('click', () => {
      apply(current() === 'dark' ? 'light' : 'dark', true);
    });
    // Follow the OS setting live, but only until the user makes their own choice.
    const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    if (mq && mq.addEventListener) {
      mq.addEventListener('change', (e) => {
        let saved = null;
        try { saved = localStorage.getItem(KEY); } catch (err) { /* ignore */ }
        if (!saved) apply(e.matches ? 'dark' : 'light', false);
      });
    }
  }

  return { init };
})();
