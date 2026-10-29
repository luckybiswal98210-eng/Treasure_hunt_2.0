const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { MongoClient } = require('mongodb');

// Environment variables
const MONGODB_URI = process.env.MONGODB_URI || '';
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'campus_hunt';
const SUBMISSIONS_COLLECTION = process.env.MONGODB_SUBMISSIONS_COLLECTION || 'submissions';
const CREDENTIALS_COLLECTION = process.env.MONGODB_CREDENTIALS_COLLECTION || 'credentials';
const QUESTIONS_COLLECTION = process.env.MONGODB_QUESTIONS_COLLECTION || 'questions';
const ADMIN_RESET_TOKEN = process.env.ADMIN_RESET_TOKEN || 'huntadmin2026';

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const UPLOADS_DIR = path.join(ROOT_DIR, 'uploads');
const SUBMISSIONS_FILE = path.join(DATA_DIR, 'submissions.json');
const CREDENTIALS_FILE = path.join(ROOT_DIR, 'credentials.json');
const QUESTIONS_FILE = path.join(ROOT_DIR, 'questions.json');

const USE_MONGO = Boolean(MONGODB_URI && MONGODB_URI.startsWith('mongodb'));

// Global cache for serverless environments (Vercel)
let cachedClient = null;
let cachedDb = null;

async function getMongoDb() {
  if (!USE_MONGO) return null;
  if (cachedDb) return cachedDb;

  if (!cachedClient) {
    cachedClient = new MongoClient(MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000
    });
    await cachedClient.connect();
  }

  cachedDb = cachedClient.db(MONGODB_DB_NAME);

  // Initialize indexes
  try {
    const subs = cachedDb.collection(SUBMISSIONS_COLLECTION);
    await subs.createIndex({ teamId: 1 });
    await subs.createIndex({ createdAt: -1 });
    await subs.createIndex({ id: 1 });
  } catch (err) {
    console.warn('Index creation warning:', err.message);
  }

  return cachedDb;
}

// Ensure local directories exist when running locally
async function ensureLocalDirs() {
  if (USE_MONGO) return;
  try {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    await fsp.mkdir(UPLOADS_DIR, { recursive: true });
    try {
      await fsp.access(SUBMISSIONS_FILE);
    } catch {
      await fsp.writeFile(SUBMISSIONS_FILE, '[]', 'utf-8');
    }
  } catch (err) {
    console.error('Error initializing local directories:', err.message);
  }
}

// ----------------------------------------------------
// CREDENTIALS MANAGEMENT
// ----------------------------------------------------
function buildDefaultCredentials() {
  const teams = [];
  for (let i = 1; i <= 45; i += 1) {
    teams.push({
      id: String(i),
      password: `team@${i}`,
      name: `Team ${i}`
    });
  }
  return { teams };
}

async function getCredentials() {
  const db = await getMongoDb();
  if (db) {
    const credDoc = await db.collection(CREDENTIALS_COLLECTION).findOne({ type: 'team_credentials' });
    if (credDoc && Array.isArray(credDoc.teams) && credDoc.teams.length > 0) {
      return { teams: credDoc.teams };
    }
    // Fallback: seed MongoDB from credentials.json
    try {
      const raw = await fsp.readFile(CREDENTIALS_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.teams)) {
        await db.collection(CREDENTIALS_COLLECTION).updateOne(
          { type: 'team_credentials' },
          { $set: { type: 'team_credentials', teams: parsed.teams, updatedAt: new Date().toISOString() } },
          { upsert: true }
        );
        return parsed;
      }
    } catch {
      // Use defaults
    }
    const def = buildDefaultCredentials();
    await db.collection(CREDENTIALS_COLLECTION).updateOne(
      { type: 'team_credentials' },
      { $set: { type: 'team_credentials', teams: def.teams, updatedAt: new Date().toISOString() } },
      { upsert: true }
    );
    return def;
  }

  // Local file storage
  try {
    const raw = await fsp.readFile(CREDENTIALS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.teams)) {
      return parsed;
    }
  } catch {
    // Ignore and fallback
  }
  return buildDefaultCredentials();
}

async function saveCredentials(teamsList) {
  if (!Array.isArray(teamsList)) {
    throw new Error('teamsList must be an array');
  }

  const db = await getMongoDb();
  if (db) {
    await db.collection(CREDENTIALS_COLLECTION).updateOne(
      { type: 'team_credentials' },
      { $set: { type: 'team_credentials', teams: teamsList, updatedAt: new Date().toISOString() } },
      { upsert: true }
    );
  }

  // Always attempt to write to local file as well if accessible
  try {
    await fsp.writeFile(CREDENTIALS_FILE, JSON.stringify({ teams: teamsList }, null, 2), 'utf-8');
  } catch {
    // If running in a read-only serverless environment, local write may fail safely
  }

  return { success: true, count: teamsList.length };
}

async function updateSingleCredential(teamUpdate) {
  const data = await getCredentials();
  const teams = data.teams || [];
  const targetId = String(teamUpdate.id || '').trim();

  let found = false;
  const updated = teams.map((t) => {
    if (String(t.id).trim() === targetId) {
      found = true;
      return {
        ...t,
        name: teamUpdate.name !== undefined ? String(teamUpdate.name).trim() : t.name,
        password: teamUpdate.password !== undefined ? String(teamUpdate.password).trim() : t.password
      };
    }
    return t;
  });

  if (!found) {
    updated.push({
      id: targetId,
      name: teamUpdate.name ? String(teamUpdate.name).trim() : `Team ${targetId}`,
      password: teamUpdate.password ? String(teamUpdate.password).trim() : `team@${targetId}`
    });
  }

  await saveCredentials(updated);
  return { success: true, team: teamUpdate };
}

// ----------------------------------------------------
// QUESTIONS CONFIGURATION
// ----------------------------------------------------
async function getQuestionsConfig() {
  const db = await getMongoDb();
  if (db) {
    const qDoc = await db.collection(QUESTIONS_COLLECTION).findOne({ type: 'active_questions' });
    if (qDoc && Array.isArray(qDoc.questions)) {
      return qDoc;
    }
  }

  try {
    const raw = await fsp.readFile(QUESTIONS_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    return { questions: [], gameCheckpoints: [] };
  }
}

async function updateQuestionsConfig(newConfig) {
  const db = await getMongoDb();
  if (db) {
    await db.collection(QUESTIONS_COLLECTION).updateOne(
      { type: 'active_questions' },
      { $set: { type: 'active_questions', ...newConfig, updatedAt: new Date().toISOString() } },
      { upsert: true }
    );
  }

  try {
    await fsp.writeFile(QUESTIONS_FILE, JSON.stringify(newConfig, null, 2), 'utf-8');
  } catch {
    // Read-only serverless environment safe
  }
  return { success: true };
}

// ----------------------------------------------------
// SUBMISSIONS & LIVE TRACKING
// ----------------------------------------------------
async function readLocalSubmissions() {
  try {
    await ensureLocalDirs();
    const raw = await fsp.readFile(SUBMISSIONS_FILE, 'utf-8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeLocalSubmissions(items) {
  try {
    await ensureLocalDirs();
    await fsp.writeFile(SUBMISSIONS_FILE, JSON.stringify(items, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing local submissions:', err.message);
  }
}

async function getNextSubmissionId() {
  const db = await getMongoDb();
  if (db) {
    const latest = await db.collection(SUBMISSIONS_COLLECTION).findOne({}, { sort: { id: -1 }, projection: { id: 1 } });
    return (latest?.id || 0) + 1;
  }
  const items = await readLocalSubmissions();
  return items.length + 1;
}

async function saveSubmissionRecord(record) {
  const db = await getMongoDb();
  if (db) {
    await db.collection(SUBMISSIONS_COLLECTION).insertOne(record);
    return record;
  }

  const items = await readLocalSubmissions();
  items.push(record);
  await writeLocalSubmissions(items);
  return record;
}

async function getSubmissions({ teamId, since, limit = 2000 }) {
  const db = await getMongoDb();
  if (db) {
    const query = {};
    if (teamId) {
      query.teamId = String(teamId);
    }
    if (since) {
      query.createdAt = { $gt: String(since) };
    }
    const items = await db
      .collection(SUBMISSIONS_COLLECTION)
      .find(query)
      .sort({ createdAt: -1 })
      .limit(Number(limit) || 2000)
      .toArray();

    // Map photo path
    return items.map((item) => ({
      ...item,
      photoPath: item.photoPath || item.photoDataUrl || ''
    }));
  }

  let items = await readLocalSubmissions();
  if (teamId) {
    items = items.filter((x) => String(x.teamId) === String(teamId));
  }
  if (since) {
    const sinceDate = new Date(since).getTime();
    items = items.filter((x) => new Date(x.createdAt).getTime() > sinceDate);
  }
  // Return sorted newest first
  return items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// ----------------------------------------------------
// PROGRESS PERSISTENCE (RESUME CAPABILITY)
// ----------------------------------------------------
async function getTeamProgress(teamId) {
  const normId = String(teamId || '').trim();
  const db = await getMongoDb();
  let submissions = [];

  if (db) {
    submissions = await db
      .collection(SUBMISSIONS_COLLECTION)
      .find({ teamId: normId, isCorrect: true })
      .sort({ questionId: 1 })
      .toArray();
  } else {
    const all = await readLocalSubmissions();
    submissions = all.filter((x) => String(x.teamId) === normId && x.isCorrect);
  }

  // Find unique completed questions
  const completedQuestionIds = [...new Set(submissions.map((s) => Number(s.questionId)))].filter(Number.isFinite);
  const completedCount = completedQuestionIds.length;
  const maxQuestionId = completedQuestionIds.length > 0 ? Math.max(...completedQuestionIds) : 0;

  return {
    teamId: normId,
    completedCount,
    lastCompletedQuestionId: maxQuestionId,
    completedQuestionIds,
    latestSubmission: submissions[submissions.length - 1] || null
  };
}

// ----------------------------------------------------
// RESET
// ----------------------------------------------------
async function resetAllSubmissions(token) {
  if (ADMIN_RESET_TOKEN && token !== ADMIN_RESET_TOKEN) {
    throw new Error('Unauthorized: Invalid admin reset token');
  }

  const db = await getMongoDb();
  if (db) {
    await db.collection(SUBMISSIONS_COLLECTION).deleteMany({});
  } else {
    await writeLocalSubmissions([]);
    try {
      const files = await fsp.readdir(UPLOADS_DIR);
      for (const f of files) {
        await fsp.unlink(path.join(UPLOADS_DIR, f));
      }
    } catch {
      // Ignore directory read failure
    }
  }

  return { success: true, message: 'All submissions cleared successfully.' };
}

module.exports = {
  USE_MONGO,
  ensureLocalDirs,
  getCredentials,
  saveCredentials,
  updateSingleCredential,
  getQuestionsConfig,
  updateQuestionsConfig,
  getNextSubmissionId,
  saveSubmissionRecord,
  getSubmissions,
  getTeamProgress,
  resetAllSubmissions,
  UPLOADS_DIR
};

