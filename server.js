import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch'; // αν το θα χρειαστείς
const app = express();

app.use(cors());
app.use(express.json());

// ✅ σερβίρουμε τη φόρμα στο "/"
app.use(express.static('public'));

const DAILY_API_KEY = process.env.DAILY_API_KEY;
const DAILY_DOMAIN  = process.env.DAILY_DOMAIN;  // π.χ. museflow.daily.co
const BASE_URL      = process.env.BASE_URL || 'http://localhost:3000';
const PORT          = process.env.PORT || 3000;

// helper για room creation (PUBLIC)
async function createDailyRoom(roomName, durationMinutes){
  const res = await fetch('https://api.daily.co/v1/rooms', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${DAILY_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: roomName,
      properties: {
        privacy: 'public',        // 👈 ΜΟΝΟ αυτό αλλάζει ώστε να μην χρειάζεται να μπαίνεις στο Daily
        exp: Math.floor(Date.now()/1000) + durationMinutes*60
      }
    })
  });
  if(!res.ok){
    const t = await res.text();
    throw new Error('Daily API: '+res.status+' '+t);
  }
  return res.json();
}

app.post('/api/create-call', async (req, res) => {
  try {
    const { clientName='Client', modelName='Model', durationMinutes=30 } = req.body || {};
    const roomName = 'room_' + Math.random().toString(36).slice(2,10);

    await createDailyRoom(roomName, durationMinutes);

    const roomUrl = `https://${DAILY_DOMAIN}/${roomName}`;
    res.json({
      roomName,
      model:          `${roomUrl}?userName=${encodeURIComponent(modelName)}`,
      client:         `${roomUrl}?userName=${encodeURIComponent(clientName)}`,
      managerStealth: `${roomUrl}?userName=Manager`
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log('YourBrand Calls running on', PORT);
});
