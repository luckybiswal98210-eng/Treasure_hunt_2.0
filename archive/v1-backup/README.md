# Campus Treasure Hunt Platform

A production-ready web platform for running campus-wide treasure hunt events with team authentication, clue progression, photo proof submission, and centralized response tracking.

[![Open User Portal](https://img.shields.io/badge/Open-User%20Portal-4F46E5?style=for-the-badge)](https://campus-hunt-form.onrender.com)

## Overview

This project provides:

- Team login with per-team credentials
- Guided clue flow with validation
- Photo proof upload for every solved clue
- Admin controls for credentials and response management
- Team-wise response explorer and exports

## Live Access

- User portal (public): `https://campus-hunt-form.onrender.com`

## Core Modules

- `login.html`: team authentication entry page
- `index.html` + `script.js`: hunt runtime (questions, answer validation, photo upload, progress)
- `admin.html`: admin operations and credential tooling
- `responses.html`: all-team response summary
- `team-responses.html`: per-team detailed response view
- `server.js`: API server, file handling, MongoDB integration
- `credentials.json`: team credential source

## Runtime & Deployment

- Runtime: Node.js
- Hosting: Render web service
- Data layer: MongoDB (`campus_hunt.submissions`)

### Local run

```bash
npm install
npm start
```

Service starts on `http://localhost:3000` (or `PORT` from environment).

## Environment Variables

- `MONGODB_URI`
- `MONGODB_DB_NAME` (default: `campus_hunt`)
- `MONGODB_COLLECTION` (default: `submissions`)
- `ADMIN_RESET_TOKEN` (optional, recommended for secure reset operations)

## Security Notes

- Do not commit raw secrets (DB URIs, admin tokens, provider keys).
- Keep admin/reset secrets only in Render environment variables.
- Rotate credentials after major events.

## Private Operations Links (Encrypted)

The following are encrypted with AES-256-CBC + PBKDF2.  
Only authorized operators with the passphrase should decrypt.

```text
admin_portal_enc:
U2FsdGVkX18R1zx7G/P5Lzwo71P1N0/lXGHxTkQBTC9+zss6+6+zuRoG2DXAS9g8
WUd1ZeeHg0ynto0xQqGMsghOuh4jj8IvNCaQG7FzQHo=

render_deploy_enc:
U2FsdGVkX19DZf7JomPL4bEa4MPiozF08sOScMnElEUy1SCK1Zr/Wp9vorNQ1+Vl
pZMuwEEpT38oGLOVAjwhuqQAaUYmy52oKq4UoGXHtwCvIcpwbWqg0egm3yk3fMyy
oleHVFLnhdvKSp/2LRWBlQ==

mongodb_console_enc:
U2FsdGVkX1+YTS3LVxuyay9CSs02DG+dVGAzAyAN/nnm3aDY1hu6wTjH8oW2MXCp
NaOXFk0e1JwMFozdXWKEITWN9sCbw9IHVUDKi6MLt8tBe/pnr2rrzgvWV6ph2nVG
iPz1EidZanpZX8MxlDj19c2fbsj2x9mybgaZfbVnD34LYmsmDXKy6mMh7lKLlg+A
```

### Decrypt command

```bash
printf '%s' '<ENCRYPTED_TEXT>' | openssl enc -d -aes-256-cbc -a -pbkdf2 -pass pass:'<PASSPHRASE>'
```

## Repository

- GitHub: `https://github.com/luckybiswal98210-eng/TREASURE-HUNT`
