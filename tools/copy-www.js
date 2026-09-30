/* Assemble the deployable web bundle into www/ for Capacitor and static hosts.
   Copies the app plus the vendored pdf.js, and rewrites index.html to use
   local assets instead of CDNs so the app is fully offline. */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const www = path.join(root, 'www');

fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(www, { recursive: true });

/* Files & folders copied as-is. */
for (const item of ['styles', 'js', 'vendor', 'icons']) {
  fs.cpSync(path.join(root, item), path.join(www, item), { recursive: true });
}

/* index.html: point to local pdf.js + absolute-ish asset paths (Capacitor serves
   from the app root, so relative paths are correct already). */
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(
  /<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/pdf\.js\/[^"]*\/pdf\.min\.js"><\/script>/,
  '<script src="vendor/pdfjs/pdf.min.js"></script>'
).replace(
  /<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/pdf\.js\/[^"]*\/pdf\.worker\.min\.js"><\/script>/,
  ''
);
fs.writeFileSync(path.join(www, 'index.html'), html);

/* manifest + service worker live at the bundle root */
for (const f of ['manifest.webmanifest', 'sw.js']) {
  fs.copyFileSync(path.join(root, f), path.join(www, f));
}

console.log('www/ assembled:', fs.readdirSync(www).join(', '));
