// 18 clue questions. LC-1 Top Floor is fixed as the last clue for all teams.
const clueQuestions = [
    { id: 1, question: "I am not a classroom, yet all must pass. Morning rush and evening mass. Guarded strong where journeys start, Through me begins your campus part.", answer: "Main Gate" },
    { id: 2, question: "I never bat, I never bowl, Yet I watch each wicket and every goal. Steps climb high in steady lines, Where cheers grow loud at thrilling times.", answer: "Cricket Ground" },
    { id: 3, question: "Find the place where business meets law. A tall red sign will guide what you saw. Not a classroom, yet it shows the way, To minds at work both night and day.", answer: "LC1 Sign Board" },
    { id: 4, question: "When your wallet is empty and hopes are high, Follow the path of fancy stones. To the machine that eats cards and spits notes.", answer: "ATM" },
    { id: 5, question: "Food and water in name I claim, Seek the tent that shares the same. Beneath the colors overhead, Your next direction waits to be read.", answer: "Dana Paani" },
    { id: 6, question: "Saffron, white, and green held high, Watching quietly as football players pass by. Not part of the game, yet central to all. Find the colors that never fall.", answer: "Football Ground" },
    { id: 7, question: "Long ears, quick hops, and cotton tail white, I munch on greens from morning till night. I am not free to roam, I stay in a cage. Find me near food but off the stage.", answer: "Rabbit Cage" },
    { id: 8, question: "Heading for fun or heading to eat, You will pass a red cube on this street. Big, bold, and hard to ignore. Your next clue waits at its door.", answer: "Red Room" },
    { id: 9, question: "I stand where many paths are curved, Between the halls where food is served. I throw up water, cool and bright, Shining gently in plain sight.", answer: "Mess Fountain" },
    { id: 10, question: "When the sun is hot and games are tight, I bring cold smiles in every bite. Butter, milk and creamy delight, Standing close to the tennis sight.", answer: "Amul" },
    { id: 11, question: "Where dosas crisp and chutneys flow, Long red seats sit row by row. Hungry crowds gather day and night. Find the place of southern delight.", answer: "Anantha Aahara" },
    { id: 12, question: "No single purpose, yet always full, No doors to close, no crowds to pull. Where sport meets snack and talks run free. Find the campus open sea.", answer: "Alfresco" },
    { id: 13, question: "No exams are written here, Yet every student must appear. Fees, IDs, or documents in stock, Find the college control block.", answer: "Admin Block" },
    { id: 14, question: "After knowledge travels far and wide, Its keepers here choose to reside. No timetable rules this place. Find the homes of guiding grace.", answer: "Faculty Quarters" },
    { id: 15, question: "Silence speaks louder than sound, Knowledge is waiting to be found. Before the books line every side, Find the door where minds open wide.", answer: "Library" },
    { id: 16, question: "Where fun and fests come alive, And student talents always thrive. Near the office that guides your way, A locker quietly waits today.", answer: "Activity Centre" },
    { id: 17, question: "Where tools speak louder than words, And practice matters more than awards. Not theory alone, but hands that work. Find the place where skills do not shirk.", answer: "Workshop" },
    { id: 18, question: "Where power is studied and justice is taught, Rise above both to the place they forgot. No deals are signed, no verdicts spoken. Just sky above and silence unbroken.", answer: "LC1 Top Floor" }
];

const fixedGameCheckpoints = [
    { id: 101, question: "Reach this place: Departmental Store", answer: "Debi", isGame: true, gameNumber: 1 },
    { id: 102, question: "Reach this place: Temple", answer: "Nripendra", isGame: true, gameNumber: 2 },
    { id: 103, question: "Reach this place: LT201", answer: "Akash", isGame: true, gameNumber: 3 },
    { id: 104, question: "Reach this place: Football Ground Flag Hosting Area", answer: "Joy", isGame: true, gameNumber: 4 }
];

const FIXED_LAST_CLUE_ID = 18;
const PROGRESS_VERSION = '2026-02-20-v2';
const SHUFFLE_SALT = 872341;
let orderedQuestions = [];

let currentQuestionIndex = 0;
let formData = [];
let teamId = '1';
let teamName = 'Team';

function getProgressStorageKey() {
    return `huntProgress:${teamId}`;
}

function getOrderIds() {
    return orderedQuestions.map((item) => Number(item.id));
}

function cleanupInvalidProgress(storage) {
    if (!storage) return;

    try {
        for (let i = storage.length - 1; i >= 0; i--) {
            const key = storage.key(i);
            if (!key || !key.startsWith('huntProgress:')) continue;
            const raw = storage.getItem(key);
            if (!raw) {
                storage.removeItem(key);
                continue;
            }

            if (raw.length > 5000) {
                storage.removeItem(key);
                continue;
            }

            try {
                const parsed = JSON.parse(raw);
                if (!parsed || parsed.version !== PROGRESS_VERSION) {
                    storage.removeItem(key);
                }
            } catch {
                storage.removeItem(key);
            }
        }
    } catch (error) {
        console.warn('Progress cleanup skipped:', error);
    }
}

function saveProgress() {
    const payload = {
        version: PROGRESS_VERSION,
        currentQuestionIndex,
        orderIds: getOrderIds()
    };
    try {
        localStorage.setItem(getProgressStorageKey(), JSON.stringify(payload));
        // Remove any session copy to keep single source of truth.
        sessionStorage.removeItem(getProgressStorageKey());
    } catch (error) {
        console.warn('Progress save skipped due to storage limits:', error);
    }
}

function restoreProgress() {
    const key = getProgressStorageKey();
    const saved = localStorage.getItem(key) || sessionStorage.getItem(key);
    if (!saved) return;

    try {
        const parsed = JSON.parse(saved);
        if (parsed.version !== PROGRESS_VERSION) {
            clearProgress();
            return;
        }
        if (Array.isArray(parsed.orderIds) && parsed.orderIds.length === orderedQuestions.length) {
            const byId = {};
            orderedQuestions.forEach((item) => {
                byId[Number(item.id)] = item;
            });

            const restored = parsed.orderIds
                .map((id, index) => {
                    const found = byId[Number(id)];
                    if (!found) return null;
                    return { ...found, sequenceNo: index + 1 };
                })
                .filter(Boolean);

            if (restored.length === orderedQuestions.length) {
                orderedQuestions = restored;
            }
        }
        const savedIndex = Number(parsed.currentQuestionIndex);
        const maxIndex = orderedQuestions.length;
        if (Number.isFinite(savedIndex) && savedIndex >= 0 && savedIndex <= maxIndex) {
            currentQuestionIndex = savedIndex;
        }
    } catch (error) {
        console.error('Failed to restore saved progress:', error);
    }
}

function clearProgress() {
    const key = getProgressStorageKey();
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
}

function createSeededRandom(seed) {
    let value = seed >>> 0;
    return function seededRandom() {
        value ^= value << 13;
        value ^= value >>> 17;
        value ^= value << 5;
        return ((value >>> 0) % 1000000) / 1000000;
    };
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    try {
        // Get team from sessionStorage
        const storedTeam = sessionStorage.getItem('teamId');
        const storedTeamName = sessionStorage.getItem('teamName');
        
        if (storedTeam) {
            teamId = String(storedTeam);
            if (storedTeamName) {
                teamName = storedTeamName;
                document.getElementById('teamName').textContent = teamName;
            }
            document.getElementById('teamNumber').textContent = teamId;
        }
        
        // Build question order for this team
        shuffleQuestions();
        cleanupInvalidProgress(localStorage);
        cleanupInvalidProgress(sessionStorage);
        restoreProgress();
        
        // Setup listeners
        document.getElementById('cameraBtn').addEventListener('click', openCamera);
        document.getElementById('photoUpload').addEventListener('change', handlePhotoUpload);
        document.getElementById('validateBtn').addEventListener('click', validateAnswer);
        document.getElementById('resetBtn').addEventListener('click', resetForm);
        document.getElementById('answerBox').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') validateAnswer();
        });
        
        if (currentQuestionIndex >= orderedQuestions.length) {
            showSummary();
        } else {
            loadQuestion();
        }
        console.log('✓ Initialized for Team ' + teamId);
    } catch (error) {
        console.error('ERROR:', error);
        alert('Error loading page');
    }
});

// Build question flow:
// - clue order is shuffled per team (except last clue fixed)
// - fixed game checkpoints are inserted after every 4 clues for all teams
function shuffleQuestions() {
    const lastClue = clueQuestions.find((q) => q.id === FIXED_LAST_CLUE_ID);
    const shufflePool = clueQuestions.filter((q) => q.id !== FIXED_LAST_CLUE_ID);
    const teamSeed = Number.parseInt(String(teamId), 10) || 0;
    const seededRandom = createSeededRandom((teamSeed * 1103515245 + SHUFFLE_SALT) >>> 0);

    for (let i = shufflePool.length - 1; i > 0; i--) {
        const j = Math.floor(seededRandom() * (i + 1));
        [shufflePool[i], shufflePool[j]] = [shufflePool[j], shufflePool[i]];
    }

    const flow = [];
    let gameIndex = 0;

    for (let i = 0; i < shufflePool.length; i++) {
        flow.push(shufflePool[i]);
        if ((i + 1) % 4 === 0 && gameIndex < fixedGameCheckpoints.length) {
            flow.push(fixedGameCheckpoints[gameIndex]);
            gameIndex += 1;
        }
    }

    if (lastClue) {
        flow.push(lastClue);
    }

    orderedQuestions = flow.map((item, index) => ({
        ...item,
        sequenceNo: index + 1
    }));
}

// Load question
function loadQuestion() {
    const q = orderedQuestions[currentQuestionIndex];
    document.getElementById('questionTitle').textContent = q.isGame
        ? `Game ${q.gameNumber}`
        : 'Question ' + q.sequenceNo;
    document.getElementById('questionText').textContent = q.question;
    
    // Clear answer box
    const answerBox = document.getElementById('answerBox');
    answerBox.value = '';
    
    // Clear photo upload
    const photoUpload = document.getElementById('photoUpload');
    photoUpload.value = null;
    photoUpload.type = 'file';
    
    // Clear preview
    document.getElementById('photoPreview').innerHTML = '';
    document.getElementById('validationMessage').innerHTML = '';
    
    const progress = ((currentQuestionIndex + 1) / orderedQuestions.length) * 100;
    document.getElementById('progressFill').style.width = progress + '%';
}

// Open camera
function openCamera() {
    document.getElementById('photoUpload').click();
}

// Handle photo
function handlePhotoUpload() {
    const file = document.getElementById('photoUpload').files[0];
    const preview = document.getElementById('photoPreview');
    
    if (!file) {
        preview.innerHTML = '';
        return;
    }
    
    const reader = new FileReader();
    reader.onload = (e) => {
        preview.innerHTML = `
            <div style="text-align: center; padding: 10px; background: #f0f2ff; border-radius: 8px;">
                <img src="${e.target.result}" alt="Photo" style="max-width: 100%; height: 150px; object-fit: cover; border-radius: 8px; margin-bottom: 10px;">
                <p style="color: #667eea; font-size: 12px; margin: 0;">✓ Photo captured</p>
            </div>
        `;
    };
    reader.readAsDataURL(file);
}

function normalizeForStrictMatch(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

async function saveResponseToServer(currentQuestion, answer, photo) {
    const payload = new FormData();
    payload.append('teamId', teamId);
    payload.append('teamName', teamName);
    payload.append('questionId', String(currentQuestion.sequenceNo));
    payload.append('question', currentQuestion.question);
    payload.append('answer', answer);
    payload.append('isCorrect', 'true');
    payload.append('timestamp', new Date().toLocaleTimeString());
    payload.append('photo', photo, photo.name || 'camera-photo.jpg');

    const response = await fetch('/api/submissions', {
        method: 'POST',
        body: payload
    });

    if (!response.ok) {
        let serverError = 'Server failed to save response';
        try {
            const body = await response.json();
            if (body && body.error) serverError = body.error;
        } catch {
            // Ignore parse failure and keep generic error.
        }
        throw new Error(serverError);
    }

    const result = await response.json();
    return result.record;
}

// Validate
async function validateAnswer() {
    const answer = document.getElementById('answerBox').value.trim();
    const photo = document.getElementById('photoUpload').files[0];
    const msg = document.getElementById('validationMessage');
    const validateBtn = document.getElementById('validateBtn');
    
    if (!answer) {
        msg.innerHTML = '❌ Enter place name!';
        msg.className = 'validation-message show error';
        return;
    }
    
    if (!photo) {
        msg.innerHTML = '❌ Take photo first!';
        msg.className = 'validation-message show error';
        return;
    }
    
    const currentQuestion = orderedQuestions[currentQuestionIndex];
    const correct = currentQuestion.answer;
    const isCorrect = normalizeForStrictMatch(answer) === normalizeForStrictMatch(correct);
    
    if (isCorrect) {
        try {
            validateBtn.disabled = true;
            validateBtn.textContent = 'Saving...';
            msg.innerHTML = '✓ Correct! Saving response...';
            msg.className = 'validation-message show success';

            const savedRecord = await saveResponseToServer(currentQuestion, answer, photo);

            formData.push({
                questionId: currentQuestion.sequenceNo,
                question: currentQuestion.question,
                answer: answer,
                isGame: Boolean(currentQuestion.isGame),
                isCorrect: true,
                photo: photo.name,
                timestamp: new Date().toLocaleTimeString()
            });

            msg.innerHTML = '✓ Correct! Saved successfully.';

            currentQuestionIndex++;
            saveProgress();

            setTimeout(() => {
                if (currentQuestionIndex < orderedQuestions.length) {
                    loadQuestion();
                } else {
                    showSummary();
                }
            }, 1200);
        } catch (error) {
            const details = error && error.message ? ` (${error.message})` : '';
            msg.innerHTML = `❌ Correct answer, but save failed. Please retry.${details}`;
            msg.className = 'validation-message show error';
        } finally {
            validateBtn.disabled = false;
            validateBtn.textContent = '✓ Check Answer';
        }
    } else {
        msg.innerHTML = '✗ Try again!';
        msg.className = 'validation-message show error';
    }
}

// Summary
function showSummary() {
    document.getElementById('questionForm').style.display = 'none';
    document.querySelector('.question-section').style.display = 'none';
    document.getElementById('summarySection').style.display = 'block';
    
    const correct = formData.filter(x => x.isCorrect).length;
    const score = Math.round((correct / formData.length) * 100);
    
    let html = `<div style="padding: 15px; background: #f0f2ff; border-radius: 8px; margin-bottom: 20px;">
        <p><strong>Total:</strong> ${formData.length}</p>
        <p><strong>Correct:</strong> ${correct}</p>
        <p><strong>Score:</strong> ${score}%</p>
    </div>`;
    
    formData.forEach(item => {
        html += `<div class="summary-item">
            <strong>${item.isGame ? 'Game' : 'Q'}${item.questionId}:</strong> ${item.question}<br>
            Answer: ${item.answer}<br>
            ${item.isCorrect ? '✓ Correct' : '✗ Wrong'} | 📷 ${item.photo}
        </div>`;
    });
    
    document.getElementById('summaryContent').innerHTML = html;
}

// Reset
function resetForm() {
    clearProgress();
    currentQuestionIndex = 0;
    formData = [];
    shuffleQuestions();
    
    document.getElementById('questionForm').style.display = 'block';
    document.querySelector('.question-section').style.display = 'block';
    document.getElementById('summarySection').style.display = 'none';
    
    loadQuestion();
}
