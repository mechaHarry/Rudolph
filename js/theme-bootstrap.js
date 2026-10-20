(function() {
  var families = ['oneui', 'glass', 'webex', 'fluent', 'material', 'carbon'];
  var rawTheme = localStorage.getItem('rudolph-theme');
  var rawAppearance = localStorage.getItem('rudolph-appearance');
  var family = families.indexOf(rawTheme) !== -1 ? rawTheme : 'oneui';
  var pref = rawAppearance || (rawTheme === 'light' || rawTheme === 'dark' ? rawTheme : 'auto');

  if (pref === 'system') pref = 'auto';
  if (pref !== 'auto' && pref !== 'light' && pref !== 'dark') pref = 'auto';

  var mode = pref;
  if (pref === 'auto') {
    try {
      mode = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark';
    } catch (e) {
      mode = 'dark';
    }
  }

  document.body.className = 'theme-' + family + ' mode-' + mode;
})();
