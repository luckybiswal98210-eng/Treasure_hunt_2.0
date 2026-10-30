// ==========================================================================
// Campus Treasure Hunt 2.0 - Client Game Engine
// ==========================================================================

const PROGRESS_VERSION = '2026-v2';
const SHUFFLE_SALT = 872341;

let teamId = '';
let teamName = '';
let orderedQuestions = [];
let currentQuestionIndex = 0;
let compressedPhotoDataUrl = null;
let compressedPhotoBlob = null;
let compressedPhotoName = '';
let isSubmitting = false;

// ----------------------------------------------------
// 1. SOUND EFFECTS (Web Audio API Synthesizer)
// ----------------------------------------------------
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function playSuccessChime() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    
    // Note 1: G4 (392Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(392, now);
    gain1.gain.setValueAtTime(0.15, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.25);

    // Note 2: C5 (523.25Hz)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(523.25, now + 0.12);
    gain2.gain.setValueAtTime(0.18, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.45);
  } catch (e) {
    // Audio context may fail silently on some browsers
  }
}

function playErrorTone() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.linearRampToValueAtTime(120, now + 0.25);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.25);
  } catch (e) {}
}

function triggerHaptic(type = 'success') {
  if (navigator.vibrate) {
    if (type === 'success') {
      navigator.vibrate([40, 60, 40]);
    } else {
      navigator.vibrate([100, 50, 100]);
    }
  }
}

// ----------------------------------------------------
// 2. NETWORK & OFFLINE RESILIENCE
// ----------------------------------------------------
function updateNetworkStatus() {
  const isOnline = navigator.onLine;
  const banner = document.getElementById('offlineBanner');
  const statusPill = document.getElementById('connectionStatus');
  const statusText = document.getElementById('connectionText');

  if (isOnline) {
    banner.classList.remove('active');
    statusPill.classList.remove('offline');
    statusText.textContent = 'Online';
  } else {
    banner.classList.add('active');
    statusPill.classList.add('offline');
    statusText.textContent = 'Offline (Draft Saved)';
  }
}

window.addEventListener('online', () => {
  updateNetworkStatus();
  syncProgressWithServer();
});
window.addEventListener('offline', updateNetworkStatus);

// ----------------------------------------------------
// 3. SEEDED PSEUDO-RANDOM NUMBER GENERATOR
// ----------------------------------------------------
function createSeededRandom(seed) {
  let value = seed >>> 0;
  return function seededRandom() {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return ((value >>> 0) % 1000000) / 1000000;
  };
}

// Build question order tailored to each team with exact 22-round sequence pattern:
// 3 Clues -> 1 Game -> 3 Clues -> 1 Game -> 3 Clues -> 1 Game -> 5 Clues -> 1 Game -> 3 Clues -> 1 Summit (LC1 Top Floor)
function buildTeamQuestions(config) {
  const allQuestions = Array.isArray(config.questions) ? config.questions : [];

  const regularClues = allQuestions.filter((q) => !q.isGame && !q.isLastClue);
  const games = allQuestions.filter((q) => q.isGame);
  const finalClue = allQuestions.find((q) => q.isLastClue || Number(q.id) === 22);

  const teamSeed = Number.parseInt(String(teamId), 10) || 1;
  const seededRandom = createSeededRandom((teamSeed * 1103515245 + SHUFFLE_SALT) >>> 0);

  // 1. Deterministically shuffle regular clues for this team
  const shuffledClues = [...regularClues];
  for (let i = shuffledClues.length - 1; i > 0; i--) {
    const j = Math.floor(seededRandom() * (i + 1));
    [shuffledClues[i], shuffledClues[j]] = [shuffledClues[j], shuffledClues[i]];
  }

  // 2. Deterministically shuffle the 4 mini-games for this team
  const shuffledGames = [...games];
  for (let i = shuffledGames.length - 1; i > 0; i--) {
    const j = Math.floor(seededRandom() * (i + 1));
    [shuffledGames[i], shuffledGames[j]] = [shuffledGames[j], shuffledGames[i]];
  }

  // 3. Assemble sequence: 3 clues, 1 game, 3 clues, 1 game, 3 clues, 1 game, 5 clues, 1 game, 3 clues, 1 final
  const flow = [
    shuffledClues[0],  // Round 1
    shuffledClues[1],  // Round 2
    shuffledClues[2],  // Round 3
    shuffledGames[0],  // Round 4 (Game 1)
    shuffledClues[3],  // Round 5
    shuffledClues[4],  // Round 6
    shuffledClues[5],  // Round 7
    shuffledGames[1],  // Round 8 (Game 2)
    shuffledClues[6],  // Round 9
    shuffledClues[7],  // Round 10
    shuffledClues[8],  // Round 11
    shuffledGames[2],  // Round 12 (Game 3)
    shuffledClues[9],  // Round 13
    shuffledClues[10], // Round 14
    shuffledClues[11], // Round 15
    shuffledClues[12], // Round 16
    shuffledClues[13], // Round 17
    shuffledGames[3],  // Round 18 (Game 4)
    shuffledClues[14], // Round 19
    shuffledClues[15], // Round 20
    shuffledClues[16], // Round 21
    finalClue           // Round 22 (LC1 Top Floor - Final Summit)
  ].filter(Boolean);

  return flow.map((item, index) => ({
    ...item,
    sequenceNo: index + 1
  }));
}

// ----------------------------------------------------
// 4. PROGRESS PERSISTENCE & AUTO-RESUME
// ----------------------------------------------------
function getProgressStorageKey() {
  return `th_progress:${teamId}`;
}

function getDraftStorageKey() {
  return `th_draft:${teamId}`;
}

function saveLocalProgress() {
  try {
    const payload = {
      version: PROGRESS_VERSION,
      teamId,
      currentQuestionIndex,
      updatedAt: new Date().toISOString()
    };
    localStorage.setItem(getProgressStorageKey(), JSON.stringify(payload));
  } catch (e) {
    console.warn('Could not save local progress:', e);
  }
}

function saveDraftAnswer(answer) {
  try {
    const draft = {
      questionIndex: currentQuestionIndex,
      answer: answer || '',
      updatedAt: new Date().toISOString()
    };
    localStorage.setItem(getDraftStorageKey(), JSON.stringify(draft));
  } catch (e) {}
}

function restoreDraft() {
  try {
    const raw = localStorage.getItem(getDraftStorageKey());
    if (!raw) return;
    const draft = JSON.parse(raw);
    if (draft && draft.questionIndex === currentQuestionIndex && draft.answer) {
      document.getElementById('answerInput').value = draft.answer;
    }
  } catch (e) {}
}

function clearDraft() {
  try {
    localStorage.removeItem(getDraftStorageKey());
  } catch (e) {}
}

async function syncProgressWithServer() {
  try {
    const res = await fetch(`/api/team-progress?teamId=${encodeURIComponent(teamId)}`);
    if (!res.ok) return;
    const data = await res.json();

    if (data && typeof data.completedCount === 'number') {
      const serverIndex = data.completedCount;
      if (serverIndex > currentQuestionIndex) {
        currentQuestionIndex = Math.min(serverIndex, orderedQuestions.length);
        saveLocalProgress();
        renderCurrentQuestion();
      }
    }
  } catch (err) {
    console.warn('Server progress sync deferred (offline or serverless boot):', err);
  }
}

// ----------------------------------------------------
// 5. CLIENT-SIDE CANVAS PHOTO COMPRESSION
// ----------------------------------------------------
async function compressImage(file, maxDimension = 1280, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (readerEvent) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', quality);

        canvas.toBlob(
          (blob) => {
            resolve({
              dataUrl,
              blob,
              sizeBytes: blob ? blob.size : 0
            });
          },
          'image/jpeg',
          quality
        );
      };
      img.onerror = reject;
      img.src = readerEvent.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function triggerCamera() {
  const input = document.getElementById('cameraInput');
  input.click();
}

async function handlePhotoSelected(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const dropzone = document.getElementById('cameraDropzone');
  const previewWrap = document.getElementById('photoPreviewWrap');
  const previewImg = document.getElementById('photoPreviewImg');
  const sizeBadge = document.getElementById('photoSizeBadge');

  dropzone.style.opacity = '0.5';
  sizeBadge.textContent = '⚡ Compressing photo...';

  try {
    const originalKb = Math.round(file.size / 1024);
    const result = await compressImage(file);
    const compressedKb = Math.round(result.sizeBytes / 1024);

    compressedPhotoDataUrl = result.dataUrl;
    compressedPhotoBlob = result.blob;
    compressedPhotoName = file.name || 'camera-photo.jpg';

    previewImg.src = result.dataUrl;
    previewWrap.classList.add('show');
    dropzone.style.display = 'none';

    sizeBadge.textContent = `✓ Photo Ready (${compressedKb} KB • was ${originalKb} KB)`;
  } catch (err) {
    console.error('Photo compression error:', err);
    alert('Failed to process image. Please try again.');
    dropzone.style.opacity = '1';
    dropzone.style.display = 'block';
  }
}

// ----------------------------------------------------
// 6. QUESTION DISPLAY & RENDERING
// ----------------------------------------------------
function renderCurrentQuestion() {
  const total = orderedQuestions.length;

  // Check if finished
  if (currentQuestionIndex >= total) {
    showVictoryScreen();
    return;
  }

  const q = orderedQuestions[currentQuestionIndex];
  const stepNo = currentQuestionIndex + 1;
  const pct = Math.round((stepNo / total) * 100);

  // Update progress bar
  document.getElementById('progressFill').style.width = `${pct}%`;
  document.getElementById('progressCount').textContent = `Checkpoint ${stepNo} / ${total}`;
  document.getElementById('clueIndexPill').textContent = `Step ${stepNo} of ${total}`;

  // Update clue tag & text
  const tag = document.getElementById('clueTypeTag');
  const titleEl = document.getElementById('clueTitle');
  if (q.isGame) {
    tag.textContent = '🎮 MINI-GAME CHALLENGE';
    tag.className = 'clue-tag game-tag';
    titleEl.textContent = 'Mini Game';
    titleEl.style.display = 'block';
  } else if (q.isLastClue || q.isFinal) {
    tag.textContent = '🏆 FINAL SUMMIT';
    tag.className = 'clue-tag final-tag';
    titleEl.textContent = 'Final Summit';
    titleEl.style.display = 'block';
  } else {
    tag.textContent = `Round ${stepNo} of ${total}`;
    tag.className = 'clue-tag';
    // Remove title for regular riddle clues so NO hints or place names are shown
    titleEl.textContent = '';
    titleEl.style.display = 'none';
  }

  document.getElementById('clueText').textContent = q.question;

  // Clear inputs & previews
  const answerInput = document.getElementById('answerInput');
  answerInput.value = '';
  restoreDraft();

  compressedPhotoDataUrl = null;
  compressedPhotoBlob = null;
  compressedPhotoName = '';
  document.getElementById('cameraInput').value = '';
  document.getElementById('cameraDropzone').style.display = 'block';
  document.getElementById('cameraDropzone').style.opacity = '1';
  document.getElementById('photoPreviewWrap').classList.remove('show');
  document.getElementById('photoPreviewImg').src = '';

  const fb = document.getElementById('formFeedback');
  fb.className = 'feedback-box';
  fb.textContent = '';

  // Focus answer box on desktop/tablets
  if (window.innerWidth > 768) {
    answerInput.focus();
  }
}

// ----------------------------------------------------
// 7. ANSWER VERIFICATION & SUBMISSION (SMART FUZZY MATCHING)
// ----------------------------------------------------
function normalizeString(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const row = [];
  for (let i = 0; i <= b.length; i++) row[i] = i;

  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      let val;
      if (a[i - 1] === b[j - 1]) {
        val = row[j - 1];
      } else {
        val = Math.min(row[j - 1] + 1, prev + 1, row[j] + 1);
      }
      row[j - 1] = prev;
      prev = val;
    }
    row[b.length] = prev;
  }
  return row[b.length];
}

function isAnswerCorrect(userAnswer, question) {
  const rawUser = String(userAnswer || '').toLowerCase().trim();
  const normUser = normalizeString(rawUser);
  if (!normUser) return false;

  const targets = [question.answer, ...(question.aliases || [])];

  for (const t of targets) {
    const rawTarget = String(t || '').toLowerCase().trim();
    const normTarget = normalizeString(rawTarget);

    // 1. Direct normalized match (ignores all spaces, punctuation, case)
    if (normUser === normTarget) return true;

    // 2. Keyword / Substring match (e.g. "at the savisandhi canteen" or "football")
    if (normTarget.length >= 4 && (normUser.includes(normTarget) || (normUser.length >= 5 && normTarget.includes(normUser)))) {
      return true;
    }

    // 3. Typo-tolerant Levenshtein distance:
    // Allows 1-2 character typos (e.g. savinidhi, savinnidhi, footbal, workhop, criket)
    const maxTypo = normTarget.length >= 8 ? 2 : normTarget.length >= 5 ? 1 : 0;
    if (maxTypo > 0 && Math.abs(normUser.length - normTarget.length) <= maxTypo) {
      if (levenshteinDistance(normUser, normTarget) <= maxTypo) {
        return true;
      }
    }
  }

  return false;
}

async function handleAnswerSubmit(event) {
  event.preventDefault();
  if (isSubmitting) return;

  const answerInput = document.getElementById('answerInput');
  const answer = answerInput.value.trim();
  const fb = document.getElementById('formFeedback');
  const submitBtn = document.getElementById('submitBtn');

  if (!answer) {
    fb.textContent = '❌ Please enter your answer or location name!';
    fb.className = 'feedback-box show error';
    answerInput.focus();
    playErrorTone();
    return;
  }

  if (!compressedPhotoDataUrl) {
    fb.textContent = '📷 Photo proof is required! Tap the camera button above to take a photo.';
    fb.className = 'feedback-box show error';
    playErrorTone();
    return;
  }

  const currentQ = orderedQuestions[currentQuestionIndex];
  const correct = isAnswerCorrect(answer, currentQ);

  if (!correct) {
    fb.textContent = '❌ Incorrect answer! Re-read the riddle carefully and check your surroundings.';
    fb.className = 'feedback-box show error';
    playErrorTone();
    triggerHaptic('error');
    return;
  }

  // Answer is verified!
  try {
    isSubmitting = true;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span> <span>Saving response & uploading proof...</span>';
    fb.textContent = '✓ Correct answer! Uploading photo proof...';
    fb.className = 'feedback-box show success';
    playSuccessChime();
    triggerHaptic('success');

    // Confetti burst for checkpoint
    if (window.confetti) {
      window.confetti({
        particleCount: 40,
        spread: 60,
        origin: { y: 0.8 }
      });
    }

    const payload = {
      teamId,
      teamName,
      questionId: currentQ.sequenceNo,
      question: currentQ.question,
      answer,
      isCorrect: true,
      timestamp: new Date().toLocaleTimeString(),
      photoDataUrl: compressedPhotoDataUrl,
      photoName: compressedPhotoName || `team${teamId}-q${currentQ.sequenceNo}.jpg`
    };

    const res = await fetch('/api/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Server failed to save submission.');
    }

    fb.textContent = '✓ Checkpoint cleared! Loading next clue...';
    clearDraft();

    currentQuestionIndex++;
    saveLocalProgress();

    setTimeout(() => {
      isSubmitting = false;
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>✓ Verify & Submit Checkpoint</span>';
      renderCurrentQuestion();
    }, 1200);

  } catch (err) {
    console.error('Submission error:', err);
    fb.textContent = `⚠️ Verified correctly, but upload encountered an issue: ${err.message}. Progress is saved locally. Please tap Submit to retry.`;
    fb.className = 'feedback-box show error';
    isSubmitting = false;
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span>🔄 Retry Upload</span>';
  }
}

// ----------------------------------------------------
// 8. VICTORY CELEBRATION
// ----------------------------------------------------
function showVictoryScreen() {
  document.getElementById('questionSection').style.display = 'none';
  document.getElementById('formSection').style.display = 'none';
  const victory = document.getElementById('victorySection');
  victory.style.display = 'block';

  document.getElementById('finalCheckpointsCount').textContent = `${orderedQuestions.length} / ${orderedQuestions.length}`;
  document.getElementById('progressFill').style.width = '100%';
  document.getElementById('progressCount').textContent = 'Completed (100%)';

  // Mega Confetti celebration
  if (window.confetti) {
    const duration = 3.5 * 1000;
    const animationEnd = Date.now() + duration;
    const interval = setInterval(() => {
      const timeLeft = animationEnd - Date.now();
      if (timeLeft <= 0) {
        return clearInterval(interval);
      }
      window.confetti({
        startVelocity: 30,
        spread: 360,
        ticks: 60,
        origin: { x: Math.random(), y: Math.random() - 0.2 }
      });
    }, 250);
  }
}

function viewSolvedCluesModal() {
  window.location.href = `team-responses.html?teamId=${encodeURIComponent(teamId)}`;
}

function handleLogout() {
  if (confirm('Log out from this team on this device?')) {
    localStorage.removeItem('th_authenticated');
    localStorage.removeItem('th_team_id');
    localStorage.removeItem('th_team_name');
    sessionStorage.clear();
    window.location.href = 'login.html';
  }
}

// ----------------------------------------------------
// 9. INITIALIZATION
// ----------------------------------------------------
async function initApp() {
  // Check authentication
  const authTeamId = localStorage.getItem('th_team_id') || sessionStorage.getItem('teamId');
  const authName = localStorage.getItem('th_team_name') || sessionStorage.getItem('teamName');

  // If no team is identified at all, go to login
  if (!authTeamId) {
    window.location.href = 'login.html';
    return;
  }

  // Ensure authenticated state is marked across both storages
  localStorage.setItem('th_team_id', String(authTeamId));
  localStorage.setItem('th_authenticated', 'true');
  sessionStorage.setItem('teamId', String(authTeamId));
  sessionStorage.setItem('authenticated', 'true');

  teamId = String(authTeamId);
  teamName = authName || `Team ${teamId}`;

  document.getElementById('headerTeamName').textContent = teamName;
  document.getElementById('headerTeamId').textContent = teamId;

  updateNetworkStatus();

  // Load questions
  try {
    const res = await fetch('/api/questions');
    const qConfig = await res.json();
    orderedQuestions = buildTeamQuestions(qConfig);
  } catch (err) {
    console.error('Failed to fetch questions from API, attempting local fallback:', err);
    try {
      const localRes = await fetch('questions.json');
      const localConfig = await localRes.json();
      orderedQuestions = buildTeamQuestions(localConfig);
    } catch (e) {
      alert('Error loading hunt questions. Please check connection and refresh.');
      return;
    }
  }

  // Restore local progress
  try {
    const saved = localStorage.getItem(getProgressStorageKey());
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed.currentQuestionIndex === 'number') {
        currentQuestionIndex = Math.min(parsed.currentQuestionIndex, orderedQuestions.length);
      }
    }
  } catch (e) {}

  // Sync with server progress to ensure cross-device / reconnection continuation
  await syncProgressWithServer();

  // Auto-save draft on input change
  const answerInput = document.getElementById('answerInput');
  answerInput.addEventListener('input', (e) => {
    saveDraftAnswer(e.target.value);
  });

  renderCurrentQuestion();
}

document.addEventListener('DOMContentLoaded', initApp);
