/**
 * bot-tollbooth — browser probe (zero-dependency, IIFE)
 * -----------------------------------------------------
 * Embed this on any page to collect the client-side signals the server cannot
 * see from access logs alone — especially headless-automation flags.
 *
 * <script src="https://your-api/probe.js"></script>
 * <script>
 *   const signals = BotTollboothProbe.collect();
 *   // send to the analytics service:
 *   fetch('/api/v1/probe', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ namespace: 'mysite.com', userAgent: navigator.userAgent, signals })
 *   });
 * </script>
 *
 * Signals collected:
 *   webdriver          — navigator.webdriver (true in ChromeDriver / headless automation)
 *   softwareRenderer   — WebGL reports SwiftShader / llvmpipe / software fallback
 *   gpuRenderer        — raw WebGL renderer string (helps confirm software rendering)
 *   pluginsCount       — navigator.plugins.length (0 = headless shell)
 *   hasAccelerometer   — Generic Sensor API present (real devices differ)
 *   hasGyroscope       — Generic Sensor API present
 *   hasBattery         — Battery Status API present (deprecated on headless)
 */
;(function () {
  if (typeof window === 'undefined') return;

  var e = {};

  // Automation / headless
  e.webdriver = !!navigator.webdriver;
  e.pluginsCount = typeof navigator.plugins === 'object' ? navigator.plugins.length : 0;

  // WebGL renderer — SwiftShader / llvmpipe are the software fallbacks used by
  // headless Chrome, VMs, and CI environments.
  try {
    var c = document.createElement('canvas');
    var gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    if (gl) {
      var ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) {
        var renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
        e.softwareRenderer = /swiftshader|llvmpipe|software|mesa|osmesa|google swiftshader/i.test(renderer);
        e.gpuRenderer = renderer;
      }
    }
  } catch (_) { /* WebGL not available */ }

  // Sensor APIs — present on real devices, absent or stubbed on headless shells
  e.hasAccelerometer = typeof Accelerometer !== 'undefined';
  e.hasGyroscope     = typeof Gyroscope !== 'undefined';
  e.hasBattery       = typeof navigator.getBattery === 'function';

  window.BotTollboothProbe = {
    signals: e,
    collect: function () { return Object.assign({}, e); },
  };
})();