const express = require('express');
const cors = require('cors');
const { AccessToken, RoomServiceClient, AgentDispatchClient } = require('livekit-server-sdk');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const app = express();
app.use(cors());
app.use(express.json());

// In-memory store for this assignment
const interviewResults = {};

const roomSvc = new RoomServiceClient(process.env.LIVEKIT_URL, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
const dispatchSvc = new AgentDispatchClient(process.env.LIVEKIT_URL, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);

app.post('/api/token', async (req, res) => {
  const { candidateName, jobTitle, questions } = req.body;
  
  const roomName = `interview-${Date.now()}`;
  const metadata = JSON.stringify({ candidateName, jobTitle, questions });
  
  try {
    // 1. Explicitly create the room with the metadata
    await roomSvc.createRoom({
      name: roomName,
      emptyTimeout: 10 * 60, // 10 minutes
      maxParticipants: 10,
      metadata: metadata,
    });
    
    // 2. Dispatch the agent to the room
    await dispatchSvc.createDispatch(roomName, 'agent');
  } catch (err) {
    console.error('Failed to create room or dispatch agent:', err);
    return res.status(500).json({ error: err.message, stack: err.stack });
  }
  
  // 3. Generate token for the frontend participant
  const at = new AccessToken(
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
    { identity: candidateName || 'candidate' }
  );
  
  at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });
  
  const token = await at.toJwt();
  
  res.json({ token, roomName, url: process.env.LIVEKIT_URL, metadata });
});

// Called by the agent or frontend to save the final transcript + recording
app.post('/api/results/:roomName', (req, res) => {
  interviewResults[req.params.roomName] = req.body;
  res.json({ ok: true });
});

app.get('/api/results/:roomName', (req, res) => {
  res.json(interviewResults[req.params.roomName] || null);
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Token server running on port ${PORT}`));
