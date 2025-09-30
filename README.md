# Calls Server (Daily.co)

Mobile-friendly admin to create private Daily rooms with meeting tokens, duration, end/extend controls.
Manager-only access via `X-Manager-Pass` from the /admin page.

## Quick deploy (Railway)

1. Create a new Railway project → Deploy from GitHub (this repo).
2. Set **Variables**:
   - `DAILY_API_KEY` = your Daily API key
   - `DAILY_DOMAIN` = e.g. museflow.daily.co
   - `MANAGER_PASS` = a strong secret you will type in /admin
3. (Optional) Set `BASE_URL` to your public URL after first deploy.
4. Railway will inject `PORT` automatically — the server listens on `process.env.PORT`.

### Start locally
```bash
npm install
npm start
# open http://localhost:3000/admin
```

### API
- `POST /api/create-call` (header: `X-Manager-Pass`) → returns JSON with callId and links (model/client/managerStealth)
- `POST /api/end-call` (header: `X-Manager-Pass`) → ends and deletes the Daily room
- `POST /api/extend-call` (header: `X-Manager-Pass`, body: minutes) → extends server timer

### Security
- Keep `MANAGER_PASS` secret.
- Do **not** commit your real `.env` — use `.env.example` only.
- Links use Daily **meeting tokens** (room is private).
