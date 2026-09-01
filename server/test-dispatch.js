const { RoomServiceClient, AgentDispatchClient } = require('livekit-server-sdk');
require('dotenv').config({ path: '../.env' });
async function test() {
  const roomSvc = new RoomServiceClient(process.env.LIVEKIT_URL, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
  const dispatchSvc = new AgentDispatchClient(process.env.LIVEKIT_URL, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
  
  const roomName = `test-${Date.now()}`;
  try {
    console.log('Creating room...');
    await roomSvc.createRoom({ name: roomName, emptyTimeout: 10 * 60, maxParticipants: 10 });
    console.log('Dispatching agent...');
    await dispatchSvc.createDispatch(roomName, 'agent');
    console.log('Success!');
  } catch (err) {
    console.error('Error:', err);
  }
}
test();
