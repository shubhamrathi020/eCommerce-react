// Applies the saved light/dark choice before the first paint so a dark-mode visitor never sees a white flash (BRD 18, LX-04).
// "system" (or nothing saved) leaves the attribute off and the stylesheet follows the device. Kept as a file, not inline,
// because the Content-Security-Policy allows scripts from this site only.
(function () {
  try {
    var t = localStorage.getItem('ecom.theme.v1');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {
    /* storage blocked: follow the device */
  }
})();
