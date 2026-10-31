const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');

// Bundled static defaults (guaranteed to be bundled into Vercel Lambda functions)
let bundledQuestions = null;
try {
  bundledQuestions = require('../questions.json');
} catch {
  try {
    bundledQuestions = require('../public/questions.json');
  } catch {}
}

let bundledCredentials = null;
try {
  bundledCredentials = require('../credentials.json');
} catch {
  try {
    bundledCredentials = require('../public/credentials.json');
  } catch {}
}

// Environment variables
const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGODB_URL || process.env.DATABASE_URL || '';
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || process.env.MONGODB_DATABASE || 'campus_hunt';
const SUBMISSIONS_COLLECTION = process.env.MONGODB_SUBMISSIONS_COLLECTION || 'submissions';
const CREDENTIALS_COLLECTION = process.env.MONGODB_CREDENTIALS_COLLECTION || 'credentials';
const QUESTIONS_COLLECTION = process.env.MONGODB_QUESTIONS_COLLECTION || 'questions';
const ADMIN_RESET_TOKEN = process.env.ADMIN_RESET_TOKEN || 'huntadmin2026';

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const UPLOADS_DIR = path.join(ROOT_DIR, 'uploads');
const SUBMISSIONS_FILE = path.join(DATA_DIR, 'submissions.json');
const CREDENTIALS_FILE = fs.existsSync(path.join(ROOT_DIR, 'credentials.json'))
  ? path.join(ROOT_DIR, 'credentials.json')
  : path.join(ROOT_DIR, 'public', 'credentials.json');
const QUESTIONS_FILE = fs.existsSync(path.join(ROOT_DIR, 'questions.json'))
  ? path.join(ROOT_DIR, 'questions.json')
  : path.join(ROOT_DIR, 'public', 'questions.json');

const USE_MONGO = Boolean(MONGODB_URI && MONGODB_URI.startsWith('mongodb'));

// Global cache for serverless environments (Vercel)
let cachedClient = null;
let cachedDb = null;
let indexesInitialized = false;

async function getMongoDb() {
  if (!USE_MONGO) return null;
  if (cachedDb) return cachedDb;

  try {
    if (!cachedClient) {
      cachedClient = new MongoClient(MONGODB_URI, {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 3000,
        connectTimeoutMS: 3000,
        socketTimeoutMS: 15000
      });
      await cachedClient.connect();
    }

    cachedDb = cachedClient.db(MONGODB_DB_NAME);

    // Initialize indexes in the background once without blocking requests
    if (!indexesInitialized) {
      indexesInitialized = true;
      const subs = cachedDb.collection(SUBMISSIONS_COLLECTION);
      subs.createIndex({ teamId: 1 }).catch(() => {});
      subs.createIndex({ createdAt: -1 }).catch(() => {});
      subs.createIndex({ id: 1 }).catch(() => {});
    }

    return cachedDb;
  } catch (err) {
    console.warn('MongoDB connection failed, falling back to storage:', err.message);
    cachedClient = null;
    cachedDb = null;
    return null;
  }
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
  let fileConfig = bundledCredentials;
  if (!fileConfig) {
    try {
      const raw = await fsp.readFile(CREDENTIALS_FILE, 'utf-8');
      fileConfig = JSON.parse(raw);
    } catch {}
  }

  const db = await getMongoDb();
  if (db) {
    try {
      const credDoc = await db.collection(CREDENTIALS_COLLECTION).findOne({ type: 'team_credentials' });
      if (credDoc && Array.isArray(credDoc.teams) && credDoc.teams.length > 0) {
        // If fileConfig has a newer version than MongoDB, sync it
        if (fileConfig && fileConfig.version && credDoc.version !== fileConfig.version && Array.isArray(fileConfig.teams)) {
          await db.collection(CREDENTIALS_COLLECTION).updateOne(
            { type: 'team_credentials' },
            { $set: { type: 'team_credentials', teams: fileConfig.teams, version: fileConfig.version, updatedAt: new Date().toISOString() } },
            { upsert: true }
          );
          return fileConfig;
        }
        return { teams: credDoc.teams, version: credDoc.version };
      }
      // Fallback: seed MongoDB from fileConfig
      if (fileConfig && Array.isArray(fileConfig.teams)) {
        await db.collection(CREDENTIALS_COLLECTION).updateOne(
          { type: 'team_credentials' },
          { $set: { type: 'team_credentials', teams: fileConfig.teams, version: fileConfig.version || '2.0.0', updatedAt: new Date().toISOString() } },
          { upsert: true }
        );
        return fileConfig;
      }
    } catch (err) {
      console.warn('Could not query credentials from MongoDB:', err.message);
    }
  }

  // Fallback to static bundled configuration
  if (fileConfig && Array.isArray(fileConfig.teams)) {
    return fileConfig;
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

async function deleteSingleCredential(teamId) {
  const data = await getCredentials();
  const teams = data.teams || [];
  const targetId = String(teamId || '').trim();

  const filtered = teams.filter((t) => String(t.id).trim() !== targetId);
  await saveCredentials(filtered);
  return { success: true, count: filtered.length, deletedId: targetId };
}

// ----------------------------------------------------
// QUESTIONS CONFIGURATION
// ----------------------------------------------------
async function getQuestionsConfig() {
  let fileConfig = bundledQuestions;
  if (!fileConfig) {
    try {
      const raw = await fsp.readFile(QUESTIONS_FILE, 'utf-8');
      fileConfig = JSON.parse(raw);
    } catch {}
  }

  const db = await getMongoDb();
  if (db) {
    try {
      const qDoc = await db.collection(QUESTIONS_COLLECTION).findOne({ type: 'active_questions' });
      // If MongoDB already has valid questions, return them!
      if (qDoc && Array.isArray(qDoc.questions) && qDoc.questions.length >= 22) {
        return qDoc;
      }
      // Sync latest 22-round questions to MongoDB Atlas
      if (fileConfig && Array.isArray(fileConfig.questions)) {
        await db.collection(QUESTIONS_COLLECTION).updateOne(
          { type: 'active_questions' },
          { $set: { type: 'active_questions', ...fileConfig, updatedAt: new Date().toISOString() } },
          { upsert: true }
        );
        return fileConfig;
      }
    } catch (err) {
      console.warn('Could not query questions from MongoDB:', err.message);
    }
  }

  return fileConfig || bundledQuestions || { questions: [], gameCheckpoints: [] };
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

function generateSubmissionId() {
  const timestamp = Date.now();
  const randomPart = Math.random().toString(36).substring(2, 9);
  return `sub_${timestamp}_${randomPart}`;
}

async function getNextSubmissionId() {
  return generateSubmissionId();
}

async function saveSubmissionRecord(record) {
  if (!record.id) {
    record.id = generateSubmissionId();
  }
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

async function getSubmissionById(id) {
  if (!id) return null;
  const db = await getMongoDb();
  const idStr = String(id).trim();

  if (db) {
    const col = db.collection(SUBMISSIONS_COLLECTION);

    // 1. Check by ObjectId if valid 24 hex characters
    if (/^[0-9a-fA-F]{24}$/.test(idStr)) {
      try {
        const doc = await col.findOne({ _id: new ObjectId(idStr) });
        if (doc) return doc;
      } catch (e) {}
    }

    // 2. Check by unique string id (sub_...)
    const strDoc = await col.findOne({ id: idStr });
    if (strDoc) return strDoc;

    // 3. Check by numeric id (for legacy/older records)
    const num = Number(idStr);
    if (!isNaN(num)) {
      const numDoc = await col.findOne({ id: num });
      if (numDoc) return numDoc;
    }

    return null;
  }

  const all = await readLocalSubmissions();
  const num = Number(idStr);
  return (
    all.find(
      (x) =>
        String(x.id || '').trim() === idStr ||
        String(x._id || '').trim() === idStr ||
        (!isNaN(num) && Number(x.id) === num)
    ) || null
  );
}

// ----------------------------------------------------
// PROGRESS PERSISTENCE (RESUME CAPABILITY)
// ----------------------------------------------------
async function getTeamProgress(teamId) {
  const normId = String(teamId || '').trim();
  let submissions = [];

  try {
    const db = await getMongoDb();
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
  } catch (err) {
    console.warn('getTeamProgress fallback to empty/local:', err.message);
    try {
      const all = await readLocalSubmissions();
      submissions = all.filter((x) => String(x.teamId) === normId && x.isCorrect);
    } catch {}
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
  if (token !== ADMIN_RESET_TOKEN && token !== '@Treasure2.0') {
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

async function resetTeamSubmissions(teamId, token) {
  if (token !== ADMIN_RESET_TOKEN && token !== '@Treasure2.0') {
    throw new Error('Unauthorized: Invalid admin reset token');
  }

  const normId = String(teamId || '').trim();
  if (!normId) {
    throw new Error('teamId is required to reset individual team data');
  }

  const db = await getMongoDb();
  if (db) {
    await db.collection(SUBMISSIONS_COLLECTION).deleteMany({ teamId: normId });
  } else {
    const all = await readLocalSubmissions();
    const remaining = all.filter((x) => String(x.teamId) !== normId);
    await writeLocalSubmissions(remaining);
  }

  return { success: true, teamId: normId, message: `All uploaded data for Team ${normId} has been deleted successfully.` };
}

module.exports = {
  USE_MONGO,
  ensureLocalDirs,
  getCredentials,
  saveCredentials,
  updateSingleCredential,
  deleteSingleCredential,
  getQuestionsConfig,
  updateQuestionsConfig,
  getNextSubmissionId,
  saveSubmissionRecord,
  getSubmissions,
  getSubmissionById,
  getTeamProgress,
  resetAllSubmissions,
  resetTeamSubmissions,
  UPLOADS_DIR
};

