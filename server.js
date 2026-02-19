const http = require('http');
const fs = require('fs');
const path = require('path');

const basePort = Number(process.env.PORT) || 5173;
const host = process.env.HOST || '127.0.0.1';
const maxPortTries = Number(process.env.PORT_TRIES) || 20;
const root = __dirname;

const mimeTypes = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'text/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

function send404(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=UTF-8' });
  res.end('Not Found');
}

const server = http.createServer((req, res) => {
  const requestPath = decodeURIComponent(req.url.split('?')[0]);
  const safePath = path.normalize(requestPath).replace(/^\.\.(?:\/|\\|$)/, '');
  const filePath = safePath === '/' ? path.join(root, 'index.html') : path.join(root, safePath);

  if (!filePath.startsWith(root)) {
    send404(res);
    return;
  }

  fs.stat(filePath, (statErr, stats) => {
    if (statErr || !stats.isFile()) {
      send404(res);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime = mimeTypes[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    fs.createReadStream(filePath).pipe(res);
  });
});

let currentTry = 0;

function listenOn(port) {
  server.listen(port, host);
}

server.on('listening', () => {
  const address = server.address();
  const activePort = typeof address === 'object' && address ? address.port : basePort;
  console.log(`Masktool running at http://${host}:${activePort}`);
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE' && currentTry < maxPortTries) {
    currentTry += 1;
    const fallbackPort = basePort + currentTry;
    console.warn(
      `Port ${basePort + currentTry - 1} is already in use. Retrying with ${fallbackPort}...`,
    );
    listenOn(fallbackPort);
    return;
  }

  console.error(err);
  process.exit(1);
});

listenOn(basePort);
