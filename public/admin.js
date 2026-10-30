// ==========================================================================
// Campus Treasure Hunt 2.0 - Organizer Control Center Logic
// ==========================================================================

let allSubmissions = [];
let allCredentials = [];
let questionsConfig = null;
let soundAlerts = true;
let pollTimer = null;
let isFirstLoad = true;
let activeModalTeamId = null;

// ----------------------------------------------------
// 1. DATE & TIME FORMATTERS (EXACT TIMESTAMPS)
// ----------------------------------------------------
function formatExactTime(dateInput) {
  if (!dateInput) return '--';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return String(dateInput);

  return d.toLocaleString('en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
}

function formatTimeOnly(dateInput) {
  if (!dateInput) return '--';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return String(dateInput);

  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
}

function formatRelativeTime(dateString) {
  if (!dateString) return '';
  const now = Date.now();
  const past = new Date(dateString).getTime();
  if (isNaN(past)) return '';
  const diffSecs = Math.max(0, Math.floor((now - past) / 1000));

  if (diffSecs < 10) return 'Just now';
  if (diffSecs < 60) return `${diffSecs}s ago`;
  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return formatTimeOnly(dateString);
}

// ----------------------------------------------------
// 2. SOUND SYNTHESIZER FOR LIVE ALERTS
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
  if (soundAlerts) {
    btn.classList.add('active');
    btn.innerHTML = '<span id="soundIcon">🔔</span> Sound Alerts: ON';
  } else {
    btn.classList.remove('active');
    btn.innerHTML = '<span id="soundIcon">🔕</span> Sound Alerts: OFF';
  }
}

// ----------------------------------------------------
// 3. TAB SWITCHING
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

  if (tabId === 'tabMatrix') renderMatrix();
  if (tabId === 'tabLeaderboard') renderLeaderboard();
  if (tabId === 'tabCredentials') renderCredentialsTable();
  if (tabId === 'tabQuestions') renderQuestionsTable();
  if (tabId === 'tabExport') populateExportSelect();
}

// ----------------------------------------------------
// 4. DATA FETCHING & LIVE POLLING
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

    if (Array.isArray(subs)) {
      if (!isFirstLoad && subs.length > allSubmissions.length) {
        playSubmissionAlertSound();
      }
      allSubmissions = subs;
    }

    isFirstLoad = false;
    updateStats();
    populateTeamFilter();
    populateExportSelect();
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

function getTotalCheckpoints() {
  if (questionsConfig && Array.isArray(questionsConfig.questions)) {
    const qCount = questionsConfig.questions.length;
    const gCount = Array.isArray(questionsConfig.gameCheckpoints) ? questionsConfig.gameCheckpoints.length : 0;
    return qCount + gCount || 21;
  }
  return 21;
}

// ----------------------------------------------------
// 5. STATS & LIVE FEED (WITH EXACT TIME WISE PROOFS)
// ----------------------------------------------------
function updateStats() {
  const activeTeams = new Set(allSubmissions.map((s) => String(s.teamId)));
  const totalTeams = allCredentials.length || 45;
  document.getElementById('statActiveTeams').textContent = `${activeTeams.size} / ${totalTeams}`;

  const correctSubs = allSubmissions.filter((s) => s.isCorrect);
  document.getElementById('statCompletedClues').textContent = correctSubs.length;

  const photoCount = allSubmissions.filter((s) => Boolean(s.photoPath)).length;
  document.getElementById('statTotalPhotos').textContent = photoCount;

  const totalCheckpoints = getTotalCheckpoints();
  const qCountEl1 = document.getElementById('tabQuestionsCount');
  if (qCountEl1) qCountEl1.textContent = totalCheckpoints;
  const qCountEl2 = document.getElementById('questionsCountHeading');
  if (qCountEl2) qCountEl2.textContent = totalCheckpoints;

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
  if (!select) return;
  const currentVal = select.value;
  select.innerHTML = '<option value="">All Teams</option>';

  const teams = [...allCredentials].sort((a, b) => Number(a.id) - Number(b.id));
  teams.forEach((t) => {
    const opt = document.createElement('option');
    opt.value = String(t.id);
    opt.textContent = `${t.name || 'Team ' + t.id} (ID: ${t.id})`;
    select.appendChild(opt);
  });

  select.value = currentVal;
}

function populateExportSelect() {
  const select = document.getElementById('pdfTeamSelect');
  if (!select) return;
  const currentVal = select.value || 'all';
  select.innerHTML = '<option value="all">🌟 All Teams (Combined Dossier)</option>';

  const teams = [...allCredentials].sort((a, b) => Number(a.id) - Number(b.id));
  teams.forEach((t) => {
    const opt = document.createElement('option');
    opt.value = String(t.id);
    opt.textContent = `Team ${t.id}: ${t.name || 'Team ' + t.id}`;
    select.appendChild(opt);
  });

  select.value = currentVal;
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
      const exactTimeStr = formatExactTime(sub.createdAt || sub.submittedAt);
      const timeOnly = formatTimeOnly(sub.createdAt || sub.submittedAt);

      return `
        <div class="sub-card">
          <div class="sub-thumb-wrap" onclick="openPhotoModal('${encodeURIComponent(photoSrc)}', '${escapeHtml(sub.teamName)}', 'Checkpoint ${sub.questionId}', '${escapeHtml(sub.answer)}', '${exactTimeStr}', '${sub.teamId}')">
            <img class="sub-thumb" src="${photoSrc}" loading="lazy" alt="Proof">
            <div class="sub-badge-row">
              <span class="badge-team">${escapeHtml(sub.teamName || 'Team ' + sub.teamId)}</span>
              <span class="badge-time">⏱️ ${relTime || timeOnly}</span>
            </div>
          </div>
          
          <!-- Explicit Time Banner -->
          <div class="sub-time-banner">
            <span>📅 ${exactTimeStr}</span>
            <span style="font-size: 11px; opacity: 0.85;">${relTime}</span>
          </div>

          <div class="sub-body">
            <div>
              <div class="sub-clue-title">Checkpoint #${sub.questionId}: ${escapeHtml(sub.question || '')}</div>
              <div class="sub-answer-box">
                <div class="sub-answer-label">Team Answer</div>
                <div class="sub-answer-val">✓ ${escapeHtml(sub.answer)}</div>
              </div>
            </div>
            <div class="sub-actions">
              <button type="button" class="btn-pdf" onclick="generateTeamProgressPdf('${sub.teamId}')">
                📄 PDF Report
              </button>
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
// 6. LEADERBOARD (WITH PDF ACTION BUTTONS)
// ----------------------------------------------------
function renderLeaderboard() {
  const tbody = document.getElementById('leaderboardTbody');
  if (!tbody) return;

  const totalCheckpoints = getTotalCheckpoints();

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
      const timeStr = team.lastSubmissionTime ? formatExactTime(team.lastSubmissionTime) : '--';

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
          <td style="font-size: 13px;">${timeStr}</td>
          <td>
            <div style="display: flex; gap: 6px;">
              <button type="button" class="btn-pdf" onclick="generateTeamProgressPdf('${team.id}')">
                📄 PDF
              </button>
              <a href="team-responses.html?teamId=${encodeURIComponent(team.id)}" class="btn-control" style="padding: 4px 10px; font-size: 12px;">
                🔍 Photos
              </a>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');
}

// ----------------------------------------------------
// 7. 45-TEAM PROGRESS MATRIX
// ----------------------------------------------------
function renderMatrix() {
  const table = document.getElementById('matrixTable');
  if (!table) return;

  const totalCheckpoints = getTotalCheckpoints();
  const teams = [...allCredentials].sort((a, b) => Number(a.id) - Number(b.id));

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
        const exactTime = formatExactTime(sub.createdAt || sub.submittedAt);
        html += `<td class="matrix-cell-done" title="Solved at ${exactTime}: ${escapeHtml(sub.answer)}" onclick="openPhotoModal('${encodeURIComponent(photoUrl)}', '${escapeHtml(t.name)}', 'Checkpoint ${c}', '${escapeHtml(sub.answer)}', '${exactTime}', '${tid}')">📷</td>`;
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
// 8. TEAM CREDENTIALS MANAGER (EDIT, ADD, DELETE)
// ----------------------------------------------------
function renderCredentialsTable() {
  const tbody = document.getElementById('credentialsTbody');
  if (!tbody) return;

  const search = (document.getElementById('searchTeamCredInput')?.value || '').toLowerCase().trim();

  let teams = [...allCredentials].sort((a, b) => Number(a.id) - Number(b.id));
  if (search) {
    teams = teams.filter((t) => {
      return String(t.id).includes(search) || String(t.name || '').toLowerCase().includes(search);
    });
  }

  // Count cleared checkpoints per team
  const clearedCounts = {};
  allSubmissions.forEach((s) => {
    if (s.isCorrect) {
      const tid = String(s.teamId);
      if (!clearedCounts[tid]) clearedCounts[tid] = new Set();
      clearedCounts[tid].add(Number(s.questionId));
    }
  });

  tbody.innerHTML = teams
    .map((t) => {
      const count = clearedCounts[String(t.id)] ? clearedCounts[String(t.id)].size : 0;
      return `
        <tr id="cred-row-${t.id}">
          <td>
            <code style="font-weight: 700; color: #a5b4fc; font-size: 14px;">${escapeHtml(t.id)}</code>
          </td>
          <td>
            <input type="text" class="editable-input" id="cred-name-${t.id}" value="${escapeHtml(t.name || 'Team ' + t.id)}" placeholder="Team Name">
          </td>
          <td>
            <input type="text" class="editable-input" id="cred-pass-${t.id}" value="${escapeHtml(t.password || '')}" placeholder="Password">
          </td>
          <td>
            <span style="font-weight: 700; color: ${count > 0 ? 'var(--success)' : 'var(--text-dim)'};">
              ${count} / ${getTotalCheckpoints()}
            </span>
          </td>
          <td>
            <div class="cred-actions-cell">
              <button type="button" class="btn-control active" style="padding: 6px 12px; font-size: 12px;" onclick="saveSingleTeamCredential('${t.id}')">
                💾 Save
              </button>
              <button type="button" class="btn-pdf" onclick="generateTeamProgressPdf('${t.id}')">
                📄 PDF
              </button>
              <button type="button" class="btn-danger-outline" onclick="deleteSingleTeam('${t.id}', '${escapeHtml(t.name || 'Team ' + t.id)}')">
                🗑️ Delete
              </button>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');
}

async function saveSingleTeamCredential(teamId) {
  const nameInput = document.getElementById(`cred-name-${teamId}`);
  const passInput = document.getElementById(`cred-pass-${teamId}`);

  if (!nameInput || !passInput) return;
  const name = nameInput.value.trim();
  const password = passInput.value.trim();

  if (!password) {
    alert('Team password cannot be empty.');
    return;
  }

  try {
    const res = await fetch('/api/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update',
        team: { id: String(teamId), name, password }
      })
    });

    if (res.ok) {
      alert(`✓ Credentials for Team ${teamId} saved successfully!`);
      fetchAllData();
    } else {
      const err = await res.json();
      alert('Failed to save credentials: ' + (err.error || 'Unknown error'));
    }
  } catch (e) {
    alert('Network error while saving credentials.');
  }
}

async function deleteSingleTeam(teamId, teamName) {
  const confirmed = confirm(`Are you sure you want to delete ${teamName} (ID: ${teamId})?\n\nThis will remove the team from the active roster.`);
  if (!confirmed) return;

  try {
    const res = await fetch(`/api/credentials?id=${encodeURIComponent(teamId)}`, {
      method: 'DELETE'
    });

    if (res.ok) {
      alert(`✓ Team ${teamId} deleted successfully.`);
      fetchAllData();
    } else {
      const err = await res.json();
      alert('Failed to delete team: ' + (err.error || 'Server error'));
    }
  } catch (e) {
    alert('Network error while deleting team.');
  }
}

function openAddTeamModal() {
  const modal = document.getElementById('addTeamModal');
  const existingIds = allCredentials.map((t) => Number(t.id)).filter(Number.isFinite);
  const nextId = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1;

  document.getElementById('newTeamId').value = String(nextId);
  document.getElementById('newTeamName').value = `Team ${nextId}`;
  document.getElementById('newTeamPassword').value = `team@${nextId}`;

  modal.classList.add('show');
  document.getElementById('newTeamName').focus();
}

function closeAddTeamModal(e) {
  if (e && e.target && e.target.id !== 'addTeamModal' && !e.target.classList.contains('btn-close-modal')) {
    return;
  }
  document.getElementById('addTeamModal').classList.remove('show');
}

async function handleAddTeamSubmit(event) {
  event.preventDefault();
  const id = document.getElementById('newTeamId').value.trim();
  const name = document.getElementById('newTeamName').value.trim();
  const password = document.getElementById('newTeamPassword').value.trim();

  if (!id || !password) {
    alert('Team ID and Password are required.');
    return;
  }

  // Check if ID already exists
  const exists = allCredentials.some((t) => String(t.id) === String(id));
  if (exists) {
    alert(`Team with ID ${id} already exists. Please choose a unique ID.`);
    return;
  }

  try {
    const res = await fetch('/api/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'add',
        team: { id, name, password }
      })
    });

    if (res.ok) {
      alert(`✓ Team ${id} (${name}) created successfully!`);
      closeAddTeamModal();
      fetchAllData();
    } else {
      const err = await res.json();
      alert('Failed to create team: ' + (err.error || 'Server error'));
    }
  } catch (e) {
    alert('Network error while creating team.');
  }
}

function exportCredentialsCsv() {
  let csv = 'Team ID,Team Name,Password\n';
  allCredentials.forEach((t) => {
    csv += `"${t.id}","${t.name || 'Team ' + t.id}","${t.password || ''}"\n`;
  });

  downloadTextFile(csv, 'campus-treasure-hunt-credentials.csv', 'text/csv');
}

// ----------------------------------------------------
// 9. QUESTIONS DIRECTORY TABLE
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
// 10. PDF PROGRESS REPORT GENERATION (TIME-WISE PHOTOS)
// ----------------------------------------------------
async function imageSrcToDataUrl(src) {
  if (!src) return null;
  if (src.startsWith('data:image')) return src;

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      } catch (err) {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function generateTeamProgressPdf(targetTeamId) {
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) {
    alert('PDF library is loading. Please try again in a moment.');
    return;
  }

  const team = allCredentials.find((t) => String(t.id) === String(targetTeamId));
  const teamName = team ? team.name || `Team ${team.id}` : `Team ${targetTeamId}`;

  // Get and sort team submissions chronologically
  const teamSubs = allSubmissions
    .filter((s) => String(s.teamId) === String(targetTeamId) && s.isCorrect)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  if (teamSubs.length === 0) {
    alert(`No verified submissions found for ${teamName} yet.`);
    return;
  }

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;

  // Header Banner
  doc.setFillColor(15, 23, 42); // Dark Navy #0F172A
  doc.rect(0, 0, pageWidth, 42, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text('CAMPUS TREASURE HUNT 2.0', margin, 16);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(165, 180, 252);
  doc.text('OFFICIAL TEAM JOURNEY & TIME-WISE PHOTO REPORT', margin, 24);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(148, 163, 184);
  doc.text(`Report Generated: ${formatExactTime(new Date())}`, margin, 32);

  // Team Summary Card
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(margin, 48, contentWidth, 28, 3, 3, 'FD');

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  doc.text(teamName, margin + 6, 57);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  const totalCheckpoints = getTotalCheckpoints();
  doc.text(`Team ID: ${targetTeamId}   |   Checkpoints Cleared: ${teamSubs.length} of ${totalCheckpoints} (${Math.round((teamSubs.length / totalCheckpoints) * 100)}%)`, margin + 6, 64);

  const firstTime = teamSubs[0] ? formatExactTime(teamSubs[0].createdAt || teamSubs[0].submittedAt) : '--';
  const lastTime = teamSubs[teamSubs.length - 1] ? formatExactTime(teamSubs[teamSubs.length - 1].createdAt || teamSubs[teamSubs.length - 1].submittedAt) : '--';
  doc.text(`Hunt Started: ${firstTime}   |   Latest Checkpoint: ${lastTime}`, margin + 6, 71);

  // Chronological Checkpoints List
  let cursorY = 84;

  for (let i = 0; i < teamSubs.length; i++) {
    const s = teamSubs[i];
    const exactTime = formatExactTime(s.createdAt || s.submittedAt);
    const boxHeight = 76;

    // Check if new page is needed
    if (cursorY + boxHeight > pageHeight - 15) {
      doc.addPage();
      cursorY = 20;
    }

    // Checkpoint Card Box
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(margin, cursorY, contentWidth, boxHeight, 2, 2, 'FD');

    // Left color bar
    doc.setFillColor(99, 102, 241);
    doc.rect(margin, cursorY, 3, boxHeight, 'F');

    // Checkpoint Title
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(`Checkpoint #${s.questionId}: ${s.question ? s.question.slice(0, 70) : 'Location Clue'}`, margin + 7, cursorY + 7);

    // EXACT UPLOAD TIME (Highlight in purple/bold)
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(79, 70, 229);
    doc.text(`[UPLOAD TIME]: ${exactTime}`, margin + 7, cursorY + 14);

    // Answer & Status
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(`Team Answer: "${s.answer}"   |   Status: Verified Correct [OK]`, margin + 7, cursorY + 20);

    // Photo Proof Box
    const photoSrc = s.photoPath;
    if (photoSrc) {
      try {
        const dataUrl = await imageSrcToDataUrl(photoSrc);
        if (dataUrl) {
          doc.addImage(dataUrl, 'JPEG', margin + 7, cursorY + 24, 72, 48);
          doc.setDrawColor(203, 213, 225);
          doc.rect(margin + 7, cursorY + 24, 72, 48, 'S');

          // Photo details beside the image
          doc.setFontSize(8);
          doc.setTextColor(100, 116, 139);
          doc.text(`Original Photo Proof`, margin + 84, cursorY + 30);
          doc.text(`Timestamp: ${exactTime}`, margin + 84, cursorY + 36);
          doc.text(`Uploaded by: ${teamName}`, margin + 84, cursorY + 42);
        } else {
          doc.setFontSize(9);
          doc.setTextColor(148, 163, 184);
          doc.text('[Photo Proof Attached on Server]', margin + 7, cursorY + 35);
        }
      } catch (err) {
        doc.setFontSize(9);
        doc.setTextColor(148, 163, 184);
        doc.text('[Photo Proof Render Error]', margin + 7, cursorY + 35);
      }
    } else {
      doc.setFontSize(9);
      doc.setTextColor(148, 163, 184);
      doc.text('[No Photo Available]', margin + 7, cursorY + 35);
    }

    cursorY += boxHeight + 6;
  }

  // Footer page numbering
  const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(148, 163, 184);
    doc.text(`Campus Treasure Hunt 2.0 • ${teamName} Progress Dossier • Page ${p} of ${pageCount}`, pageWidth / 2, pageHeight - 7, { align: 'center' });
  }

  doc.save(`TreasureHunt_Team_${targetTeamId}_Progress_Report.pdf`);
}

async function generateTeamProgressPdfFromExportTab() {
  const select = document.getElementById('pdfTeamSelect');
  const prog = document.getElementById('pdfExportProgress');
  const selected = select.value;

  prog.style.display = 'block';
  prog.textContent = 'Generating PDF report with time-wise photo proofs...';

  try {
    if (selected === 'all') {
      // Generate for all teams that have submissions
      const activeTeamIds = [...new Set(allSubmissions.filter((s) => s.isCorrect).map((s) => String(s.teamId)))];
      if (activeTeamIds.length === 0) {
        alert('No team submissions found yet to generate report.');
        prog.style.display = 'none';
        return;
      }
      for (let i = 0; i < activeTeamIds.length; i++) {
        prog.textContent = `Generating PDF for Team ${activeTeamIds[i]} (${i + 1} of ${activeTeamIds.length})...`;
        await generateTeamProgressPdf(activeTeamIds[i]);
      }
      prog.textContent = `✓ Successfully generated PDF reports for ${activeTeamIds.length} teams!`;
    } else {
      await generateTeamProgressPdf(selected);
      prog.textContent = `✓ PDF Progress Report downloaded for Team ${selected}!`;
    }
  } catch (err) {
    console.error('PDF export error:', err);
    alert('Failed to generate PDF: ' + err.message);
    prog.textContent = '❌ PDF generation error.';
  }
}

function downloadCurrentTeamPdfFromModal() {
  if (activeModalTeamId) {
    generateTeamProgressPdf(activeModalTeamId);
  }
}

// ----------------------------------------------------
// 11. EXPORT: ZIP DOWNLOAD & CSV EXPORT
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
        const base64Data = photoSrc.split(',')[1];
        zip.folder(folderName).file(fileName, base64Data, { base64: true });
      } else {
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

  let csv = 'ID,Team ID,Team Name,Checkpoint No,Question,Answer,Correct,Exact Upload Timestamp,Relative Time,Has Photo\n';

  allSubmissions.forEach((s) => {
    const exact = formatExactTime(s.createdAt || s.submittedAt);
    csv += [
      s.id,
      `"${s.teamId}"`,
      `"${(s.teamName || '').replace(/"/g, '""')}"`,
      s.questionId,
      `"${(s.question || '').replace(/"/g, '""')}"`,
      `"${(s.answer || '').replace(/"/g, '""')}"`,
      s.isCorrect ? 'YES' : 'NO',
      `"${exact}"`,
      `"${formatRelativeTime(s.createdAt)}"`,
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
// 12. RESET SUBMISSIONS
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
// 13. LIGHTBOX PHOTO MODAL (WITH EXACT TIMESTAMPS)
// ----------------------------------------------------
function openPhotoModal(encodedUrl, teamName, clueTitle, answer, exactTimestamp, teamId) {
  const url = decodeURIComponent(encodedUrl);
  const modal = document.getElementById('photoModal');
  const img = document.getElementById('modalImg');
  const title = document.getElementById('modalTitle');
  const meta = document.getElementById('modalMeta');
  const dlBtn = document.getElementById('modalDownloadBtn');

  activeModalTeamId = teamId || null;

  img.src = url;
  title.textContent = `${teamName} — ${clueTitle}`;
  meta.innerHTML = `
    <div><strong>Answer:</strong> "${answer}"</div>
    <div style="color: #a5b4fc; font-weight: 700; margin-top: 3px;">📅 Exact Upload Time: ${exactTimestamp}</div>
  `;
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
// 14. UTILITIES
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
