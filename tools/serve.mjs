/**
 * serve.mjs - Server statico minimale (zero dipendenze).
 * I moduli ES richiedono http://, non funzionano aprendo il file con file://
 *
 *   node tools/serve.mjs [porta]
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
const PORT = Number(process.argv[2]) || 5173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

const server = createServer(async (req, res) => {
  try {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    let path = normalize(join(ROOT, url === '/' ? 'index.html' : url));

    // impedisce di uscire dalla cartella del progetto
    if (!path.startsWith(ROOT + sep) && path !== ROOT) {
      res.writeHead(403).end('403 Forbidden');
      return;
    }

    const info = await stat(path).catch(() => null);
    if (info && info.isDirectory()) path = join(path, 'index.html');

    const body = await readFile(path);
    res.writeHead(200, {
      'Content-Type': MIME[extname(path).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(body);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 - risorsa non trovata: ' + req.url);
  }
});

server.listen(PORT, () => {
  console.log('ZENITH BLOCK in ascolto su http://localhost:' + PORT);
  console.log('Premi Ctrl+C per fermare il server.');
});
