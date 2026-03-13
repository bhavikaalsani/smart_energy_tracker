# Deployment Guide

## Architecture
- Frontend: Vite React app on Vercel
- Backend: FastAPI app on Render (or Railway)
- Database: SQLite for quick setup, PostgreSQL for production

## 1) Deploy Backend (Render)
1. Push this repo to GitHub.
2. In Render, create a new **Web Service** from the repo.
3. Set root directory to `backend`.
4. Configure:
   - Build command: `pip install -r requirements.txt`
   - Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
5. Add environment variables:
   - `SECRET_KEY`: strong random value
   - `ACCESS_TOKEN_EXPIRE_MINUTES`: `60`
   - `REFRESH_TOKEN_EXPIRE_MINUTES`: `10080`
   - `DATABASE_URL`: for quick setup `sqlite:///./smart_electricity.db`
   - `CORS_ALLOWED_ORIGINS`: your frontend URL, for example `https://your-frontend.vercel.app`
6. Deploy and copy backend URL, for example `https://smart-electricity-api.onrender.com`.

## 2) Deploy Frontend (Vercel)
1. Import this repo in Vercel.
2. Set root directory to `frontend`.
3. Add environment variable:
   - `VITE_API_BASE_URL`: your backend URL, for example `https://smart-electricity-api.onrender.com`
4. Deploy.

## 3) Final CORS Update
After frontend deploy, update backend env var:
- `CORS_ALLOWED_ORIGINS=https://your-frontend.vercel.app`

Redeploy backend after changing this value.

## Production Notes
- SQLite works for demos but is not ideal for production scale.
- For production, move to PostgreSQL and set `DATABASE_URL` accordingly.
