# 🧭 Campus Treasure Hunt 2.0

A high-performance, real-time web platform built for high-energy campus treasure hunts. Designed specifically for **Vercel Serverless deployment**, mobile smartphones, offline resilience, and high-capacity photo proof tracking.

---

## ⚡ What's New in 2.0 (Upgraded from Last Year)

| Feature | Last Year (v1 on Render) | Treasure Hunt 2.0 (Vercel-Ready) |
|---|---|---|
| **Hosting Platform** | Render (cold start delays, sleeping instances) | **Vercel Serverless** (0 cold starts, instant edge response) |
| **Live Tracking** | Manual page refreshes | **Instant Live Activity Feed & Polling** with audio chimes & toast alerts |
| **Photo Capacity** | Heavy raw photos causing payload limits | **Client-side Canvas Compression** (5MB $\rightarrow$ ~130KB), effortlessly stores 1,000+ photos (45 teams $\times$ 25 checkpoints) |
| **Photo Downloads** | Single download only | **1-Click Download All Photos (ZIP)** organized by team + Individual Lightbox downloads |
| **Team Credentials** | Static JSON file | **Live Admin Credential Manager**: change any team's ID, Name, or Password in real-time |
| **Progress Persistence** | Only in browser localStorage (lost on device switch) | **Dual Cloud + Local Persistence**: automatically resumes exactly where the team left off after reconnecting or re-logging |
| **Team Capacity** | 30 teams | **Pre-configured for 45+ teams** (expandable dynamically) |
| **Questions & Clues** | Hardcoded in JS | **Modular `questions.json`** with 25 checkpoints & smart alias matching |
| **UI / UX Design** | Basic CSS | **Modern Cyberpunk / Obsidian Glassmorphism**, mobile-first responsive layout, sound effects & confetti celebrations |

---

## 📱 Mobile-First Participant Features

- **Instant Camera Shutter**: Direct integration with mobile cameras (`capture="environment"`).
- **On-Device Canvas Compression**: Automatically compresses photos in milliseconds before upload, eliminating upload lag on spotty campus cellular/WiFi networks.
- **Offline Resilience**: If a team loses internet connection while running across campus, their current riddle and photo draft are preserved locally. Once reconnected (or after logging back in), they continue seamlessly without starting over.
- **Smart Alias Verification**: Accepts lowercase, alternative spellings, and whitespace variations so teams aren't unfairly penalized for minor typos.
- **Interactive Hints**: Expandable hint drawer for teams that need a nudge.
- **Celebration Effects**: Sound chimes and confetti bursts upon clearing checkpoints and completing the hunt.

---

## ⚡ Organizer Command Center (`admin.html`)

- **📡 Live Tracking Feed**: Real-time stream of team submissions with upload timestamps, team badges, answers, and photo previews with sound alert toggle.
- **🏆 Live Leaderboard**: Dynamic ranking calculated by most checkpoints cleared, broken down by earliest completion time.
- **📊 45-Team Progress Matrix**: Interactive $45 \times 25$ grid showing the live status of every team across all 25 checkpoints with 1-click photo lightbox zoom.
- **👥 Credentials Manager**: Inline editor to change Team IDs, Names, and Passwords on the fly. Includes an "Add Team" button and CSV export.
- **❓ Checkpoints Directory**: Full table of all 25 riddles, target answers, and physical mini-game checkpoints.
- **📦 1-Click ZIP Exporter**: Bundles all high-res photos into a structured ZIP archive (`Team_01/Checkpoint_01.jpg`, etc.) directly inside the admin's browser.
- **📊 Submissions CSV Export**: Detailed spreadsheet download with submission timestamps and answers.

---

## 🚀 Running Locally

```bash
# 1. Install dependencies
npm install

# 2. Start development server
npm start
# or: npm run dev
```

Open your browser:
- **Participant Login**: [http://localhost:3000/login.html](http://localhost:3000/login.html)
- **Organizer Dashboard**: [http://localhost:3000/admin.html](http://localhost:3000/admin.html)

*(When running locally without environment variables, the system stores files in `./data` and `./uploads` automatically).*

---

## ☁️ Deploying to Vercel (Step-by-Step)

### Step 1: Create a New GitHub Repository
> **Important:** As requested, do not modify or push to the old GitHub repository. Create a **brand new repository** on GitHub (e.g. `treasure-hunt-2.0`).

```bash
cd "/Users/luckybiswal/Documents/Treasure Hunt 2.0"

# Initialize git if not already initialized
git init
git add .
git commit -m "Treasure Hunt 2.0 - Vercel-ready release"

# Link to your new repository and push
git remote add origin https://github.com/luckybiswal98210-eng/<YOUR_NEW_REPO_NAME>.git
git branch -M main
git push -u origin main
```

### Step 2: Import into Vercel
1. Go to [vercel.com](https://vercel.com) and log in.
2. Click **"Add New..."** $\rightarrow$ **"Project"**.
3. Select your new GitHub repository.
4. Leave the Framework Preset as **Other** (Vercel automatically detects `vercel.json` and `/api`).

### Step 3: Add MongoDB Atlas Database (Free Tier)
Because Vercel Serverless Functions have ephemeral local storage, submissions and photos across 45 teams are stored in MongoDB Atlas:
1. Create a free M0 cluster at [mongodb.com/atlas](https://www.mongodb.com/atlas) (512MB free storage, plenty for ~1,000 compressed photos).
2. Under **Project Settings** $\rightarrow$ **Environment Variables** in Vercel, add:
   - `MONGODB_URI`: `mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`
   - `MONGODB_DB_NAME`: `campus_hunt`
   - `ADMIN_RESET_TOKEN`: `huntadmin2026` (or your chosen admin secret)
3. Click **Deploy**!

Your live site is instantly accessible worldwide with custom domain support, HTTPS, and zero maintenance!

---

## ❓ Updating Questions & Checkpoints

When you are ready with the final list of questions:
1. Open [`questions.json`](file:///Users/luckybiswal/Documents/Treasure%20Hunt%202.0/questions.json).
2. Update the `questions` array (title, question, answer, aliases, hint).
3. The platform automatically updates for all teams!

---

## 🔒 Default Team Credentials

Pre-loaded with 45 teams:
- **Teams 1–28**: Retain last year's passwords (e.g. Team 1: `Dhanush.M`, Team 2: `Pavitra patil`, etc.).
- **Teams 29–45**: Pre-assigned passwords `team@29`, `team@30`, ... `team@45`.
- **Customizing**: Edit any team ID or password at any time via the **Manage Team Credentials** tab in `admin.html`!

---

## 🗄️ Project File Structure

```text
├── admin.html               # Organizer Control Center UI
├── admin.js                 # Real-time polling, leaderboard, ZIP exporter
├── admin.css                # Admin dark theme & visual matrix styles
├── api/
│   └── index.js             # Vercel Serverless API entrypoint
├── credentials.json         # 45-Team credentials source
├── index.html               # Mobile-first hunt interface for participants
├── lib/
│   ├── api-handler.js       # Framework-agnostic API router & validators
│   └── db.js                # Unified MongoDB Atlas & local storage layer
├── login.html               # Team authentication portal with auto-resume
├── package.json             # Node dependencies and scripts
├── questions.json           # Modular 25-checkpoint configuration
├── script.js                # Game engine: photo compression, offline sync
├── styles.css               # Obsidian Glassmorphic responsive design system
├── team-responses.html      # Individual team photo journal & inspector
├── vendor/
│   ├── confetti.min.js      # On-device confetti celebrations
│   └── jszip.min.js         # Client-side 1-click photo ZIP generator
├── vercel.json              # Vercel serverless deployment config
└── archive/
    └── v1-backup/           # Untouched backup of original v1 codebase
```
