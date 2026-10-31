/* polyfills.js — small fixes for phones whose WebView was never updated, and the colour theme before the first paint */
if (!Array.prototype.flatMap) Object.defineProperty(Array.prototype, 'flatMap', { configurable: true, writable: true, value: function (f, t) { return [].concat.apply([], this.map(f, t)); } });
if (!Array.prototype.flat) Object.defineProperty(Array.prototype, 'flat', { configurable: true, writable: true, value: function () { return [].concat.apply([], this); } });
if (window.Blob && !Blob.prototype.arrayBuffer) Blob.prototype.arrayBuffer = function () { var b = this; return new Promise(function (ok, no) { var r = new FileReader(); r.onload = function () { ok(r.result); }; r.onerror = function () { no(r.error); }; r.readAsArrayBuffer(b); }); };
if (window.Blob && !Blob.prototype.text) Blob.prototype.text = function () { var b = this; return new Promise(function (ok, no) { var r = new FileReader(); r.onload = function () { ok(r.result); }; r.onerror = function () { no(r.error); }; r.readAsText(b); }); };
try {
  var t = window.Android ? window.Android.getPref('theme', 'light') : 'light';
  if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
} catch (e) {}
