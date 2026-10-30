require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const { handleApiRequest, sendJson } = require('./lib/api-handler');
const db = require('./lib/db');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const UPLOADS_DIR = path.join(ROOT, 'uploads');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function serveFile(res, filePath) {
  fs.stat(filePath, (statErr, stats) => {
    if (statErr || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': mimeType,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const requestListener = async (req, res) => {
  const host = req.headers.host || `localhost:${PORT}`;
  const urlObj = new URL(req.url || '/', `http://${host}`);
  const pathname = urlObj.pathname;
  const query = Object.fromEntries(urlObj.searchParams.entries());

  // 1. API routes
  if (pathname.startsWith('/api/')) {
    const handled = await handleApiRequest(req, res, pathname, query);
    if (!handled) {
      sendJson(res, 404, { error: 'API endpoint not found' });
    }
    return;
  }

  // 2. Uploaded files
  if (pathname.startsWith('/uploads/')) {
    const requested = decodeURIComponent(pathname).replace(/^\/uploads\//, '');
    const safePath = path.normalize(requested);
    if (safePath.startsWith('..') || path.isAbsolute(safePath)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }
    const fullPath = path.join(UPLOADS_DIR, safePath);
    return serveFile(res, fullPath);
  }

  // 3. Static files
  let requestPath = pathname === '/' ? '/welcome.html' : pathname;
  const decodedPath = decodeURIComponent(requestPath);

  const candidates = [
    path.join(ROOT, 'public', decodedPath),
    path.join(ROOT, decodedPath),
    path.join(process.cwd(), 'public', decodedPath),
    path.join(process.cwd(), decodedPath)
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        if (fs.statSync(candidate).isFile()) {
          return serveFile(res, candidate);
        }
      } catch {
        // Continue search
      }
    }
  }

  // Fallback 404
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
};

const server = http.createServer(requestListener);

// Auto-start when executed directly or on service hosts (Render, Vercel Services, Local)
if (require.main === module || !process.env.VERCEL) {
  server.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`🎯 TREASURE HUNT 2.0 SERVER ACTIVE`);
    console.log(`📡 URL: http://localhost:${PORT}`);
    console.log(`👤 Team Login: http://localhost:${PORT}/login.html`);
    console.log(`⚡ Admin Panel: http://localhost:${PORT}/admin.html`);
    console.log(`💾 Database: ${db.USE_MONGO ? 'MongoDB Atlas (Connected)' : 'Local File Storage'}`);
    console.log(`======================================================\n`);
  });
}

// Export for serverless environments
module.exports = server;

