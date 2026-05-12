# SWIMAX deployment (Vercel + Railway + Atlas)

This app is split into a **Vite/React frontend** and an **Express API**. Do not merge them into a single Express-hosted SPA.

## Architecture

| Layer | Platform | Notes |
|-------|-----------|--------|
| Frontend | **Vercel** | Static build from `frontend/` |
| API | **Railway** | Node service from `backend/` |
| Database | **MongoDB Atlas** | Set `MONGODB_URI` on Railway |
| Images | **Cloudinary** (optional) | Configure env vars on Railway if using uploads |

## Backend (Railway)

1. Create a **new Railway service** from this repo (or connect GitHub).
2. Set **Root Directory** to `backend`.
3. **Build command**: leave empty (no build step) or `npm install` only.
4. **Start command**: `npm start` (runs `node src/server.js`).
5. **Variables** — copy from `backend/.env.example` and fill real values:

   - `MONGODB_URI` — Atlas connection string (network access must allow Railway egress IPs or `0.0.0.0/0` for trials).
   - `JWT_SECRET` — long random string.
   - `ALLOWED_ORIGINS` — your Vercel production URL (and preview URLs if needed), comma-separated, e.g. `https://your-app.vercel.app`.
   - `CLOUDINARY_*` — if you use Cloudinary.
   - `SEED_DEFAULT_ADMIN` — leave **unset** or `false` in production. Set `true` only once if you need the seed user, then change password and turn off.

6. Railway injects **`PORT`** — already supported.

7. After deploy, copy the **public HTTPS URL** of the service (e.g. `https://xxx.up.railway.app`) for the frontend env.

## Frontend (Vercel)

1. Import the repo in Vercel.
2. Set **Root Directory** to `frontend`.
3. **Framework preset**: Vite (or “Other” with `npm run build` / output `dist`).
4. **Environment variable** (Production & Preview as needed):

   - `VITE_API_BASE_URL` = your Railway API origin only, e.g. `https://xxx.up.railway.app`  
     (no `/api` suffix; the app calls paths like `/api/sessions`.)

5. **React Router**: `frontend/vercel.json` rewrites unknown paths to `index.html` so refresh and deep links work.

## Local development

1. **Backend**: from `backend/`, copy `.env.example` to `.env`, set `MONGODB_URI`, `JWT_SECRET`, run `npm install` and `npm run dev` (or `npm start`). Default API port in code is **8080** unless `PORT` is set.

2. **Frontend**: from `frontend/`, create `.env` with **either**:
   - Leave `VITE_API_BASE_URL` empty and set `VITE_DEV_API_PROXY_TARGET` if your API is not on `http://127.0.0.1:8080`, **or**
   - Set `VITE_API_BASE_URL=http://127.0.0.1:8080` to talk to the API directly (no proxy).

3. Vite proxies **`/api`** and **`/uploads`** to `VITE_DEV_API_PROXY_TARGET` when using dev server with empty `VITE_API_BASE_URL`.

## CORS checklist

If the browser shows CORS errors:

- Add your exact Vercel URL(s) to **`ALLOWED_ORIGINS`** on Railway.
- `*.vercel.app` is allowed automatically for Vercel preview/production subdomains.
- Custom domains must be listed in **`ALLOWED_ORIGINS`**.

## Verification (after deploy)

1. Open Vercel URL → login.
2. Coaches / trainees / sessions CRUD.
3. Attendance and payroll pages load.
4. Images: Cloudinary URLs should load anywhere; legacy `/uploads/...` paths require the API host in `VITE_API_BASE_URL`.
