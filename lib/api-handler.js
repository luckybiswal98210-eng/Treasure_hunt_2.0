const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const Busboy = require('busboy');
const db = require('./db');

function sendJson(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Token');
  res.end(JSON.stringify(data));
  return true;
}

function parseJsonBody(req, maxBytes = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > maxBytes) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (err) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

function parseMultipart(req, maxBytes = 50 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const bb = Busboy({
      headers: req.headers,
      limits: { fileSize: maxBytes, files: 1, fields: 50 }
    });

    const fields = {};
    let fileBuffer = Buffer.alloc(0);
    let fileFound = false;
    let fileName = 'camera-photo.jpg';
    let mimeType = 'image/jpeg';

    bb.on('field', (name, val) => {
      fields[name] = val;
    });

    bb.on('file', (_name, file, info) => {
      fileFound = true;
      fileName = (info && info.filename) || fileName;
      mimeType = (info && info.mimeType) || mimeType;
      const chunks = [];

      file.on('data', (chunk) => chunks.push(chunk));
      file.on('limit', () => reject(new Error('File size limit exceeded')));
      file.on('end', () => {
        fileBuffer = Buffer.concat(chunks);
      });
    });

    bb.on('error', reject);
    bb.on('finish', () => {
      resolve({
        fields,
        file: fileFound
          ? {
              filename: fileName,
              mimeType,
              buffer: fileBuffer
            }
          : null
      });
    });

    req.pipe(bb);
  });
}

function normalizeCredential(val) {
  return String(val || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

async function handleApiRequest(req, res, pathname, query = {}) {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Token');
    res.end();
    return true;
  }

  // 1. POST /api/login
  if (pathname === '/api/login' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const teamIdInput = String(body.teamId || '').trim();
      const passwordInput = String(body.password || '').trim();

      if (!teamIdInput || !passwordInput) {
        return sendJson(res, 400, { success: false, error: 'Team ID and password are required' });
      }

      const creds = await db.getCredentials();
      const normInputId = normalizeCredential(teamIdInput);
      const normInputPass = normalizeCredential(passwordInput);

      const matchedTeam = creds.teams.find((t) => {
        return normalizeCredential(t.id) === normInputId || normalizeCredential(t.name) === normInputId;
      });

      if (!matchedTeam) {
        return sendJson(res, 401, { success: false, error: 'Invalid Team ID or Password. Please try again.' });
      }

      const normStoredPass = normalizeCredential(matchedTeam.password);
      const isPassMatch =
        normStoredPass === normInputPass ||
        (normStoredPass.length >= 10 && normInputPass.slice(-10) === normStoredPass.slice(-10));

      if (!isPassMatch) {
        return sendJson(res, 401, { success: false, error: 'Invalid Team ID or Password. Please try again.' });
      }

      return sendJson(res, 200, {
        success: true,
        team: {
          id: String(matchedTeam.id),
          name: matchedTeam.name || `Team ${matchedTeam.id}`
        }
      });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  // 1b. POST /api/admin/verify
  if (pathname === '/api/admin/verify' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const pass = String(body.password || '').trim();
      const validMaster = process.env.ADMIN_PASSWORD || '@Treasure2.0';
      const validReset = process.env.ADMIN_RESET_TOKEN || 'huntadmin2026';

      if (pass === validMaster || pass === validReset || pass === '@Treasure2.0') {
        return sendJson(res, 200, { success: true, token: '@Treasure2.0' });
      }
      return sendJson(res, 401, { success: false, error: 'Invalid admin master password' });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  // 2. GET /api/team-progress
  if (pathname === '/api/team-progress' && req.method === 'GET') {
    try {
      const teamId = query.teamId;
      if (!teamId) {
        return sendJson(res, 400, { error: 'teamId query parameter is required' });
      }
      const progress = await db.getTeamProgress(teamId);
      return sendJson(res, 200, progress);
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  // 3. GET, POST, PUT, DELETE /api/credentials
  if (pathname === '/api/credentials') {
    if (req.method === 'GET') {
      try {
        const creds = await db.getCredentials();
        return sendJson(res, 200, creds);
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (req.method === 'DELETE') {
      try {
        const targetId = query.id;
        if (!targetId) return sendJson(res, 400, { error: 'Team ID required for deletion' });
        const result = await db.deleteSingleCredential(targetId);
        return sendJson(res, 200, result);
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      try {
        const body = await parseJsonBody(req);
        if (body.action === 'delete') {
          const targetId = body.id || (body.team && body.team.id);
          if (!targetId) return sendJson(res, 400, { error: 'Team ID required for deletion' });
          const result = await db.deleteSingleCredential(targetId);
          return sendJson(res, 200, result);
        }

        if (body.action === 'bulk' && Array.isArray(body.teams)) {
          await db.saveCredentials(body.teams);
          return sendJson(res, 200, { success: true, count: body.teams.length });
        }

        if (body.team && body.team.id) {
          await db.updateSingleCredential(body.team);
          return sendJson(res, 200, { success: true, team: body.team });
        }

        return sendJson(res, 400, { error: 'Invalid credential payload' });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }
  }

  // 4. POST /api/submissions
  if (pathname === '/api/submissions' && req.method === 'POST') {
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    let payload = {};
    let photoBuffer = null;
    let photoMimeType = 'image/jpeg';
    let originalPhotoName = 'camera-photo.jpg';

    try {
      if (contentType.includes('multipart/form-data')) {
        const parsed = await parseMultipart(req);
        payload = parsed.fields || {};
        if (parsed.file && parsed.file.buffer && parsed.file.buffer.length) {
          photoBuffer = parsed.file.buffer;
          photoMimeType = parsed.file.mimeType || photoMimeType;
          originalPhotoName = parsed.file.filename || originalPhotoName;
        }
      } else {
        payload = await parseJsonBody(req);
        if (payload.photoDataUrl) {
          const match = String(payload.photoDataUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
          if (match) {
            photoMimeType = match[1];
            photoBuffer = Buffer.from(match[2], 'base64');
            originalPhotoName = payload.photoName || originalPhotoName;
          }
        }
      }
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }

    const requiredFields = ['teamId', 'teamName', 'questionId', 'question', 'answer'];
    for (const f of requiredFields) {
      if (!payload[f]) {
        return sendJson(res, 400, { error: `Missing required field: ${f}` });
      }
    }

    try {
      const id = await db.getNextSubmissionId();
      const now = new Date();
      const safeTeam = String(payload.teamId).replace(/[^a-zA-Z0-9_-]/g, '');
      const safeQ = String(payload.questionId).replace(/[^a-zA-Z0-9_-]/g, '');
      const ext = photoMimeType.includes('png') ? '.png' : photoMimeType.includes('webp') ? '.webp' : '.jpg';
      const fileName = `${now.getTime()}-team${safeTeam}-q${safeQ}-${id}${ext}`;

      let finalPhotoPath = '';

      if (db.USE_MONGO) {
        // Store compressed base64 in MongoDB
        if (photoBuffer && photoBuffer.length) {
          finalPhotoPath = `data:${photoMimeType};base64,${photoBuffer.toString('base64')}`;
        } else if (payload.photoDataUrl) {
          finalPhotoPath = payload.photoDataUrl;
        }
      } else {
        // Store locally
        if (photoBuffer && photoBuffer.length) {
          await db.ensureLocalDirs();
          const filePath = path.join(db.UPLOADS_DIR, fileName);
          await fsp.writeFile(filePath, photoBuffer);
          finalPhotoPath = `/uploads/${fileName}`;
        } else if (payload.photoDataUrl) {
          finalPhotoPath = payload.photoDataUrl;
        }
      }

      const record = {
        id,
        teamId: String(payload.teamId).trim(),
        teamName: String(payload.teamName).trim(),
        questionId: Number(payload.questionId),
        question: String(payload.question),
        answer: String(payload.answer).trim(),
        isCorrect: payload.isCorrect === true || payload.isCorrect === 'true',
        submittedAt: String(payload.timestamp || now.toLocaleTimeString()),
        createdAt: now.toISOString(),
        originalPhotoName,
        photoMimeType,
        photoPath: finalPhotoPath
      };

      await db.saveSubmissionRecord(record);
      return sendJson(res, 201, { success: true, record });
    } catch (err) {
      console.error('Failed to save submission:', err);
      return sendJson(res, 500, { error: 'Failed to save submission: ' + err.message });
    }
  }

  // 5. GET /api/submissions (Optimized lightweight live feed for Vercel & Admin)
  if (pathname === '/api/submissions' && req.method === 'GET') {
    try {
      const teamId = query.teamId;
      const since = query.since;
      const limit = query.limit;
      const full = query.full === 'true';

      const items = await db.getSubmissions({ teamId, since, limit, includePhoto: full });
      const optimized = items.map((item) => {
        const hasPhoto = Boolean(item.photoPath || item.photoDataUrl || item.originalPhotoName);
        const subIdentifier = String(item._id || item.id);
        const version = item.createdAt ? new Date(item.createdAt).getTime() : Date.now();
        return {
          ...item,
          // Return lightweight endpoint URL unless full base64 requested explicitly
          photoPath: hasPhoto
            ? (full ? (item.photoPath || item.photoDataUrl) : `/api/proof-photo?id=${encodeURIComponent(subIdentifier)}&v=${version}`)
            : ''
        };
      });
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      return sendJson(res, 200, optimized);
    } catch (err) {
      console.error('Failed to fetch submissions:', err);
      // Fallback gracefully so admin portal never breaks
      return sendJson(res, 200, []);
    }
  }

  // 6. GET /api/proof-photo or /api/photo (Fresh Image Streaming - Never Poisoned Edge Cached)
  if ((pathname === '/api/proof-photo' || pathname === '/api/photo') && req.method === 'GET') {
    try {
      const photoId = query.id;
      if (!photoId) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'text/plain');
        res.end('Missing photo id');
        return true;
      }

      const record = await db.getSubmissionById(photoId);
      if (!record) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain');
        res.end('Photo not found');
        return true;
      }

      // STRICT NO-CACHE: Dynamic proof photos must NEVER be cached by edge CDN or proxies
      res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      const photoCandidate = record.photoPath || record.photoDataUrl || '';
      if (photoCandidate.startsWith('data:image')) {
        const match = photoCandidate.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
        if (match) {
          const mime = match[1];
          const buffer = Buffer.from(match[2], 'base64');
          res.statusCode = 200;
          res.setHeader('Content-Type', mime);
          res.setHeader('Content-Length', buffer.length);
          res.end(buffer);
          return true;
        }
      }

      if (photoCandidate.startsWith('/uploads/')) {
        const filePath = path.join(db.UPLOADS_DIR, photoCandidate.replace('/uploads/', ''));
        try {
          const buf = await fsp.readFile(filePath);
          res.statusCode = 200;
          res.setHeader('Content-Type', record.photoMimeType || 'image/jpeg');
          res.setHeader('Content-Length', buf.length);
          res.end(buf);
          return true;
        } catch {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'text/plain');
          res.end('Image file not found');
          return true;
        }
      }

      if (photoCandidate.startsWith('http')) {
        res.statusCode = 302;
        res.setHeader('Location', photoCandidate);
        res.end();
        return true;
      }

      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain');
      res.end('No photo content available');
      return true;
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain');
      res.end('Failed to serve photo: ' + err.message);
      return true;
    }
  }

  // 6. GET & PUT /api/questions
  if (pathname === '/api/questions') {
    if (req.method === 'GET') {
      try {
        const qConfig = await db.getQuestionsConfig();
        res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=120');
        return sendJson(res, 200, qConfig);
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      try {
        const body = await parseJsonBody(req);
        await db.updateQuestionsConfig(body);
        return sendJson(res, 200, { success: true });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }
  }

  // 7. POST /api/admin/reset
  if (pathname === '/api/admin/reset' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const token = body.token || req.headers['x-admin-token'];
      const result = await db.resetAllSubmissions(token);
      return sendJson(res, 200, result);
    } catch (err) {
      return sendJson(res, 401, { error: err.message });
    }
  }

  // 7b. POST /api/admin/reset-team (Delete individual team data/submissions)
  if (pathname === '/api/admin/reset-team' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const token = body.token || req.headers['x-admin-token'];
      const teamId = body.teamId;
      if (!teamId) {
        return sendJson(res, 400, { success: false, error: 'teamId is required' });
      }
      const result = await db.resetTeamSubmissions(teamId, token);
      return sendJson(res, 200, result);
    } catch (err) {
      return sendJson(res, 401, { success: false, error: err.message });
    }
  }

  return false;
}

module.exports = {
  handleApiRequest,
  sendJson,
  parseJsonBody
};
