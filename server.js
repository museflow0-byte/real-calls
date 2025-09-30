import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import axios from 'axios';
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ----- ENV CHECK -----
const REQUIRED = ["DAILY_API_KEY", "DAILY_DOMAIN", "MANAGER_PASS"];
const missing = REQUIRED.filter((k) => !process.env[k] || !String(process.env[k]).trim());
if (missing.length) {
  console.error("Missing ENV:", missing.join(", "));
  process.exit(1);
}

const DAILY_API_KEY = process.env.DAILY_API_KEY.trim();
const DAILY_DOMAIN = process.env.DAILY_DOMAIN.trim();          // π.χ. museflow.daily.co
const MANAGER_PASS = process.env.MANAGER_PASS.trim();
const PORT = process.env.PORT || 3000;

console.log("ENV CHECK:", {
  hasKey: !!DAILY_API_KEY,
  domain: DAILY_DOMAIN,
  port: PORT
});

// ----- STATIC (αν βάλεις /public/index.html) -----
app.use(express.static(path.join(__dirname, "public")));

// ----- HEALTH -----
app.get("/", (req, res) => {
  res.type("text/plain").send("✅ Server is running");
});

// ----- /admin (μικρό UI) -----
app.get("/admin", (req, res) => {
  const { p } = req.query;
  if (p !== MANAGER_PASS) {
    res.type("html").send(`
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <div style="font-family:system-ui;max-width:480px;margin:40px auto">
        <h2>Manager Login</h2>
        <form method="GET" action="/admin">
          <input type="password" name="p" placeholder="Password" style="padding:10px;width:100%;box-sizing:border-box" />
          <button style="margin-top:10px;padding:10px 14px">Enter</button>
        </form>
      </div>
    `);
    return;
  }

  res.type("html").send(`
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <div style="font-family:system-ui;max-width:520px;margin:40px auto">
      <h2>Create Call</h2>
      <form id="f">
        <label>Duration (minutes)</label>
        <input name="durationMinutes" type="number" value="30" min="1" style="display:block;margin:6px 0 16px;padding:10px;width:100%" />
        <label>Client name</label>
        <input name="clientName" value="Nick" style="display:block;margin:6px 0 16px;padding:10px;width:100%" />
        <label>Model name</label>
        <input name="modelName" value="Anna" style="display:block;margin:6px 0 16px;padding:10px;width:100%" />
        <button style="padding:10px 14px">Create</button>
      </form>
      <pre id="out" style="white-space:pre-wrap;background:#111;color:#0f0;padding:12px;border-radius:6px;margin-top:16px"></pre>

      <script>
        const f = document.getElementById('f');
        const out = document.getElementById('out');
        f.onsubmit = async (e) => {
          e.preventDefault();
          const body = Object.fromEntries(new FormData(f));
          body.durationMinutes = Number(body.durationMinutes || 30);
          try {
            const r = await fetch('/api/create-call', {
              method:'POST',
              headers:{'Content-Type':'application/json'},
              body: JSON.stringify(body)
            });
            const data = await r.json();
            out.textContent = JSON.stringify(data, null, 2);
          } catch (err) {
            out.textContent = 'Error: ' + err.message;
          }
        }
      </script>
    </div>
  `);
});

// ----- CREATE CALL -----
app.post("/api/create-call", async (req, res) => {
  try {
    const { durationMinutes = 30, modelName = "Model", clientName = "Client" } = req.body || {};

    // UNIX exp για Daily room
    const exp = Math.floor(Date.now() / 1000) + Number(durationMinutes) * 60;

    // Δώσε ένα μοναδικό room name
    const roomName = `room_${Math.random().toString(36).slice(2, 10)}`;

    // Create room στο Daily REST API
    const resp = await axios.post(
      "https://api.daily.co/v1/rooms",
      {
        name: roomName,
        privacy: "private",
        properties: { exp }
      },
      {
        headers: {
          Authorization: `Bearer ${DAILY_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    // Χτίζουμε links
    const base = `https://${DAILY_DOMAIN}/${roomName}`;
    const links = {
      model: `${base}?userName=${encodeURIComponent(modelName)}`,
      client: `${base}?userName=${encodeURIComponent(clientName)}`,
      managerStealth: `${base}?userName=${encodeURIComponent("Manager")}`
    };

    res.json({ ok: true, room: resp.data, links });
  } catch (err) {
    console.error(err?.response?.data || err.message);
    res.status(500).json({ ok: false, error: err?.response?.data || err.message });
  }
});

app.listen(PORT, () => {
  console.log(`YourBrand Calls running on ${PORT}`);
});
