// server.js — Admin από κινητό, manager κωδικός, duration, private rooms, meeting tokens,
// end/extend, links για model/client/manager (Daily Prebuilt).
import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

const {
  DAILY_API_KEY,
  DAILY_DOMAIN = "museflow.daily.co",
  BASE_URL = "http://localhost:3000",
  PORT = 3000,
  MANAGER_PASS,
} = process.env;

if (!DAILY_API_KEY) throw new Error("Set DAILY_API_KEY in .env");
if (!DAILY_DOMAIN) throw new Error("Set DAILY_DOMAIN in .env");
if (!MANAGER_PASS) throw new Error("Set MANAGER_PASS in .env");

console.log("ENV CHECK:", {
  hasKey: !!DAILY_API_KEY,
  keyLen: DAILY_API_KEY?.length,
  domain: DAILY_DOMAIN,
  baseUrl: BASE_URL,
  port: PORT,
  hasMgrPass: !!MANAGER_PASS,
});

const app = express();
app.use(express.json());

// ---------------- Helpers (Daily REST) ----------------
async function daily(path, opts = {}) {
  const res = await fetch(`https://api.daily.co/v1${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${DAILY_API_KEY}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error("Daily API error", res.status, txt);
    throw new Error(`Daily API ${res.status}: ${txt}`);
  }
  return res.json();
}

async function createRoomPrivate() {
  const body = {
    name: `room_${crypto.randomBytes(6).toString("hex")}`,
    privacy: "private",
    properties: {
      enable_knocking: true,        // lobby
      enable_prejoin_ui: true,
      enable_screenshare: false,
      enable_chat: true,
      max_participants: 3,
      // Δεν βάζουμε exp/nbf για να αποφύγουμε conflicts. Θα κλείνουμε server-side στην ώρα.
      eject_at_room_exp: false
    }
  };
  const room = await daily("/rooms", { method: "POST", body: JSON.stringify(body) });
  return room.name;
}

async function createToken({ roomName, isOwner, userName, joinWindowMinutes = 180 }) {
  const exp = Math.floor(Date.now() / 1000) + joinWindowMinutes * 60;
  const body = {
    properties: {
      room_name: roomName,
      is_owner: !!isOwner,
      user_name: userName,
      exp
    }
  };
  const tok = await daily("/meeting-tokens", { method: "POST", body: JSON.stringify(body) });
  return tok.token;
}

async function deleteRoom(roomName) {
  try {
    await daily(`/rooms/${roomName}`, { method: "DELETE" });
  } catch (e) {
    console.warn("deleteRoom warn:", e.message);
  }
}

// ---------------- Storage in-memory ----------------
/** calls Map:
 * callId -> {
 *   roomName, endsAtMs, timer,
 *   tokens: { manager, model, client },
 *   names: { model, client }
 * }
 */
const calls = new Map();

// ---------------- Middleware ----------------
function requireManagerPass(req, res, next) {
  const pass = req.headers["x-manager-pass"];
  if (!pass || pass !== MANAGER_PASS) {
    return res.status(401).json({ error: "Unauthorized (manager pass required)" });
  }
  next();
}

// ---------------- Health ----------------
app.get("/api/ping", (_req, res) => {
  res.json({ ok: true, domain: DAILY_DOMAIN });
});

// ---------------- Create Call (private + tokens + duration) ----------------
app.post("/api/create-call", requireManagerPass, async (req, res) => {
  try {
    const {
      durationMinutes = 30,
      modelName = "Model",
      clientName = "Client"
    } = req.body || {};

    // 1) create private room
    const roomName = await createRoomPrivate();

    // 2) create tokens per role
    const managerToken = await createToken({ roomName, isOwner: true,  userName: "Manager" });
    const modelToken   = await createToken({ roomName, isOwner: false, userName: modelName });
    const clientToken  = await createToken({ roomName, isOwner: false, userName: clientName });

    // 3) schedule auto end via server timer
    const endsAtMs = Date.now() + (durationMinutes * 60 * 1000);
    const callId = crypto.randomBytes(8).toString("hex");

    // clean any existing (defensive)
    if (calls.has(callId)) {
      const old = calls.get(callId);
      if (old?.timer) clearTimeout(old.timer);
    }

    const timer = setTimeout(async () => {
      await deleteRoom(roomName).catch(()=>{});
      calls.delete(callId);
    }, Math.max(2000, endsAtMs - Date.now()));

    calls.set(callId, {
      roomName,
      endsAtMs,
      timer,
      tokens: { manager: managerToken, model: modelToken, client: clientToken },
      names: { model: modelName, client: clientName }
    });

    // 4) generate links (Daily prebuilt + ?t=token)
    const base = `https://${DAILY_DOMAIN}/${roomName}`;
    const links = {
      model: `${base}?t=${modelToken}`,
      client: `${base}?t=${clientToken}`,
      managerStealth: `${base}?t=${managerToken}` // εσύ κλείνεις mic/cam στο prejoin → αόρατος
    };

    res.json({
      callId,
      durationMinutes,
      endsAtISO: new Date(endsAtMs).toISOString(),
      links
    });
  } catch (e) {
    console.error("create-call error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ---------------- End Call Now (delete room) ----------------
app.post("/api/end-call", requireManagerPass, async (req, res) => {
  try {
    const { callId } = req.body || {};
    const entry = calls.get(callId);
    if (!entry) return res.status(404).json({ error: "Unknown callId" });

    await deleteRoom(entry.roomName);
    if (entry.timer) clearTimeout(entry.timer);
    calls.delete(callId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------- Extend Call (+minutes) ----------------
app.post("/api/extend-call", requireManagerPass, async (req, res) => {
  try {
    const { callId, minutes = 10 } = req.body || {};
    const entry = calls.get(callId);
    if (!entry) return res.status(404).json({ error: "Unknown callId" });

    entry.endsAtMs = entry.endsAtMs + (minutes * 60 * 1000);
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(async () => {
      await deleteRoom(entry.roomName).catch(()=>{});
      calls.delete(callId);
    }, Math.max(2000, entry.endsAtMs - Date.now()));

    calls.set(callId, entry);
    res.json({ ok: true, newEndsAt: entry.endsAtMs, newEndsAtISO: new Date(entry.endsAtMs).toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------- Mobile Admin Page (/admin) ----------------
app.get("/admin", (_req, res) => {
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Call Admin</title>
<style>
  body{font-family:system-ui,Segoe UI,Helvetica,Arial;margin:0;padding:16px;background:#0b0b0b;color:#fff}
  h2{margin:8px 0 16px}
  .card{background:#111;padding:12px;border-radius:10px;margin-bottom:12px}
  label{display:block;font-size:13px;margin:10px 0 6px;opacity:.9}
  input{width:100%;padding:10px;border-radius:8px;border:1px solid #222;background:#0f0f10;color:#fff}
  button{width:100%;padding:12px;border-radius:10px;border:0;background:#0ea5a3;color:#062024;font-weight:700;margin-top:12px}
  .row{display:flex;gap:8px}
  .row button{flex:1}
  .links{word-break:break-all;font-size:13px;background:#091012;padding:8px;border-radius:8px;margin-top:8px}
  .small{font-size:12px;opacity:.85}
</style>
</head>
<body>
  <h2>Admin — Create Call</h2>
  <div class="card">
    <label>Manager password</label>
    <input id="mgr" type="password" placeholder="Βάλε το manager pass" />
    <label>Model name</label>
    <input id="model" value="Anna" />
    <label>Client name</label>
    <input id="client" value="Nick" />
    <label>Duration (minutes)</label>
    <input id="duration" type="number" value="30" />
    <button id="create">Create Call & Generate Links</button>
  </div>

  <div class="card" id="controls" style="display:none">
    <div class="small">Call ID: <span id="callId"></span></div>
    <div class="small">Ends at: <span id="endsAt"></span></div>
    <div class="row" style="margin-top:8px">
      <button id="extend10">+10′</button>
      <button id="extend30">+30′</button>
    </div>
    <div class="row" style="margin-top:8px">
      <button id="endNow" style="background:#ef4444">End Now</button>
    </div>
    <div id="linksArea" style="margin-top:10px"></div>
  </div>

<script>
async function jsonFetch(url, opts = {}) {
  const r = await fetch(url, opts);
  if(!r.ok){
    const t = await r.text();
    throw new Error(t || r.status);
  }
  return r.json();
}

function fmt(t){ try { return new Date(t).toLocaleString(); } catch(e){ return t; } }

document.getElementById('create').onclick = async () => {
  try {
    const mgr = document.getElementById('mgr').value.trim();
    const model = document.getElementById('model').value || 'Model';
    const client = document.getElementById('client').value || 'Client';
    const duration = parseInt(document.getElementById('duration').value) || 30;
    if(!mgr) return alert('Manager password required');

    const res = await jsonFetch('/api/create-call', {
      method:'POST',
      headers:{'Content-Type':'application/json','X-Manager-Pass':mgr},
      body: JSON.stringify({ durationMinutes: duration, modelName: model, clientName: client })
    });

    document.getElementById('controls').style.display = 'block';
    document.getElementById('callId').textContent = res.callId;
    document.getElementById('endsAt').textContent = fmt(res.endsAtISO);

    const L = (name,url)=>'<div class="small">'+name+':</div><div class="links"><a href="'+url+'" target="_blank">'+url+'</a></div>';
    document.getElementById('linksArea').innerHTML =
      L('Model', res.links.model) + L('Client', res.links.client) + L('Manager', res.links.managerStealth);

    // quick copy
    if(navigator.clipboard){
      navigator.clipboard.writeText(res.links.client).catch(()=>{});
    }
  } catch(e){ alert('Error: ' + e.message); }
};

async function extend(minutes){
  const mgr = document.getElementById('mgr').value.trim();
  const callId = document.getElementById('callId').textContent;
  if(!callId) return alert('No callId');
  const r = await jsonFetch('/api/extend-call', {
    method:'POST',
    headers:{'Content-Type':'application/json','X-Manager-Pass':mgr},
    body: JSON.stringify({ callId, minutes })
  });
  document.getElementById('endsAt').textContent = fmt(r.newEndsAtISO);
  alert('Extended by '+minutes+' minutes');
}
document.getElementById('extend10').onclick = () => extend(10);
document.getElementById('extend30').onclick = () => extend(30);

document.getElementById('endNow').onclick = async () => {
  try{
    const mgr = document.getElementById('mgr').value.trim();
    const callId = document.getElementById('callId').textContent;
    if(!callId) return alert('No callId');
    await jsonFetch('/api/end-call', {
      method:'POST',
      headers:{'Content-Type':'application/json','X-Manager-Pass':mgr},
      body: JSON.stringify({ callId })
    });
    alert('Call ended'); location.reload();
  }catch(e){ alert('Error: '+e.message); }
};
</script>
</body></html>`;
  res.setHeader("Content-Type","text/html; charset=utf-8");
  res.send(html);
});

// --------------- Start server ---------------
app.listen(PORT, () => {
  console.log(`YourBrand Calls running on ${PORT}`);
});
