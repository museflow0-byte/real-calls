import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const DAILY_API_KEY = process.env.DAILY_API_KEY;
const DAILY_DOMAIN = process.env.DAILY_DOMAIN; // π.χ. museflow.daily.co
const BASE_URL = process.env.RENDER_EXTERNAL_URL || process.env.BASE_URL || 'http://localhost:3000';
const PORT = process.env.PORT || 3000;
const MANAGER_PASS = process.env.MANAGER_PASS || 'manager';

function assertEnv() {
  if (!DAILY_API_KEY) throw new Error('Set DAILY_API_KEY in env');
  if (!DAILY_DOMAIN) throw new Error('Set DAILY_DOMAIN in env');
}

app.get('/ping', (req, res) => {
  res.json({ ok: true, at: new Date().toISOString() });
});

app.post('/api/create-call', async (req, res) => {
  try {
    assertEnv();

    const {
      durationMinutes = 30,
      clientName = 'Client',
      modelName = 'Model',
    } = req.body || {};

    const exp = Math.floor(Date.now() / 1000) + durationMinutes * 60;

    // Δημιουργία room στο Daily
    const roomRes = await fetch('https://api.daily.co/v1/rooms', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DAILY_API_KEY}`,
      },
      body: JSON.stringify({
        properties: {
          exp,                  // λήξη
          enable_prejoin_ui: true,
          enable_chat: false
        }
      }),
    });

    const roomData = await roomRes.json();
    if (!roomRes.ok) {
      return res.status(500).json({ error: 'daily-api-error', info: roomData });
    }

    const roomName =
      roomData.name ||
      (roomData.url ? roomData.url.split('/').pop() : undefined) ||
      roomData.id;

    const baseRoomUrl = `https://${DAILY_DOMAIN}/${roomName}`;
    const modelUrl   = `${baseRoomUrl}?userName=${encodeURIComponent(modelName)}`;
    const clientUrl  = `${baseRoomUrl}?userName=${encodeURIComponent(clientName)}`;
    const managerUrl = `${baseRoomUrl}?userName=Manager`;

    return res.json({
      links: {
        model: modelUrl,
        client: clientUrl,
        managerStealth: managerUrl
      },
      expiresAt: exp,
      base: BASE_URL
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Προαιρετικό root – για να μη βλέπεις “Not Found”
app.get('/', (req, res) => res.type('text').send('OK – use POST /api/create-call'));

app.listen(PORT, () => {
  console.log('ENV CHECK:', {
    hasKey: !!DAILY_API_KEY,
    keyLen: DAILY_API_KEY?.length,
    domain: DAILY_DOMAIN,
    baseUrl: BASE_URL,
    port: PORT
  });
  console.log(`YourBrand Calls running on ${PORT}`);
});
