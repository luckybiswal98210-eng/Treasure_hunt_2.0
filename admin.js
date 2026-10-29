// ==========================================================================
// Campus Treasure Hunt 2.0 - Organizer Control Center Logic
// ==========================================================================

let allSubmissions = [];
let allCredentials = [];
let questionsConfig = null;
let soundAlerts = true;
let pollTimer = null;
let lastSeenId = 0;
let isFirstLoad = true;

// ----------------------------------------------------
// 1. SOUND SYNTHESIZER FOR LIVE ALERTS
// ----------------------------------------------------
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    const AudioClass = window.AudioContext || window.webkitAudioContext;
    if (AudioClass) audioCtx = new AudioClass();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function playSubmissionAlertSound() {
  if (!soundAlerts) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    
    // Modern dual chime: F5 (698.46Hz) -> A5 (880Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(698.46, now);
    gain1.gain.setValueAtTime(0.12, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.2);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, now + 0.1);
    gain2.gain.setValueAtTime(0.15, now + 0.1);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.1);
    osc2.stop(now + 0.4);
  } catch (e) {}
}

function toggleSoundAlerts() {
  soundAlerts = !soundAlerts;
  const btn = document.getElementById('soundToggleBtn');
  const icon = document.getElementById('soundIcon');
  if (soundAlerts) {
    btn.classList.add('active');
    btn.innerHTML = '<span>🔔</span> Sound Alerts: ON';
  } else {
    btn.classList.remove('active');
    btn.innerHTML = '<span>🔕</span> Sound Alerts: OFF';
  }
}

// ----------------------------------------------------
// 2. TAB SWITCHING
// ----------------------------------------------------
function switchTab(tabId) {
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));

  const targetPanel = document.getElementById(tabId);
  if (targetPanel) targetPanel.classList.add('active');

  const clickedBtn = Array.from(document.querySelectorAll('.tab-btn')).find((b) =>
    b.getAttribute('onclick').includes(tabId)
  );
  if (clickedBtn) clickedBtn.classList.add('active');

  // Trigger special tab renders
  if (tabId === 'tabMatrix') renderMatrix();
  if (tabId === 'tabLeaderboard') renderLeaderboard();
  if (tabId === 'tabCredentials') renderCredentialsTable();
  if (tabId === 'tabQuestions') renderQuestionsTable();
}

// ----------------------------------------------------
// 3. DATA FETCHING & LIVE POLLING
// ----------------------------------------------------
async function fetchAllData() {
  try {
    const [subsRes, credsRes, questRes] = await Promise.all([
      fetch('/api/submissions'),
      fetch('/api/credentials'),
      fetch('/api/questions')
    ]);

    const subs = await subsRes.json();
    const creds = await credsRes.json();
    const quests = await questRes.json();

    allCredentials = Array.isArray(creds.teams) ? creds.teams : [];
    questionsConfig = quests;

    // Check for newly arrived submissions
    if (Array.isArray(subs)) {
      if (!isFirstLoad && subs.length > allSubmissions.length) {
        const newItemsCount = subs.length - allSubmissions.length;
        playSubmissionAlertSound();
      }
      allSubmissions = subs;
    }

    isFirstLoad = false;
    updateStats();
    populateTeamFilter();
    filterSubmissions();
    renderLeaderboard();
  } catch (err) {
    console.error('Data sync error:', err);
  }
}

function startLivePolling() {
  fetchAllData();
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(fetchAllData, 3000);
}

function manualRefresh() {
  fetchAllData();
}

// ----------------------------------------------------
// 4. STATS & LIVE FEED
// ----------------------------------------------------
function updateStats() {
  const activeTeams = new Set(allSubmissions.map((s) => String(s.teamId)));
  const totalTeams = allCredentials.length || 45;
  document.getElementById('statActiveTeams').textContent = `${activeTeams.size} / ${totalTeams}`;

  const correctSubs = allSubmissions.filter((s) => s.isCorrect);
  document.getElementById('statCompletedClues').textContent = correctSubs.length;

  const photoCount = allSubmissions.filter((s) => Boolean(s.photoPath)).length;
  document.getElementById('statTotalPhotos').textContent = photoCount;

  // Compute leader
  const teamScores = {};
  correctSubs.forEach((s) => {
    const tid = String(s.teamId);
    if (!teamScores[tid]) {
      teamScores[tid] = { count: 0, lastTime: s.createdAt, name: s.teamName || `Team ${tid}` };
    }
    teamScores[tid].count += 1;
    if (new Date(s.createdAt) > new Date(teamScores[tid].lastTime)) {
      teamScores[tid].lastTime = s.createdAt;
    }
  });

  const sorted = Object.values(teamScores).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return new Date(a.lastTime) - new Date(b.lastTime);
  });

  if (sorted.length > 0 && sorted[0].count > 0) {
    document.getElementById('statLeadingTeam').textContent = `${sorted[0].name} (${sorted[0].count} pts)`;
  } else {
    document.getElementById('statLeadingTeam').textContent = '--';
  }
}

function populateTeamFilter() {
  const select = document.getElementById('teamFilterSelect');
  const currentVal = select.value;
  select.innerHTML = '<option value="">All Teams (45)</option>';

  const teams = [...allCredentials].sort((a, b) => Number(a.id) - Number(b.id));
  teams.forEach((t) => {
    const opt = document.createElement('option');
    opt.value = String(t.id);
    opt.textContent = `${t.name || 'Team ' + t.id} (ID: ${t.id})`;
    select.appendChild(opt);
  });

  select.value = currentVal;
}

function formatRelativeTime(dateString) {
  if (!dateString) return '';
  const now = Date.now();
  const past = new Date(dateString).getTime();
  const diffSecs = Math.max(0, Math.floor((now - past) / 1000));

  if (diffSecs < 10) return 'Just now';
  if (diffSecs < 60) return `${diffSecs}s ago`;
  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return new Date(dateString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function filterSubmissions() {
  const search = (document.getElementById('searchClueInput').value || '').toLowerCase().trim();
  const selectedTeam = document.getElementById('teamFilterSelect').value;

  let filtered = allSubmissions.filter((item) => {
    if (selectedTeam && String(item.teamId) !== String(selectedTeam)) {
      return false;
    }
    if (search) {
      const matchTeam = String(item.teamName || '').toLowerCase().includes(search);
      const matchQ = String(item.question || '').toLowerCase().includes(search);
      const matchA = String(item.answer || '').toLowerCase().includes(search);
      const matchId = String(item.teamId).includes(search);
      return matchTeam || matchQ || matchA || matchId;
    }
    return true;
  });

  document.getElementById('submissionCountBadge').textContent = `Showing ${filtered.length} submissions`;
  renderSubmissionsGrid(filtered);
}

function renderSubmissionsGrid(items) {
  const grid = document.getElementById('submissionsGrid');
  if (items.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 40px; text-align: center; color: var(--text-dim); background: var(--admin-card); border-radius: var(--radius-lg); border: 1px dashed var(--admin-border);">
        <div style="font-size: 32px; margin-bottom: 8px;">📷</div>
        <p>No submissions matching filter criteria.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = items
    .map((sub) => {
      const photoSrc = sub.photoPath || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><rect width="100%" height="100%" fill="%231e293b"/><text x="50%" y="50%" fill="%2364748b" dominant-baseline="middle" text-anchor="middle">No Photo</text></svg>';
      const relTime = formatRelativeTime(sub.createdAt);
      const exactTime = sub.submittedAt || (sub.createdAt ? new Date(sub.createdAt).toLocaleTimeString() : '');

      return `
        <div class="sub-card">
          <div class="sub-thumb-wrap" onclick="openPhotoModal('${encodeURIComponent(photoSrc)}', '${escapeHtml(sub.teamName)}', 'Checkpoint ${sub.questionId}', '${escapeHtml(sub.answer)}', '${exactTime}')">
            <img class="sub-thumb" src="${photoSrc}" loading="lazy" alt="Proof">
            <div class="sub-badge-row">
              <span class="badge-team">${escapeHtml(sub.teamName || 'Team ' + sub.teamId)}</span>
              <span class="badge-time">⏱️ ${relTime}</span>
            </div>
          </div>
          <div class="sub-body">
            <div>
              <div class="sub-clue-title">Checkpoint #${sub.questionId}</div>
              <div class="sub-answer-box">
                <div class="sub-answer-label">Team Answer</div>
                <div class="sub-answer-val">✓ ${escapeHtml(sub.answer)}</div>
              </div>
            </div>
            <div class="sub-actions">
              <span style="font-size: 11px; color: var(--text-dim);">Time: ${exactTime}</span>
              <a class="btn-download-photo" download="team${sub.teamId}-q${sub.questionId}.jpg" href="${photoSrc}">
                ⬇️ Download
              </a>
            </div>
          </div>
        </div>
      `;
    })
    .join('');
}

// ----------------------------------------------------
// 5. LEADERBOARD
// ----------------------------------------------------
function renderLeaderboard() {
  const tbody = document.getElementById('leaderboardTbody');
  if (!tbody) return;

  const totalCheckpoints = (questionsConfig && questionsConfig.questions ? questionsConfig.questions.length : 21) + 4;

  // Group verified submissions by team
  const teamsMap = {};
  allCredentials.forEach((t) => {
    teamsMap[String(t.id)] = {
      id: String(t.id),
      name: t.name || `Team ${t.id}`,
      completedSet: new Set(),
      lastSubmissionTime: null
    };
  });

  allSubmissions.forEach((s) => {
    if (!s.isCorrect) return;
    const tid = String(s.teamId);
    if (!teamsMap[tid]) {
      teamsMap[tid] = {
        id: tid,
        name: s.teamName || `Team ${tid}`,
        completedSet: new Set(),
        lastSubmissionTime: null
      };
    }
    teamsMap[tid].completedSet.add(Number(s.questionId));
    const subTime = new Date(s.createdAt).getTime();
    if (!teamsMap[tid].lastSubmissionTime || subTime > teamsMap[tid].lastSubmissionTime) {
      teamsMap[tid].lastSubmissionTime = subTime;
    }
  });

  const ranked = Object.values(teamsMap).sort((a, b) => {
    const aCount = a.completedSet.size;
    const bCount = b.completedSet.size;
    if (bCount !== aCount) return bCount - aCount;
    if (a.lastSubmissionTime && b.lastSubmissionTime) {
      return a.lastSubmissionTime - b.lastSubmissionTime;
    }
    return a.lastSubmissionTime ? -1 : 1;
  });

  tbody.innerHTML = ranked
    .map((team, idx) => {
      const rank = idx + 1;
      let badgeClass = 'rank-default';
      if (rank === 1 && team.completedSet.size > 0) badgeClass = 'rank-1';
      else if (rank === 2 && team.completedSet.size > 0) badgeClass = 'rank-2';
      else if (rank === 3 && team.completedSet.size > 0) badgeClass = 'rank-3';

      const pct = Math.round((team.completedSet.size / totalCheckpoints) * 100);
      const timeStr = team.lastSubmissionTime
        ? new Date(team.lastSubmissionTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : '--';

      return `
        <tr>
          <td>
            <div class="rank-badge ${badgeClass}">${rank}</div>
          </td>
          <td style="font-weight: 700;">${escapeHtml(team.name)}</td>
          <td><code style="color: #a5b4fc;">${escapeHtml(team.id)}</code></td>
          <td style="font-weight: 800; color: var(--success);">${team.completedSet.size} / ${totalCheckpoints}</td>
          <td style="width: 180px;">
            <div style="background: rgba(255,255,255,0.06); height: 8px; border-radius: 999px; overflow: hidden;">
              <div style="background: var(--accent-gradient); width: ${pct}%; height: 100%;"></div>
            </div>
            <div style="font-size: 11px; color: var(--text-dim); margin-top: 4px;">${pct}% completed</div>
          </td>
          <td>${timeStr}</td>
          <td>
            <a href="team-responses.html?teamId=${encodeURIComponent(team.id)}" class="btn-control" style="padding: 4px 10px; font-size: 12px;">
              🔍 Photos
            </a>
          </td>
        </tr>
      `;
    })
    .join('');
}

// ----------------------------------------------------
// 6. 45-TEAM PROGRESS MATRIX
// ----------------------------------------------------
function renderMatrix() {
  const table = document.getElementById('matrixTable');
  if (!table) return;

  const totalCheckpoints = 25;
  const teams = [...allCredentials].sort((a, b) => Number(a.id) - Number(b.id));

  // Build matrix lookup
  const teamSolves = {};
  allSubmissions.forEach((s) => {
    if (!s.isCorrect) return;
    const tid = String(s.teamId);
    if (!teamSolves[tid]) teamSolves[tid] = {};
    teamSolves[tid][Number(s.questionId)] = s;
  });

  let html = '<thead><tr><th>Team</th>';
  for (let c = 1; c <= totalCheckpoints; c++) {
    html += `<th>Q${c}</th>`;
  }
  html += '<th>Total</th></tr></thead><tbody>';

  teams.forEach((t) => {
    const tid = String(t.id);
    const solvedMap = teamSolves[tid] || {};
    const solvedCount = Object.keys(solvedMap).length;

    html += `<tr><td style="font-weight:700; text-align:left; white-space:nowrap;">${escapeHtml(t.name || 'Team ' + tid)}</td>`;

    for (let c = 1; c <= totalCheckpoints; c++) {
      const sub = solvedMap[c];
      if (sub) {
        const photoUrl = sub.photoPath || '';
        html += `<td class="matrix-cell-done" title="Solved at ${sub.submittedAt || ''}: ${escapeHtml(sub.answer)}" onclick="openPhotoModal('${encodeURIComponent(photoUrl)}', '${escapeHtml(t.name)}', 'Checkpoint ${c}', '${escapeHtml(sub.answer)}', '${sub.submittedAt || ''}')">📷</td>`;
      } else if (c === solvedCount + 1) {
        html += `<td class="matrix-cell-current" title="Currently solving">⚡</td>`;
      } else {
        html += `<td class="matrix-cell-locked">-</td>`;
      }
    }

    html += `<td style="font-weight:800; color:var(--success);">${solvedCount}</td></tr>`;
  });

  html += '</tbody>';
  table.innerHTML = html;
}

// ----------------------------------------------------
// 7. TEAM CREDENTIALS MANAGER
// ----------------------------------------------------
function renderCredentialsTable() {
  const tbody = document.getElementById('credentialsTbody');
  if (!tbody) return;

  const teams = [...allCredentials].sort((a, b) => Number(a.id) - Number(b.id));

  tbody.innerHTML = teams
    .map(
      (t, idx) => `
      <tr id="cred-row-${idx}">
        <td>
          <input type="text" class="editable-input" id="cred-id-${idx}" value="${escapeHtml(t.id)}">
        </td>
        <td>
          <input type="text" class="editable-input" id="cred-name-${idx}" value="${escapeHtml(t.name || 'Team ' + t.id)}">
        </td>
        <td>
          <input type="text" class="editable-input" id="cred-pass-${idx}" value="${escapeHtml(t.password || '')}">
        </td>
        <td>
          <button type="button" class="btn-control active" style="padding: 6px 12px; font-size: 12px;" onclick="saveSingleTeamCredential(${idx})">
            💾 Save
          </button>
        </td>
      </tr>
    `
    )
    .join('');
}

async function saveSingleTeamCredential(idx) {
  const id = document.getElementById(`cred-id-${idx}`).value.trim();
  const name = document.getElementById(`cred-name-${idx}`).value.trim();
  const password = document.getElementById(`cred-pass-${idx}`).value.trim();

  if (!id || !password) {
    alert('Team ID and Password cannot be blank.');
    return;
  }

  try {
    const res = await fetch('/api/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update',
        team: { id, name, password }
      })
    });

    if (res.ok) {
      alert(`✓ Credentials for Team ${id} saved successfully!`);
      fetchAllData();
    } else {
      const err = await res.json();
      alert('Failed to save credentials: ' + (err.error || 'Unknown error'));
    }
  } catch (e) {
    alert('Network error while saving credentials.');
  }
}

function addNewTeamRow() {
  const nextId = String(allCredentials.length + 1);
  const newTeam = {
    id: nextId,
    name: `Team ${nextId}`,
    password: `team@${nextId}`
  };
  allCredentials.push(newTeam);
  renderCredentialsTable();
  const lastIndex = allCredentials.length - 1;
  const row = document.getElementById(`cred-row-${lastIndex}`);
  if (row) row.scrollIntoView({ behavior: 'smooth' });
}

function exportCredentialsCsv() {
  let csv = 'Team ID,Team Name,Password\n';
  allCredentials.forEach((t) => {
    csv += `"${t.id}","${t.name || 'Team ' + t.id}","${t.password || ''}"\n`;
  });

  downloadTextFile(csv, 'campus-treasure-hunt-credentials.csv', 'text/csv');
}

// ----------------------------------------------------
// 8. QUESTIONS DIRECTORY TABLE
// ----------------------------------------------------
function renderQuestionsTable() {
  const tbody = document.getElementById('questionsTbody');
  if (!tbody || !questionsConfig) return;

  const clues = Array.isArray(questionsConfig.questions) ? questionsConfig.questions : [];
  const games = Array.isArray(questionsConfig.gameCheckpoints) ? questionsConfig.gameCheckpoints : [];

  const allItems = [...clues, ...games];

  tbody.innerHTML = allItems
    .map(
      (q, idx) => `
      <tr>
        <td style="font-weight:700;">${idx + 1}</td>
        <td>
          <span class="badge-team" style="${q.isGame ? 'background:rgba(245,158,11,0.2); color:#fbbf24; border-color:rgba(245,158,11,0.4);' : ''}">
            ${q.isGame ? 'Mini-Game' : 'Clue Riddle'}
          </span>
        </td>
        <td style="font-weight:700;">${escapeHtml(q.title || '')}</td>
        <td style="max-width: 400px; font-size: 13px; color: #cbd5e1;">${escapeHtml(q.question)}</td>
        <td style="font-weight:800; color: var(--success);">${escapeHtml(q.answer)}</td>
        <td style="font-size:12px; color: var(--text-dim);">${Array.isArray(q.aliases) ? q.aliases.join(', ') : ''}</td>
      </tr>
    `
    )
    .join('');
}

// ----------------------------------------------------
// 9. EXPORT: ZIP DOWNLOAD & CSV EXPORT
// ----------------------------------------------------
async function downloadAllPhotosZip() {
  const btn = document.getElementById('btnDownloadZip');
  const prog = document.getElementById('zipProgress');

  if (!window.JSZip) {
    alert('JSZip library loading. Please try again in a moment.');
    return;
  }

  const subsWithPhotos = allSubmissions.filter((s) => Boolean(s.photoPath));
  if (subsWithPhotos.length === 0) {
    alert('No photo submissions collected yet.');
    return;
  }

  btn.disabled = true;
  prog.style.display = 'block';
  prog.textContent = `Processing 0 of ${subsWithPhotos.length} photos...`;

  try {
    const zip = new window.JSZip();

    for (let i = 0; i < subsWithPhotos.length; i++) {
      const s = subsWithPhotos[i];
      prog.textContent = `Packaging photo ${i + 1} of ${subsWithPhotos.length}...`;

      const safeTeam = String(s.teamId).padStart(2, '0');
      const folderName = `Team_${safeTeam}`;
      const ext = s.photoMimeType && s.photoMimeType.includes('png') ? '.png' : '.jpg';
      const fileName = `Checkpoint_${String(s.questionId).padStart(2, '0')}_${(s.answer || 'proof').replace(/[^a-zA-Z0-9]/g, '_')}${ext}`;

      const photoSrc = s.photoPath;

      if (photoSrc.startsWith('data:image')) {
        // Base64 image
        const base64Data = photoSrc.split(',')[1];
        zip.folder(folderName).file(fileName, base64Data, { base64: true });
      } else {
        // URL fetch
        try {
          const resp = await fetch(photoSrc);
          const blob = await resp.blob();
          zip.folder(folderName).file(fileName, blob);
        } catch (fetchErr) {
          console.warn('Failed to include photo in ZIP:', photoSrc, fetchErr);
        }
      }
    }

    prog.textContent = 'Generating ZIP archive...';
    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);

    const a = document.createElement('a');
    a.href = url;
    a.download = `treasure-hunt-photos-${new Date().toISOString().slice(0, 10)}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    prog.textContent = `✓ ZIP download initiated (${subsWithPhotos.length} photos packaged)!`;
  } catch (err) {
    console.error('ZIP generation error:', err);
    alert('Failed to generate ZIP: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}

function exportSubmissionsCsv() {
  if (allSubmissions.length === 0) {
    alert('No submissions recorded yet.');
    return;
  }

  let csv = 'ID,Team ID,Team Name,Checkpoint No,Question,Answer,Correct,Submitted Time,Created At,Has Photo\n';

  allSubmissions.forEach((s) => {
    csv += [
      s.id,
      `"${s.teamId}"`,
      `"${(s.teamName || '').replace(/"/g, '""')}"`,
      s.questionId,
      `"${(s.question || '').replace(/"/g, '""')}"`,
      `"${(s.answer || '').replace(/"/g, '""')}"`,
      s.isCorrect ? 'YES' : 'NO',
      `"${s.submittedAt || ''}"`,
      `"${s.createdAt || ''}"`,
      s.photoPath ? 'YES' : 'NO'
    ].join(',') + '\n';
  });

  downloadTextFile(csv, `treasure-hunt-submissions-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
}

function downloadTextFile(content, fileName, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ----------------------------------------------------
// 10. RESET SUBMISSIONS
// ----------------------------------------------------
async function resetEventSubmissions() {
  const confirmText = prompt('Type RESET to confirm clearing all submissions:');
  if (confirmText !== 'RESET') {
    alert('Reset canceled.');
    return;
  }

  const token = prompt('Enter Admin Reset Token (default: huntadmin2026):') || 'huntadmin2026';

  try {
    const res = await fetch('/api/admin/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });

    const data = await res.json();
    if (res.ok) {
      alert('✓ ' + data.message);
      fetchAllData();
    } else {
      alert('❌ Reset failed: ' + (data.error || 'Unauthorized'));
    }
  } catch (err) {
    alert('Network error while resetting.');
  }
}

// ----------------------------------------------------
// 11. LIGHTBOX PHOTO MODAL
// ----------------------------------------------------
function openPhotoModal(encodedUrl, teamName, clueTitle, answer, timestamp) {
  const url = decodeURIComponent(encodedUrl);
  const modal = document.getElementById('photoModal');
  const img = document.getElementById('modalImg');
  const title = document.getElementById('modalTitle');
  const meta = document.getElementById('modalMeta');
  const dlBtn = document.getElementById('modalDownloadBtn');

  img.src = url;
  title.textContent = `${teamName} — ${clueTitle}`;
  meta.textContent = `Answer: "${answer}" • Time: ${timestamp}`;
  dlBtn.href = url;

  modal.classList.add('show');
}

function closePhotoModal(e) {
  if (e && e.target && e.target.id !== 'photoModal' && !e.target.classList.contains('btn-close-modal')) {
    return;
  }
  document.getElementById('photoModal').classList.remove('show');
}

// ----------------------------------------------------
// 12. UTILITIES
// ----------------------------------------------------
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

document.addEventListener('DOMContentLoaded', startLivePolling);

