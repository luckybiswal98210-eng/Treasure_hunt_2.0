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
let cachedPromise = null;
let indexesInitialized = false;
let cachedQuestionsConfig = null;

async function getMongoDb() {
  if (!USE_MONGO) return null;
  if (cachedDb) return cachedDb;

  if (!cachedPromise) {
    const client = new MongoClient(MONGODB_URI, {
      maxPoolSize: 10,
      minPoolSize: 1,
      serverSelectionTimeoutMS: 15000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 30000,
      readPreference: 'nearest',
      retryReads: true,
      retryWrites: true
    });

    cachedPromise = client
      .connect()
      .then((c) => {
        cachedClient = c;
        cachedDb = c.db(MONGODB_DB_NAME);

        // Initialize indexes in the background once without blocking requests
        if (!indexesInitialized) {
          indexesInitialized = true;
          const subs = cachedDb.collection(SUBMISSIONS_COLLECTION);
          subs.createIndex({ teamId: 1 }).catch(() => {});
          subs.createIndex({ createdAt: -1 }).catch(() => {});
          subs.createIndex({ id: 1 }).catch(() => {});
        }

        return cachedDb;
      })
      .catch((err) => {
        console.warn('MongoDB connection failed, falling back to storage:', err.message);
        cachedPromise = null;
        cachedClient = null;
        cachedDb = null;
        return null;
      });
  }

  return cachedPromise;
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
  if (cachedQuestionsConfig && Array.isArray(cachedQuestionsConfig.questions) && cachedQuestionsConfig.questions.length >= 22) {
    return cachedQuestionsConfig;
  }

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
        cachedQuestionsConfig = qDoc;
        return qDoc;
      }
      // Sync latest 22-round questions to MongoDB Atlas
      if (fileConfig && Array.isArray(fileConfig.questions)) {
        await db.collection(QUESTIONS_COLLECTION).updateOne(
          { type: 'active_questions' },
          { $set: { type: 'active_questions', ...fileConfig, updatedAt: new Date().toISOString() } },
          { upsert: true }
        );
        cachedQuestionsConfig = fileConfig;
        return fileConfig;
      }
    } catch (err) {
      console.warn('Could not query questions from MongoDB:', err.message);
    }
  }

  cachedQuestionsConfig = fileConfig || bundledQuestions || { questions: [], gameCheckpoints: [] };
  return cachedQuestionsConfig;
}

async function updateQuestionsConfig(newConfig) {
  cachedQuestionsConfig = newConfig;
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

const RESET_STATE_FILE = path.join(DATA_DIR, 'reset-state.json');

// In-memory reset state
let lastGlobalResetAt = 0;
const teamResetAtMap = new Map();

async function loadResetState() {
  try {
    const raw = await fsp.readFile(RESET_STATE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed.lastGlobalResetAt) lastGlobalResetAt = Number(parsed.lastGlobalResetAt);
    if (parsed.teams && typeof parsed.teams === 'object') {
      for (const [k, v] of Object.entries(parsed.teams)) {
        teamResetAtMap.set(String(k), Number(v));
      }
    }
  } catch {}
}
loadResetState();

async function saveResetState() {
  try {
    await ensureLocalDirs();
    const data = {
      lastGlobalResetAt,
      teams: Object.fromEntries(teamResetAtMap.entries())
    };
    await fsp.writeFile(RESET_STATE_FILE, JSON.stringify(data), 'utf-8');
  } catch {}
}

async function saveSubmissionRecord(record) {
  if (!record.id) {
    record.id = generateSubmissionId();
  }

  // Always write locally so data is preserved even if MongoDB is offline or lagging
  try {
    const items = await readLocalSubmissions();
    items.unshift(record);
    await writeLocalSubmissions(items);
  } catch (e) {
    console.warn('Local submission write error:', e.message);
  }

  try {
    const db = await getMongoDb();
    if (db) {
      await db.collection(SUBMISSIONS_COLLECTION).insertOne(record);
    }
  } catch (err) {
    console.warn('MongoDB insert submission warning (saved locally):', err.message);
  }

  return record;
}

async function getSubmissions({ teamId, since, limit = 2000, includePhoto = false } = {}) {
  let mongoItems = [];
  try {
    const db = await getMongoDb();
    if (db) {
      const query = {};
      if (teamId) {
        const normTid = String(teamId).trim();
        query.$or = [
          { teamId: normTid },
          { teamId: Number(normTid) || -1 },
          { teamName: normTid }
        ];
      }
      if (since) {
        query.createdAt = { $gt: String(since) };
      }
      const projection = includePhoto ? {} : { photoPath: 0, photoDataUrl: 0 };
      mongoItems = await db
        .collection(SUBMISSIONS_COLLECTION)
        .find(query, { projection })
        .sort({ createdAt: -1 })
        .limit(Number(limit) || 2000)
        .toArray();
    }
  } catch (err) {
    console.warn('MongoDB getSubmissions query warning:', err.message);
  }

  let localItems = await readLocalSubmissions();
  if (teamId) {
    localItems = localItems.filter((x) => String(x.teamId) === String(teamId));
  }
  if (since) {
    const sinceDate = new Date(since).getTime();
    localItems = localItems.filter((x) => new Date(x.createdAt).getTime() > sinceDate);
  }

  // Merge items uniquely by id / _id
  const mergedMap = new Map();
  [...localItems, ...mongoItems].forEach((item) => {
    const key = String(item.id || item._id || `${item.teamId}-${item.questionId}`);
    const hasPhoto = Boolean(item.photoPath || item.photoDataUrl || item.originalPhotoName);
    mergedMap.set(key, {
      ...item,
      photoPath: includePhoto ? (item.photoPath || item.photoDataUrl || '') : (hasPhoto ? 'has_photo' : '')
    });
  });

  const all = Array.from(mergedMap.values());
  return all
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, Number(limit) || 2000);
}

async function getSubmissionById(id) {
  if (!id) return null;
  const idStr = String(id).trim();
  const num = Number(idStr);

  try {
    const db = await getMongoDb();
    if (db) {
      const col = db.collection(SUBMISSIONS_COLLECTION);
      if (/^[0-9a-fA-F]{24}$/.test(idStr)) {
        try {
          const doc = await col.findOne({ _id: new ObjectId(idStr) });
          if (doc) return doc;
        } catch (e) {}
      }
      const strDoc = await col.findOne({ id: idStr });
      if (strDoc) return strDoc;
      if (!isNaN(num)) {
        const numDoc = await col.findOne({ id: num });
        if (numDoc) return numDoc;
      }
    }
  } catch (err) {
    console.warn('MongoDB getSubmissionById warning:', err.message);
  }

  const all = await readLocalSubmissions();
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
  let dbResetAt = 0;

  try {
    const db = await getMongoDb();
    if (db) {
      submissions = await db
        .collection(SUBMISSIONS_COLLECTION)
        .find(
          {
            $or: [
              { teamId: normId },
              { teamId: Number(normId) || -1 },
              { teamName: normId }
            ],
            isCorrect: { $ne: false }
          },
          { projection: { photoPath: 0, photoDataUrl: 0 } }
        )
        .sort({ questionId: 1 })
        .toArray();

      // Check global reset timestamp from Mongo
      const stateDoc = await db.collection(QUESTIONS_COLLECTION).findOne({ type: 'admin_event_state' });
      if (stateDoc && stateDoc.lastGlobalResetAt) {
        dbResetAt = Math.max(dbResetAt, Number(stateDoc.lastGlobalResetAt));
      }
      // Check team-specific reset timestamp from Mongo
      const teamStateDoc = await db.collection(QUESTIONS_COLLECTION).findOne({ type: `team_reset_${normId}` });
      if (teamStateDoc && teamStateDoc.resetAt) {
        dbResetAt = Math.max(dbResetAt, Number(teamStateDoc.resetAt));
      }
    }
  } catch (err) {
    console.warn('getTeamProgress Mongo query failed:', err.message);
  }

  // Combine with local submissions
  let localSubs = [];
  try {
    const all = await readLocalSubmissions();
    localSubs = all.filter((x) => String(x.teamId) === normId && x.isCorrect);
  } catch {}

  // Merge unique by questionId
  const allMap = new Map();
  [...localSubs, ...submissions].forEach((s) => {
    if (s && s.questionId) {
      allMap.set(Number(s.questionId), s);
    }
  });

  const merged = Array.from(allMap.values());
  const completedQuestionIds = [...allMap.keys()].filter(Number.isFinite).sort((a, b) => a - b);
  const completedCount = completedQuestionIds.length;
  const maxQuestionId = completedQuestionIds.length > 0 ? Math.max(...completedQuestionIds) : 0;

  const memResetAt = Math.max(lastGlobalResetAt, teamResetAtMap.get(normId) || 0);
  const effectiveResetAt = Math.max(memResetAt, dbResetAt);

  return {
    teamId: normId,
    completedCount,
    lastCompletedQuestionId: maxQuestionId,
    completedQuestionIds,
    resetAt: 0,
    latestSubmission: merged[merged.length - 1] || null
  };
}

// ----------------------------------------------------
// RESET
// ----------------------------------------------------
async function resetAllSubmissions(token) {
  if (token !== ADMIN_RESET_TOKEN && token !== '@Treasure2.0') {
    throw new Error('Unauthorized: Invalid admin reset token');
  }

  lastGlobalResetAt = Date.now();
  teamResetAtMap.clear();
  await saveResetState();

  const db = await getMongoDb();
  if (db) {
    try {
      await db.collection(SUBMISSIONS_COLLECTION).deleteMany({});
      await db.collection(QUESTIONS_COLLECTION).updateOne(
        { type: 'admin_event_state' },
        { $set: { type: 'admin_event_state', lastGlobalResetAt, updatedAt: new Date().toISOString() } },
        { upsert: true }
      );
    } catch (err) {
      console.warn('MongoDB reset warning:', err.message);
    }
  }

  await writeLocalSubmissions([]);
  try {
    const files = await fsp.readdir(UPLOADS_DIR);
    for (const f of files) {
      await fsp.unlink(path.join(UPLOADS_DIR, f));
    }
  } catch {}

  return { success: true, resetAt: lastGlobalResetAt, message: 'All submissions cleared successfully.' };
}

async function resetTeamSubmissions(teamId, token) {
  if (token !== ADMIN_RESET_TOKEN && token !== '@Treasure2.0') {
    throw new Error('Unauthorized: Invalid admin reset token');
  }

  const normId = String(teamId || '').trim();
  if (!normId) {
    throw new Error('teamId is required to reset individual team data');
  }

  const teamResetAt = Date.now();
  teamResetAtMap.set(normId, teamResetAt);
  await saveResetState();

  const db = await getMongoDb();
  if (db) {
    try {
      await db.collection(SUBMISSIONS_COLLECTION).deleteMany({ teamId: normId });
      await db.collection(QUESTIONS_COLLECTION).updateOne(
        { type: `team_reset_${normId}` },
        { $set: { type: `team_reset_${normId}`, teamId: normId, resetAt: teamResetAt } },
        { upsert: true }
      );
    } catch (err) {
      console.warn('MongoDB team reset warning:', err.message);
    }
  }

  const all = await readLocalSubmissions();
  const remaining = all.filter((x) => String(x.teamId) !== normId);
  await writeLocalSubmissions(remaining);

  return { success: true, teamId: normId, resetAt: teamResetAt, message: `All uploaded data for Team ${normId} has been deleted successfully.` };
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

