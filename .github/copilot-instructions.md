<!-- Copilot instructions for the QR Asset Management project -->
# Copilot / AI agent quick guide

This repository is a small Node.js + Express app that serves a static front-end from `public/` and stores records in PostgreSQL. Use this file to quickly understand conventions, run the app, and make safe changes.

1) Big picture
- Server: `server.js` — Express app that exposes JSON APIs and serves `public/` static files.
- Frontend: files under `public/` (no build step). Client-side code calls the server APIs with `credentials: "include"` and expects cookie-based sessions.
- Database: PostgreSQL via `pg`. The server creates required tables on startup (see `createTables()` and `createUsersTable()` in `server.js`).

2) Important routes (examples)
- POST `/api/login` — JSON { username, password } — sets session cookie.
- GET `/me` — returns `{ loggedIn, username, role }` (used by `public/index.html`).
- POST `/api/assets/:category` — add asset. Body example: `{ name, serial_number, employee_name }`. Client includes cookies.
- GET `/api/assets/:category` — list assets for a category.
- GET `/api/history` — returns merged rows from all `validTables` (see `validTables` array in `server.js`).
- GET `/api/history/pdf` — downloads a PDF report (server-side PDFKit generation).
- POST `/forgot-password` and POST `/reset-password` — password reset flow (tokens saved to DB table `password_resets`).

3) Project-specific conventions and gotchas
- Category whitelist: `validTables` (array in `server.js`) defines allowable `:category` values. Always consult it before adding or removing categories.
- Session auth: uses `express-session` with cookie-based sessions. Client requests include `credentials: "include"`. Changes to session behavior or domain require adjusting both server session options and client fetch calls.
- DB auto-creation: tables and a few example users are created on server start (no migrations). Removing or reordering `createTables()` may cause data loss if you drop/recreate tables — be careful.
- CORS: configured in `server.js` with origin `http://localhost:5173`. Update this when hosting or using a different frontend origin.
- Start script missing: `package.json` has no `start` script. Use `node server.js`, or add a script `"start": "node server.js"` if committing changes.
- Env vars: the server expects several env vars — see `.env` in repo root (present). The key variables are below.

4) Environment variables (discoverable in `server.js`)
- `SESSION_SECRET` — required for `express-session`.
- `DB_USER`, `DB_HOST`, `DB_NAME`, `DB_PASSWORD`, `DB_PORT` — PostgreSQL connection.
- `EMAIL_USER`, `EMAIL_PASS` — used by `nodemailer` (currently configured with `service: "gmail"`).
- `RESET_TOKEN_EXPIRY` — optional numeric ms expiry for reset tokens.

5) Local development steps (PowerShell examples)
 - Install dependencies:
```powershell
npm install
```
 - Ensure a PostgreSQL database is available and `.env` contains correct credentials. Example `.env` entries:
```text
DB_USER=postgres
DB_HOST=localhost
DB_NAME=asset_db
DB_PASSWORD=secret
DB_PORT=5432
SESSION_SECRET=some-secret
EMAIL_USER=you@gmail.com
EMAIL_PASS=app-password
```
 - Start server:
```powershell
node .\server.js
```
 - Open `http://localhost:3000/` and login using the seeded users (`admin`, `user1`, `user2`; passwords seeded in `server.js`).

6) Testing & debugging notes
- The app has no test harness. Use the browser and API tools (Postman) for validation.
- Common quick checks:
  - If DB connection fails, verify `.env` and PostgreSQL is reachable.
  - If CORS issues occur, update origin in `server.js` or set `origin: true` temporarily during debugging.
  - Cookie/session problems: verify the browser is accepting cookies and `credentials: 'include'` is used on client fetches (the front-end already does this).

7) Hosting guidance (what to change before deployment)
- Use `process.env.PORT` instead of hard-coded `3000` (edit `server.js`):
  - change `const PORT = 3000;` -> `const PORT = process.env.PORT || 3000;`.
- In production, set `cookie.secure = true` and serve over HTTPS.
- Update CORS origin to the deployed frontend origin (or use a tighter allowlist).
- Replace Gmail `nodemailer` credentials with a managed SMTP or transactional email provider for production.
- Add a `start` script to `package.json` and consider using a process manager (PM2) or the host's runtime (Heroku, Railway, Fly, Azure Web Apps, etc.).

8) Code patterns & examples to reference
- Asset categories & allowed fields: see `validTables` and `categoryFields` in `public/index.html`.
- DB table creation and triggers: check `createTables()` in `server.js` (creates `update_updated_at_column()` trigger per table).
- PDF generation: `PDFDocument` usage in `/api/history/pdf` for large table exports.
- Password reset flow: token generated with `crypto.randomBytes` and stored in `password_resets` table; reset link targets `/reset-password.html`.

9) When editing
- Keep API routes and client expectations in sync: front-end assumes cookie sessions and specific JSON shapes (see `public/*.html` scripts).
- Avoid renaming categories without updating `public/index.html` select options and `validTables` array.

If any section is unclear or you'd like me to also: add a `start` script, switch `PORT` to read from env, or create a small `deploy.md` with platform-specific steps, tell me which option you prefer and which hosting provider you plan to use.

---
Generated by an AI assistant after inspecting `server.js`, `package.json`, and `public/`.
