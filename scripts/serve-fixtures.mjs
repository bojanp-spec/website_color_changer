// Statički server za fixtures/: port 4173 = „sajt", port 4174 = „drugi domen" (cross-origin CSS).
// Na 4174 samo putanje pod /cors/ šalju Access-Control-Allow-Origin.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../fixtures/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript', '.svg': 'image/svg+xml' };

function serve(port, base, cors) {
  createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (path.endsWith('/')) path += 'index.html';
    try {
      const body = await readFile(join(base, path));
      const headers = { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' };
      if (cors(path)) headers['access-control-allow-origin'] = '*';
      res.writeHead(200, headers).end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  }).listen(port, '127.0.0.1', () => console.log(`fixtures: http://127.0.0.1:${port}/`));
}

serve(Number(process.env.PORT ?? 4173), ROOT, () => false);
serve(Number(process.env.REMOTE_PORT ?? 4174), join(ROOT, '_remote'), (p) => p.startsWith('/cors/'));
