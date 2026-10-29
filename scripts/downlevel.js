/* Rewrites JavaScript files in place so they also run on old Android WebViews (Chrome 51+):
   ?. ?? ??= class fields, private #fields, async/await, object spread ... become older syntax.
   usage: node scripts/downlevel.js file1.js file2.js ...   (needs: npm install typescript) */
const ts = require('typescript'), fs = require('fs'), path = require('path');
const prelude = fs.readFileSync(path.join(__dirname, 'polyfills.js'), 'utf8');
for (const f of process.argv.slice(2)) {
  const src = fs.readFileSync(f, 'utf8');
  const r = ts.transpileModule(src, {
    fileName: f,
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2016, allowJs: true, useDefineForClassFields: false, removeComments: false, noEmitHelpers: false }
  });
  const errs = (r.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
  if (errs.length) { console.error(f, errs.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('; ')); process.exit(1); }
  let out = r.outputText;
  if (/pdf(\.worker)?\.min\.js$/.test(f)) {           // pdf.js and its worker get the polyfills (the worker has its own globals)
    const m = /^\s*(["'])use strict\1;?\s*\n/.exec(out);
    out = m ? m[0] + prelude + '\n' + out.slice(m[0].length) : prelude + '\n' + out;
  }
  fs.writeFileSync(f, out);
  console.log('downlevelled', f, src.length, '->', r.outputText.length);
}
