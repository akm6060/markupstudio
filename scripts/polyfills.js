/* polyfills.js — plain ES5, added in front of pdf.js and its worker for phones whose WebView was never updated */
(function (g) {
  if (typeof g.globalThis === 'undefined') g.globalThis = g;
  function def(o, k, v) { if (o && !o[k]) Object.defineProperty(o, k, { value: v, writable: true, configurable: true }); }
  function at(n) { n = Math.trunc(n) || 0; if (n < 0) n += this.length; return n < 0 || n >= this.length ? undefined : this[n]; }
  def(Array.prototype, 'at', at); def(String.prototype, 'at', at);
  if (typeof Int8Array !== 'undefined') def(Object.getPrototypeOf(Int8Array.prototype), 'at', at);
  def(Array.prototype, 'flat', function (d) { d = d === undefined ? 1 : d; return d < 1 ? this.slice() : this.reduce(function (a, x) { return a.concat(Array.isArray(x) ? x.flat(d - 1) : x); }, []); });
  def(Array.prototype, 'flatMap', function (f, t) { return [].concat.apply([], this.map(f, t)); });
  def(Array.prototype, 'findLast', function (f, t) { for (var i = this.length - 1; i >= 0; i--) if (f.call(t, this[i], i, this)) return this[i]; return undefined; });
  def(Array.prototype, 'findLastIndex', function (f, t) { for (var i = this.length - 1; i >= 0; i--) if (f.call(t, this[i], i, this)) return i; return -1; });
  def(Object, 'fromEntries', function (it) { var o = {}; Array.from(it).forEach(function (e) { o[e[0]] = e[1]; }); return o; });
  def(Object, 'hasOwn', function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); });
  def(String.prototype, 'trimStart', function () { return this.replace(/^\s+/, ''); });
  def(String.prototype, 'trimEnd', function () { return this.replace(/\s+$/, ''); });
  def(String.prototype, 'replaceAll', function (s, r) { if (s instanceof RegExp) return this.replace(s, r); return typeof r === 'function' ? this.split(s).reduce(function (a, p, i) { return i ? a + r(s) + p : p; }, '') : this.split(s).join(r); });
  if (typeof Promise !== 'undefined') def(Promise, 'allSettled', function (ps) { return Promise.all(Array.from(ps).map(function (p) { return Promise.resolve(p).then(function (v) { return { status: 'fulfilled', value: v }; }, function (e) { return { status: 'rejected', reason: e }; }); })); });
  if (typeof g.structuredClone === 'undefined') g.structuredClone = function (v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); };
})(typeof self !== 'undefined' ? self : this);
