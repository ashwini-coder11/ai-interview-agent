# AI Interview Agent – Complete Study Guide

## 1. Project Overview

### What Problem This Project Solves
In traditional job recruitment, conducting preliminary screening interviews requires significant human time and scheduling coordination. Human interviewers must manually ask candidates a set of screening questions, record answers, and evaluate responses.

This project solves that problem by providing an automated, real-time **AI Voice Interviewer**. Candidates can conduct a voice-based interview at any time directly through their web browser. An AI agent asks pre-configured interview questions sequentially, listens to the candidate's spoken responses, handles conversational turn-taking, and saves the full transcript and interview duration upon completion.

### What the Application Does
1. **Setup**: An interviewer or candidate enters candidate metadata (Candidate Name, Job Title) and a custom list of interview questions into a web setup form.
2. **Session Creation**: The backend application creates a dedicated real-time audio room on LiveKit and dispatches an autonomous AI Agent to that room.
3. **Voice Interaction**: The candidate joins the room through their browser. The AI agent greets the candidate via natural spoken voice and asks the first question.
4. **Speech Pipeline**:
   - The candidate speaks into their microphone.
   - **Deepgram** transcribes candidate speech to text in real time.
   - **Google Gemini** processes the response and determines the appropriate conversational reply.
   - **Cartesia** converts the AI's response text into natural voice audio.
   - The audio plays back in the candidate's browser via **LiveKit WebRTC**.
5. **Interview Flow Control**: The system tracks the current question index in application code (`currentQuestionIndex`). After the candidate finishes answering a question, the agent automatically advances to the next question.
6. **Completion & Results**: Once all questions are answered, the AI delivers a warm closing statement, posts the complete interview transcript and duration to the server, and shuts down cleanly. The candidate is presented with an Interview Results screen containing the transcript and session summary.

### Who Uses It
- **Recruiters & Hiring Managers**: To set up job interviews with specific question sets and review completed transcripts.
- **Job Candidates**: To complete real-time spoken voice screening interviews on-demand.

### Project Flow in One Minute

```
Candidate (Browser Microphone)
       ↓ (WebRTC Audio Stream)
LiveKit Cloud Room
       ↓ (Real-Time Audio Frame Stream)
AI Agent Worker (Node.js)
       ↓ (Audio Buffer)
Deepgram STT (nova-3 Model) → [Converts Voice to Text]
       ↓ (Transcribed Text)
Google Gemini LLM (gemini-3.6-flash) → [Generates AI Question/Response]
       ↓ (AI Response Text)
Cartesia TTS → [Converts Text to Natural Spoken Audio]
       ↓ (Audio Buffer Stream)
LiveKit Cloud Room
       ↓ (WebRTC Audio Stream)
Candidate (Browser Speaker / Headset)
```

---

## 2. Why Was This Project Built?

### Purpose of the Project
The primary purpose of this project is to build a production-grade, low-latency, real-time voice AI assistant that conducts automated job interviews using modern cloud voice architecture.

### What Problem It Solves
- **Scalability**: Enables hundreds of automated screening interviews to run concurrently without requiring human interviewer availability.
- **Consistency**: Guarantees that every candidate for a role is asked the exact same set of questions in the exact same order.
- **Real-Time Responsiveness**: Uses streaming WebRTC speech-to-speech architecture instead of slow HTTP request/response polling, resulting in natural sub-second conversational latency.

### Why an AI Voice Interviewer Is Useful
Voice interviews evaluate candidate communication skills and quick thinking far better than text surveys. However, scheduling live human interviews introduces bottleneck delays. An AI voice interviewer combines the natural conversational experience of a spoken interview with the instant availability of software.

### Technical Concepts Demonstrated in Code
1. **Real-Time WebRTC Audio Streaming**: Using LiveKit to stream bidirectional low-latency audio between browser client and Node.js backend agent.
2. **Modular Voice Pipeline Architecture**: Decoupling Speech-to-Text (STT), Large Language Model (LLM), and Text-to-Speech (TTS) providers.
3. **Explicit State Machine Control**: Controlling interview progression outside the LLM using standard application logic (`currentQuestionIndex`).
4. **Asynchronous Server-Side Job Dispatch**: Dynamically dispatching agent instances to LiveKit rooms on-demand via server API calls.
5. **Graceful Fault Tolerance & Event Handling**: Handling network disconnects (`participantDisconnected`), speech pauses (silence timers), and LLM/TTS generation retries.

---

## 3. Complete Architecture

### System Architecture Diagram

```
+-------------------------------------------------------------------------+
|                                FRONTEND                                 |
|                         (Next.js / React UI)                            |
|  - SetupForm: Candidate name, job title, questions input               |
|  - InterviewRoom: LiveKitRoom, RoomAudioRenderer, BarVisualizer        |
|  - ResultsScreen: Polling backend for transcript, status & duration     |
+-------------------+---------------------------------+-------------------+
                    | HTTP POST /api/token            | WebRTC Audio
                    v                                 v
+-------------------+---------------------------------+-------------------+
|                            TOKEN SERVER                                 |
|                       (Express / Node.js)                               |
|  - POST /api/token: Creates LiveKit room, sets metadata, dispatches     |
|  - POST /api/results/:roomName: Saves transcript & interview status     |
|  - GET /api/results/:roomName: Returns saved interview results          |
+-------------------+-----------------------------------------------------+
                    | LiveKit SDK API Calls
                    v
+-------------------+-----------------------------------------------------+
|                           LIVEKIT CLOUD                                 |
|                     (WebRTC Infrastructure)                             |
|  - Manages real-time audio rooms                                        |
|  - Routes candidate microphone stream to AI agent                       |
|  - Routes AI agent synthesized voice back to candidate                  |
+-------------------+-----------------------------------------------------+
                    | WebRTC Audio Stream
                    v
+-------------------+-----------------------------------------------------+
|                           AI AGENT WORKER                               |
|                      (Node.js / LiveKit SDK)                            |
|  - Entry point: agent/src/main.ts                                       |
|  - Manages session lifecycle and state (currentQuestionIndex)           |
|  - Listens to ConversationItemAdded & AgentStateChanged events          |
+-------+-------------------------+-------------------------+-------------+
        | Audio Stream            | Prompt Text             | Response Text
        v                         v                         v
+-------+-------------+ +---------+-------------+ +---------+-------------+
|    DEEPGRAM STT     | |    GOOGLE GEMINI      | |    CARTESIA TTS     |
|    (nova-3)         | | (gemini-3.6-flash)    | |  (Voice Synthesis)  |
| Converts Candidate  | | Generates Question &  | | Converts AI Text    |
| Voice to Text       | | Acknowledgment Text   | | into Audio Frames   |
+---------------------+ +-----------------------+ +---------------------+
```

### Component Overview
1. **Frontend (Next.js)**: Runs on port 3000. Provides the UI for collecting candidate inputs, rendering the LiveKit voice room, displaying visualizers, and showing final transcripts.
2. **Token Server (Express)**: Runs on port 4000. Authenticates with LiveKit using server keys, creates LiveKit rooms with metadata attached, dispatches agent workers, and stores in-memory interview results.
3. **LiveKit Cloud**: Manages real-time WebRTC connections, media routing, and agent dispatches between candidate and agent.
4. **AI Agent Worker (Node.js)**: Runs as a worker process listening for LiveKit room dispatches. Tracks `currentQuestionIndex`, handles voice events, and orchestrates the AI pipeline.
5. **Deepgram STT (`nova-3`)**: Transcribes real-time audio from candidate into text.
6. **Google Gemini LLM (`gemini-3.6-flash`)**: Evaluates interview state and formats the exact question and concise acknowledgments.
7. **Cartesia TTS**: Converts AI text output into real-time spoken audio frames.

### How Data Moves Between Components
1. Candidate enters information on Frontend (`SetupForm.tsx`).
2. Frontend sends JSON payload (`{ candidateName, jobTitle, questions }`) via HTTP POST to Express Token Server (`server/index.js`).
3. Express Server calls LiveKit `RoomServiceClient.createRoom()` passing metadata as JSON string, calls `AgentDispatchClient.createDispatch()`, signs a JWT `AccessToken`, and returns connection details to Frontend.
4. Frontend connects to LiveKit Cloud Room via WebRTC (`<LiveKitRoom>`).
5. LiveKit Cloud dispatches the AI Agent Worker (`agent/src/main.ts`), which connects to the room and reads metadata.
6. Candidate speaks → Browser sends WebRTC audio to LiveKit → LiveKit forwards audio to Agent → Deepgram STT transcribes audio to text.
7. Agent receives candidate text → Triggers Gemini LLM prompt → Gemini generates response text.
8. Agent passes response text to Cartesia TTS → Cartesia generates audio frames → Agent streams audio to LiveKit Room → Candidate hears voice through browser.
9. Upon interview finish, Agent sends HTTP POST to Express Server (`/api/results/:roomName`) with status, transcript, and duration.
10. Frontend polls Express Server (`GET /api/results/:roomName`) and renders the results UI (`ResultsScreen.tsx`).

---

## 4. Complete System Flow Step by Step

### Step 1: User Opens the Frontend
- **What happens**: Candidate navigates to `http://localhost:3000` in browser.
- **Why it happens**: The browser loads the Next.js single-page application (`frontend/app/page.tsx`).
- **File/Function**: `frontend/app/page.tsx` (`Page` component).
- **Data passed**: Initial state set to `appState = 'setup'`, `roomData = null`.

### Step 2: User Enters Interview Details
- **What happens**: Candidate fills in Candidate Name (e.g. "Jane Doe"), Job Title (e.g. "Software Engineer"), and Interview Questions (one per line in textarea).
- **Why it happens**: Setup form components store controlled React inputs.
- **File/Function**: `frontend/components/ai-interview/SetupForm.tsx` (`SetupForm` component).
- **Data passed**: Candidate inputs stored in React component local state (`candidateName`, `jobTitle`, `questions`).

### Step 3: User Clicks Start Interview
- **What happens**: Candidate submits form. Form splits newline-separated string into an array of cleaned question strings (`questionsList`).
- **Why it happens**: Form submit triggers `handleSubmit(e)`.
- **File/Function**: `SetupForm.tsx` (`handleSubmit()`).
- **Data passed**: JSON object `{ candidateName, jobTitle, questions: string[] }`.

### Step 4: Frontend Communicates with Backend
- **What happens**: Frontend executes HTTP POST request to `http://localhost:4000/api/token`.
- **Why it happens**: Token generation and room creation require secret API credentials which cannot be exposed to the client.
- **File/Function**: `SetupForm.tsx` (`fetch(process.env.NEXT_PUBLIC_TOKEN_SERVER_URL + '/api/token')`).
- **Data passed**: Request headers `{ 'Content-Type': 'application/json' }`, Body `{ candidateName: "Jane Doe", jobTitle: "Software Engineer", questions: ["What is your strength?", ...] }`.

### Step 5: Backend Generates LiveKit Token
- **What happens**: Express backend creates a room name (`interview-<timestamp>`), stringifies candidate metadata, creates a room on LiveKit Cloud via `roomSvc.createRoom()`, dispatches agent worker via `dispatchSvc.createDispatch()`, signs a LiveKit `AccessToken`, and returns JWT token to frontend.
- **Why it happens**: Room creation and agent dispatch must be executed server-side using `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`.
- **File/Function**: `server/index.js` (`POST /api/token` route handler).
- **Data passed**: Returns JSON `{ token: "<jwt_string>", roomName: "interview-1725091200000", url: "wss://...", metadata: "{\"candidateName\":...}" }`.

### Step 6: Candidate Joins LiveKit Room
- **What happens**: Frontend receives token response, updates `roomData`, sets `appState = 'interviewing'`, and renders `<InterviewRoom>`. `<LiveKitRoom>` establishes WebRTC WebSocket connection to LiveKit Cloud.
- **Why it happens**: Enables browser audio hardware and starts subscription to audio tracks.
- **File/Function**: `frontend/app/page.tsx` (`handleStart`), `frontend/components/ai-interview/InterviewRoom.tsx` (`<LiveKitRoom connect={true}>`).
- **Data passed**: `token`, `serverUrl`.

### Step 7: AI Agent Joins the Room
- **What happens**: LiveKit Cloud dispatches job to running agent worker (`agent/src/main.ts`). Agent worker executes `entry(ctx)` function, connects via `ctx.connect()`, parses `ctx.room.metadata`, initializes state variables (`currentQuestionIndex = 0`, `transcript = []`), and configures `voice.Agent` and `voice.AgentSession`.
- **Why it happens**: Agent worker process pre-loaded models (`prewarm` loaded Silero VAD) and binds to the newly created room.
- **File/Function**: `agent/src/main.ts` (`defineAgent`, `entry`).
- **Data passed**: `ctx.room.metadata` containing `candidateName`, `jobTitle`, `questions`.

### Step 8: AI Asks the Interview Question
- **What happens**: Agent invokes `askNextQuestion()`. Since `currentQuestionIndex === 0`, it prompts Gemini LLM to greet candidate warmly and ask Question 1 (`questions[0]`). Gemini produces text, Cartesia converts text to speech, and audio streams to LiveKit room.
- **Why it happens**: Initiates conversational flow with candidate.
- **File/Function**: `agent/src/main.ts` (`askNextQuestion()`, `session.generateReply()`).
- **Data passed**: Prompt instructions string sent to LLM.

### Step 9: Candidate Speaks
- **What happens**: Candidate hears AI question through browser speakers and answers into microphone.
- **Why it happens**: Browser streams candidate microphone audio over WebRTC track to LiveKit Cloud, which passes stream to agent worker.
- **File/Function**: `frontend/components/ai-interview/InterviewRoom.tsx` (`<RoomAudioRenderer>`, `<VoiceAssistantControlBar>`).
- **Data passed**: Real-time WebRTC audio frames.

### Step 10: Deepgram Converts Speech to Text
- **What happens**: Agent passes incoming audio frames through Silero VAD and Deepgram STT (`nova-3` model). Deepgram outputs text transcript of candidate response.
- **Why it happens**: Convert natural spoken audio into structured text for processing.
- **File/Function**: `agent/src/main.ts` (`new deepgram.STT({ model: 'nova-3' })`).
- **Data passed**: Audio buffer input → Transcribed string output.

### Step 11: Gemini Processes the Conversation
- **What happens**: Agent session receives candidate transcribed text item. Agent listener `voice.AgentSessionEventTypes.ConversationItemAdded` fires. Text is appended to `transcript` array.
- **Why it happens**: Candidate speech input triggers state advancement.
- **File/Function**: `agent/src/main.ts` (`session.on(voice.AgentSessionEventTypes.ConversationItemAdded)`).
- **Data passed**: `event.item.textContent`, `event.item.role`.

### Step 12: Cartesia Converts AI Response to Speech
- **What happens**: When `event.item.role === 'user'`, agent increments `currentQuestionIndex += 1` and calls `askNextQuestion()`. Gemini generates prompt text for Question 2 with brief acknowledgment. Response text is passed to Cartesia TTS (`cartesia.TTS`), which streams audio chunks.
- **Why it happens**: Prepares spoken audio output for the next interview step.
- **File/Function**: `agent/src/main.ts` (`askNextQuestion()`, `new cartesia.TTS()`).
- **Data passed**: Response text string input → Audio PCM/MP3 frame output.

### Step 13: Candidate Hears the AI
- **What happens**: Cartesia audio frames stream into LiveKit room. Candidate browser plays audio via `<RoomAudioRenderer>`. Bar visualizer (`<BarVisualizer>`) animates blue bars indicating `AI is Speaking`.
- **Why it happens**: Provides visual and audio feedback to candidate.
- **File/Function**: `frontend/components/ai-interview/InterviewRoom.tsx` (`InterviewVisualizer`).
- **Data passed**: Audio track reference `audioTrack`, state `'speaking'`.

### Step 14: Interview Moves to the Next Question
- **What happens**: Steps 9 through 13 repeat sequentially for each question in `questions` array. If candidate stays silent for 10s while agent is listening, `AgentStateChanged` timer executes gentle check-in prompt.
- **Why it happens**: State machine enforces exact question progression while silence timer handles pauses.
- **File/Function**: `agent/src/main.ts` (`currentQuestionIndex`, `startSilenceTimer`).
- **Data passed**: Updated `currentQuestionIndex`.

### Step 15: Interview Completes
- **What happens**: When `currentQuestionIndex >= questions.length`, agent generates warm closing reply, calculates `durationMs = Date.now() - startedAt`, sends POST to `http://localhost:4000/api/results/${ctx.room.name}` with `{ candidateName, status: 'Completed', transcript, durationMs }`, waits 4 seconds for audio playback finish, disconnects room (`ctx.room.disconnect()`), and shuts down process (`ctx.shutdown()`). Candidate frontend receives disconnect event, sets `appState = 'results'`, and renders `<ResultsScreen>` displaying complete transcript and metrics.
- **Why it happens**: Graceful teardown and persistence of interview results.
- **File/Function**: `agent/src/main.ts` (`askNextQuestion()` completion branch), `frontend/app/page.tsx` (`handleDisconnect`), `frontend/components/ai-interview/ResultsScreen.tsx`.
- **Data passed**: JSON payload saved to backend and polled by frontend.

---

## 5. Frontend Explained

### Setup Form (`SetupForm.tsx`)
1. **What it does**: Collects Candidate Name, Job Title, and newline-separated Interview Questions. Submits data to backend token server.
2. **Why we need it**: Provides interactive configuration UI so interviews are dynamically configured rather than hardcoded.
3. **Why we chose this approach**: Controlled React form with standard HTML `<input>` and `<textarea>` elements styled via Tailwind CSS and Shadcn UI.
4. **How it is implemented**: `SetupForm` component uses React `useState` hooks. On form submit (`handleSubmit`), splits question string by newline, filters empty lines, and POSTs payload to Express backend.
5. **Alternatives**: Hardcoding questions in codebase or fetching questions from a CMS/database.
6. **Without it**: Interview settings would be static and unable to adapt to different job roles or candidate names.

### Start Interview Button
1. **What it does**: Triggers form validation, sends HTTP request to backend, disables during loading (`isLoading = true`), and displays status ("Starting...").
2. **Why we need it**: Prevents duplicate submissions and provides visual feedback during async backend token generation.
3. **Why we chose this approach**: Standard HTML `<button>` wrapped in custom Shadcn `<Button>` component with disabled state handling.
4. **How it is implemented**: Renders `<Button type="submit" disabled={isLoading}>`.
5. **Alternatives**: Auto-submitting on field blur or un-throttled click handlers.
6. **Without it**: Candidate could double-click, spawning multiple concurrent rooms and token dispatches.

### LiveKit Connection (`InterviewRoom.tsx`)
1. **What it does**: Establishes real-time WebRTC audio room connection using LiveKit React SDK components (`<LiveKitRoom>`).
2. **Why we need it**: Manages low-level WebRTC peer connections, audio track publishing/subscription, and room state events.
3. **Why we chose this approach**: Official `@livekit/components-react` library handles WebRTC connection lifecycle declaratively.
4. **How it is implemented**: `<LiveKitRoom token={token} serverUrl={url} connect={true} onDisconnected={onDisconnect}>`.
5. **Alternatives**: Building raw WebRTC RTCPeerConnection code manually.
6. **Without it**: Writing complex WebRTC signaling, ICE candidate negotiation, and audio track management from scratch.

### Microphone & Control Bar (`VoiceAssistantControlBar`)
1. **What it does**: Renders mute/unmute microphone button and leave session button.
2. **Why we need it**: Gives candidate explicit control over their audio input and session termination.
3. **Why we chose this approach**: Out-of-the-box `<VoiceAssistantControlBar controls={{ leave: true, mic: true }}>` component.
4. **How it is implemented**: Integrated inside `<LiveKitRoom>` context.
5. **Alternatives**: Custom HTML buttons wired to LiveKit room local participant track methods.
6. **Without it**: Candidate would have no way to mute mic or disconnect manually.

### Interview UI & Visualizer (`BarVisualizer`)
1. **What it does**: Renders 7 animated blue bars that react dynamically to speech audio and displays session status ("AI is Listening...", "AI is Speaking...").
2. **Why we need it**: Gives immediate visual feedback showing candidate that audio is active and indicating whether AI or candidate is currently speaking.
3. **Why we chose this approach**: LiveKit `useVoiceAssistant()` hook combined with `<BarVisualizer>` component.
4. **How it is implemented**: `InterviewVisualizer()` inspects `state` and `audioTrack` from `useVoiceAssistant()`.
5. **Alternatives**: Plain static text status label or generic spinner.
6. **Without it**: Interface would feel non-interactive, leaving candidate uncertain if the AI is listening or speaking.

### Transcript & Results Display (`ResultsScreen.tsx`)
1. **What it does**: Polls Express backend every 2 seconds (`GET /api/results/:roomName`), displays candidate name, completion status, total duration (`MM:SS`), audio recording player (if available), formatted chat transcript bubbles, and a "Start New Interview" button.
2. **Why we need it**: Shows the candidate/interviewer the full transcript and metrics after interview completion.
3. **Why we chose this approach**: Client-side polling interval (`setInterval`) until backend returns results.
4. **How it is implemented**: React `useEffect` hook polls endpoint, stores response in `results` state, and renders styled chat bubbles (AI responses left-aligned blue, Candidate responses right-aligned gray).
5. **Alternatives**: WebSockets, Server-Sent Events (SSE), or Webhook notifications.
6. **Without it**: Candidate would see a black screen upon disconnect without confirmation of saved results.

---

## 6. Backend Explained

### Why Backend Is Needed
The frontend running in a user's web browser cannot safely store secret cloud keys (`LIVEKIT_API_SECRET`). If secrets were placed in frontend code, anyone inspecting browser network calls or bundle files could extract the keys, gain full administrative control over the LiveKit account, create unlimited rooms, and incur unauthorized usage costs.

The Express backend acts as a secure intermediary that holds secrets, validates input, creates rooms, dispatches agents, signs JWT access tokens, and securely persists interview transcripts.

### API Endpoints

#### 1. `POST /api/token`
- **What it does**: Receives candidate metadata, creates a LiveKit room, dispatches agent worker, and generates a candidate access token.
- **Why it exists**: Serves as the main initialization entry point for an interview session.
- **Input**: JSON body `{ candidateName: string, jobTitle: string, questions: string[] }`.
- **Output**: JSON `{ token: string, roomName: string, url: string, metadata: string }`.
- **Implementation**:
  ```javascript
  const roomName = `interview-${Date.now()}`;
  const metadata = JSON.stringify({ candidateName, jobTitle, questions });
  await roomSvc.createRoom({ name: roomName, emptyTimeout: 600, maxParticipants: 10, metadata });
  await dispatchSvc.createDispatch(roomName, 'agent');
  const at = new AccessToken(API_KEY, API_SECRET, { identity: candidateName || 'candidate' });
  at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });
  const token = await at.toJwt();
  res.json({ token, roomName, url: process.env.LIVEKIT_URL, metadata });
  ```

#### 2. `POST /api/results/:roomName`
- **What it does**: Receives transcript, completion status, and duration from agent or frontend and stores in memory.
- **Why it exists**: Saves interview results upon completion or early disconnect.
- **Input**: URL param `roomName`, JSON body `{ candidateName, status, transcript, durationMs }`.
- **Output**: JSON `{ ok: true }`.
- **Implementation**: `interviewResults[req.params.roomName] = req.body;`

#### 3. `GET /api/results/:roomName`
- **What it does**: Fetches stored interview results for a given room.
- **Why it exists**: Allows frontend `ResultsScreen.tsx` to poll and render transcript.
- **Input**: URL param `roomName`.
- **Output**: JSON object containing result data or `null`.
- **Implementation**: `res.json(interviewResults[req.params.roomName] || null);`

### Security Principles

#### Why can't `LIVEKIT_API_SECRET` be stored in the frontend?
`LIVEKIT_API_SECRET` is a symmetric secret used to generate signed JWT tokens and authorize administrative server actions (like deleting rooms or creating dispatches). If stored in frontend environment variables (e.g. `NEXT_PUBLIC_...`), it gets compiled into client JS bundles, making it visible to anyone who opens Developer Tools.

#### Why do we generate tokens on the backend?
Tokens must be cryptographically signed using `LIVEKIT_API_SECRET`. By generating tokens on the backend, the server grants scoped, short-lived permissions (e.g. join only room `interview-12345` with candidate identity) without ever exposing the master API secret to the client.

---

## 7. LiveKit Explained

### What Is LiveKit?
LiveKit is an open-source, high-performance WebRTC infrastructure platform designed for real-time multi-user audio and video applications and real-time AI voice agents.

### What Is a LiveKit Room?
A LiveKit Room is a virtual real-time communication channel where participants (human users or AI agents) publish and subscribe to audio/video tracks and data messages.

### How Real-Time Communication Works in This Project
1. Express Server creates room `interview-<timestamp>` on LiveKit Cloud.
2. Candidate joins room as WebRTC participant via frontend React SDK.
3. AI Agent joins room as WebRTC participant worker process via `@livekit/agents` SDK.
4. Both participants publish audio tracks to LiveKit room router.
5. LiveKit Cloud routes audio packets in sub-50 milliseconds between candidate and agent.

### Access Tokens
A LiveKit access token is a JSON Web Token (JWT) signed with `LIVEKIT_API_SECRET`. It encodes:
- **Identity**: Name/ID of participant (e.g. "Jane Doe").
- **Grants**: Permissions granted (e.g. `roomJoin: true`, `room: "interview-123"`, `canPublish: true`, `canSubscribe: true`).
- **TTL**: Time-to-live expiration (e.g. 10 minutes).

### Why Did We Choose LiveKit?
- **Sub-Second Latency**: Built on native WebRTC, achieving sub-100ms transport latency compared to multi-second HTTP streaming.
- **Agent SDK**: Provides first-class Node.js agent framework (`@livekit/agents`) specifically designed for voice AI pipelines with built-in VAD, STT, LLM, and TTS orchestration.
- **Scalability**: LiveKit Cloud manages WebRTC infrastructure, signaling, and TURN/STUN NAT traversal automatically.

### Alternatives
- **Twilio Programmable Voice**: Traditional telephony SIP platform, but higher latency and higher cost.
- **Agora / Daily.co**: Commercial WebRTC platforms, but less specialized native agent SDK support for server-side Node.js voice AI workers.
- **Raw WebRTC with Socket.io**: Custom signaling server, but requires implementing room routing, media servers (SFU), and ICE negotiation from scratch.

---

## 8. AI Agent Explained

### Agent Startup & Lifecycle (`agent/src/main.ts`)
The agent worker is defined using `defineAgent()` from `@livekit/agents` and executed via `cli.runApp()`.

```javascript
cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: 'agent'
  })
);
```

#### Prewarm Phase (`prewarm`)
- **What it does**: Pre-loads heavy models ONCE when worker process boots.
- **Implementation**: `proc.userData.vad = await silero.VAD.load();`
- **Why**: Silero VAD model loading takes hundreds of milliseconds. Prewarming ensures individual interview session startup is instant.

#### Entry Phase (`entry`)
- **What it does**: Triggered whenever LiveKit Cloud dispatches worker to an interview room.
- **Input**: `ctx: JobContext`.
- **Implementation**:
  1. `await ctx.connect()`: Connects worker to LiveKit room.
  2. Egress initialization: Attempts `startRoomCompositeEgress` to record room audio (caught gracefully if S3 bucket is unconfigured).
  3. Metadata parsing: Parses `ctx.room.metadata` into `InterviewConfig` (`{ candidateName, jobTitle, questions }`).
  4. State initialization: Sets `currentQuestionIndex = 0`, `transcript = []`, `startedAt = Date.now()`.
  5. Session configuration: Instantiates `voice.Agent` and `voice.AgentSession`.

### System Instructions (`voice.Agent`)
Configured with strict guardrail rules:
1. Ask ONLY exact questions provided via system messages — never invent follow-up questions.
2. After candidate answers, give a brief 1-sentence acknowledgment but do NOT ask clarifying follow-up questions.
3. NEVER generate new questions independently.
4. Deliver warm closing statement when told interview is complete.
5. Keep responses concise and conversational for voice output.

### Agent Session Configuration (`voice.AgentSession`)
```javascript
const session = new voice.AgentSession({
  vad: ctx.proc.userData.vad as silero.VAD,
  stt: new deepgram.STT({ apiKey: process.env.DEEPGRAM_API_KEY!, model: 'nova-3' }),
  llm: new google.LLM({ apiKey: process.env.GOOGLE_API_KEY!, model: 'gemini-3.6-flash' }),
  tts: new cartesia.TTS({ apiKey: process.env.CARTESIA_API_KEY! }),
});
```

### State Variables inside Entry Function
- `currentQuestionIndex` (number): Index of active question in `questions` array.
- `transcript` (array): Array of `{ speaker: 'ai' | 'candidate', text: string }`.
- `startedAt` (number): Timestamp (`Date.now()`) when interview started.
- `silenceTimer` (NodeJS.Timeout | null): 10-second timer for silence check-in prompts.
- `isAskingQuestion` (boolean): Flag preventing race conditions while agent is speaking.

### Event Listeners & Logic

#### `voice.AgentSessionEventTypes.ConversationItemAdded`
Listens for new transcript items added to conversation session.
- Appends text to `transcript` array.
- Checks `if (event.item.role === 'user' && !session._closing && !isAskingQuestion)`.
- If true: Clears silence timer, increments `currentQuestionIndex += 1`, and calls `askNextQuestion()`.

#### `voice.AgentSessionEventTypes.AgentStateChanged`
Monitors agent voice state (`'listening'`, `'speaking'`, `'idle'`).
- If state becomes `'listening'` or `'idle'`, starts 10-second silence timer (`startSilenceTimer()`).
- If state changes away from listening, clears timer.
- If timer expires (10 seconds of candidate silence), calls `session.generateReply()` asking gently if candidate is ready or needs question repeated.

#### `voice.AgentSessionEventTypes.UserStateChanged`
Monitors candidate user state (`'speaking'`).
- Clears silence timer as soon as candidate begins speaking.

#### `ctx.room.on('participantDisconnected')`
Listens for candidate exiting early.
- Calculates elapsed `durationMs`.
- POSTs `{ candidateName, status: 'Incomplete', transcript, durationMs }` to backend.
- Calls `await ctx.shutdown()` to clean up process memory.

---

## 9. Speech-to-Text – Deepgram

### What STT Means
Speech-to-Text (STT) converts human voice audio frequencies into raw string text.

### Why Speech Must Become Text
LLMs operate on text tokens, not raw audio waves. To evaluate candidate answers, incoming microphone audio must first be converted into written text.

### Deepgram Implementation in Project
- **Plugin**: `@livekit/agents-plugin-deepgram`
- **Model**: `nova-3`
- **Code**: `stt: new deepgram.STT({ apiKey: process.env.DEEPGRAM_API_KEY!, model: 'nova-3' })`
- **Why chosen**: Deepgram `nova-3` is designed specifically for low-latency streaming audio transcription, delivering lower word error rate (WER) and fast response times over WebRTC streams.

### Alternatives
- **Whisper (OpenAI)**: High accuracy, but higher latency for real-time streaming compared to Deepgram.
- **Google Cloud Speech-to-Text**: Enterprise STT, but requires additional GCP IAM setup.
- **AssemblyAI**: Specialized STT API, but Deepgram provides better native LiveKit agent plugin integration.
- **Without it**: The system would receive raw audio waves and have no way to feed candidate spoken words into the LLM.

---

## 10. LLM – Gemini

### What an LLM Is
A Large Language Model (LLM) is an AI neural network trained on vast text data to process text prompts and generate natural language responses.

### Why We Need Gemini in This Project
Gemini receives the system prompt, question text, and candidate transcript history, then formats natural 1-sentence acknowledgments and delivers the exact interview questions smoothly.

### Gemini Implementation in Project
- **Plugin**: `@livekit/agents-plugin-google`
- **Model**: `gemini-3.6-flash`
- **Code**: `llm: new google.LLM({ apiKey: process.env.GOOGLE_API_KEY!, model: 'gemini-3.6-flash' })`
- **Why chosen**: `gemini-3.6-flash` offers extremely low time-to-first-token (TTFT), excellent instruction adherence (ensuring agent follows critical guardrail rules), and cost-effective pricing. *(Replaces OpenAI gpt-4o-mini from original guide).*

### Alternatives
- **OpenAI GPT-4o-mini**: Standard conversational LLM, but replaced here with Gemini for faster response speeds.
- **Anthropic Claude 3.5 Haiku**: Low latency, but requires Anthropic API keys.
- **Without it**: The agent would sound robotic and unable to construct natural conversational transitions between questions.

---

## 11. Text-to-Speech – Cartesia

### What TTS Means
Text-to-Speech (TTS) synthesizes written text into natural-sounding human audio waveforms.

### Why AI Text Needs to Become Voice
Because this is a voice-first interview, candidate hears responses as spoken audio rather than reading text on screen.

### Cartesia Implementation in Project
- **Plugin**: `@livekit/agents-plugin-cartesia`
- **Code**: `tts: new cartesia.TTS({ apiKey: process.env.CARTESIA_API_KEY! })`
- **Why chosen**: Cartesia Sonic model is optimized for voice agents, offering sub-200ms audio generation latency and realistic conversational pacing.

### Alternatives
- **ElevenLabs**: Industry-leading voice realism, but slightly higher latency and higher cost per character.
- **OpenAI TTS**: Good voice quality, but fixed latency buffers.
- **Without it**: Candidate would not hear any voice audio and would be forced to read text output.

---

## 12. Interview State Management

### What Interview State Means
Interview state refers to tracking where the candidate is within the interview process:
- Active question index (`currentQuestionIndex`).
- Full transcript history (`transcript`).
- Interview status (`'Completed'` vs `'Incomplete'`).
- Timing metrics (`startedAt`, `durationMs`).

### How `currentQuestionIndex` Works
`currentQuestionIndex` is an explicit integer variable initialized to `0` inside `agent/src/main.ts`.

```
Start Interview -> currentQuestionIndex = 0 -> Ask Questions[0]
Candidate Answers -> event: ConversationItemAdded (role === 'user')
Increment -> currentQuestionIndex += 1 -> Ask Questions[1]
...
currentQuestionIndex >= Questions.length -> Save & Disconnect
```

### Why Question State Should NOT Depend Entirely on the LLM
If state was managed purely by telling the LLM "remember which question you're on", several problems occur:
1. **Hallucination**: The LLM might ask Question 1, then skip directly to Question 3 or repeat Question 1.
2. **Unwanted Probing**: The LLM might ignore instructions and ask unexpected follow-up questions.
3. **State Loss on LLM Failure**: If an LLM call times out or throws an API error, the LLM loses context, corrupting the interview sequence.

By controlling `currentQuestionIndex` in explicit Node.js code, the interview sequence is **100% deterministic**.

### What Happens If the LLM Fails While Processing Question 2?
In `agent/src/main.ts`, the logic inside `askNextQuestion()` is wrapped in a `try...catch` block:

```javascript
try {
  const question = questions[currentQuestionIndex];
  await session.generateReply({
    instructions: `Give a brief, natural one-sentence acknowledgment of the candidate's previous answer, then ask this exact question: "${question}".`
  });
} catch (err) {
  console.error('Failed to ask question, retrying once...', err);
  try {
    const question = questions[currentQuestionIndex];
    if (question) {
      await session.generateReply({ instructions: `Please ask: "${question}"` });
    }
  } catch (retryErr) {
    console.error('Retry also failed, moving on', retryErr);
  }
}
```

1. **State Preservation**: `currentQuestionIndex` is **NOT** incremented during the error. It remains pointing to Question 2 (index 1).
2. **Single Retry Attempt**: The catch block attempts a single retry using simplified fallback instructions (`Please ask: "<question>"`).
3. **Graceful Degradation**: If retry succeeds, candidate hears Question 2 and interview continues normally. If retry also fails, error is logged and state remains consistent without crashing the process.

---

## 13. Error Handling

### 1. Missing Environment Variables
- **What can go wrong**: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, or provider keys are missing.
- **Current implementation**: Express server (`server/index.js`) logs error during startup or room creation. Agent worker fails fast during startup with explicit dotenv validation errors.
- **Future improvement**: Add upfront schema validation (e.g. Zod `.parse(process.env)`) on startup.

### 2. Backend Token Server Failures
- **What can go wrong**: Backend server is offline or unreachable on port 4000.
- **Current implementation**: Frontend `SetupForm.tsx` catches fetch error and alerts user: `"Failed to start interview. Check if the token server is running."`
- **Future improvement**: Add retry logic and toast notifications on frontend.

### 3. LiveKit Connection Failure
- **What can go wrong**: Invalid token, invalid URL, or network drops WebRTC connection.
- **Current implementation**: `<InterviewRoom>` catches disconnection and calls `onDisconnect()`, transitioning UI to `<ResultsScreen>`. Visualizer displays `"Disconnected"`.
- **Future improvement**: Add reconnecting state indicator and auto-reconnect attempt.

### 4. Speech-to-Text (STT) Failure
- **What can go wrong**: Deepgram fails to transcribe noisy or unclear candidate speech.
- **Current implementation**: Candidate speech yields no user item. 10-second silence timer (`startSilenceTimer()`) fires and prompts candidate: `"The candidate has been quiet for a moment. Gently ask if they are ready..."`
- **Future improvement**: Add audio input level warning on UI if mic volume is too low.

### 5. LLM (Gemini) / TTS (Cartesia) Failure
- **What can go wrong**: Rate limits, quota exhaustion, or service outages.
- **Current implementation**: Wrapped in `try...catch` in `askNextQuestion()`. Retries generation once with simpler prompt without advancing `currentQuestionIndex`.
- **Future improvement**: Fallback to secondary provider (e.g. fallback to OpenAI if Gemini fails).

### 6. Candidate Disconnect Early
- **What can go wrong**: Candidate closes browser tab or drops network connection mid-interview.
- **Current implementation**: `ctx.room.on('participantDisconnected')` listener catches event in `agent/src/main.ts`, posts partial transcript with status `"Incomplete"` to backend, and shuts down agent worker cleanly (`await ctx.shutdown()`).
- **Future improvement**: Allow candidate to resume incomplete session using a session token.

---

## 14. Environment Variables

### `.env.example` Reference

```env
LIVEKIT_URL=wss://<your-project>.livekit.cloud
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
DEEPGRAM_API_KEY=
GOOGLE_API_KEY=
CARTESIA_API_KEY=
PORT=4000
```

### Detailed Breakdown

| Variable | Description | Where Used | Security Level |
| :--- | :--- | :--- | :--- |
| `LIVEKIT_URL` | WebSocket URL for LiveKit Cloud server | Server, Agent, Frontend | Public / Config |
| `LIVEKIT_API_KEY` | Public key identifier for LiveKit project | Server, Agent | **Secret** (Server-only) |
| `LIVEKIT_API_SECRET` | Secret key used to sign JWT tokens & room actions | Server, Agent | **STRICT SECRET** (Server-only) |
| `DEEPGRAM_API_KEY` | API Key for Deepgram STT transcription | Agent (`agent/src/main.ts`) | **Secret** (Agent-only) |
| `GOOGLE_API_KEY` | API Key for Google Gemini LLM model | Agent (`agent/src/main.ts`) | **Secret** (Agent-only) |
| `CARTESIA_API_KEY` | API Key for Cartesia TTS voice synthesis | Agent (`agent/src/main.ts`) | **Secret** (Agent-only) |
| `PORT` | Express server port number (default: 4000) | Server (`server/index.js`) | Local Config |

### Security Rules
1. **Never Commit Secret Keys**: `.env` and `.env.local` files are listed in `.gitignore` so secrets are never pushed to public GitHub repositories.
2. **Never Expose Secret Keys to Client**: `LIVEKIT_API_SECRET`, `GOOGLE_API_KEY`, `DEEPGRAM_API_KEY`, and `CARTESIA_API_KEY` must never be prefixed with `NEXT_PUBLIC_` or imported in frontend files.

---

## 15. Project Folder Structure

```
ai-interview-agent/               # Project Root Directory
├── .env.example                  # Root environment variable template
├── README.md                     # Project overview and setup instructions
├── study.md                      # Detailed technical study guide
├── agent/                        # AI Agent Worker Microservice
│   ├── package.json              # Agent dependencies (@livekit/agents, deepgram, google, cartesia)
│   └── src/
│       ├── agent.ts              # Custom Agent helper definition
│       └── main.ts               # Primary Agent entry point, state machine & event listeners
├── server/                       # Token Server & Backend API Microservice
│   ├── package.json              # Server dependencies (express, cors, livekit-server-sdk)
│   └── index.js                  # Express API routes (/api/token, /api/results) & room dispatch logic
└── frontend/                     # Next.js User Interface
    ├── package.json              # Frontend dependencies (next, react, @livekit/components-react)
    ├── app/
    │   ├── page.tsx              # Main Next.js Page (manages setup -> interviewing -> results state)
    │   ├── layout.tsx            # Global HTML Root Layout
    │   └── api/token/route.ts    # Next.js internal token route (optional fallback)
    └── components/
        └── ai-interview/
            ├── SetupForm.tsx     # Setup Form component (collects candidate info & questions)
            ├── InterviewRoom.tsx # Active Interview WebRTC component (LiveKitRoom & BarVisualizer)
            └── ResultsScreen.tsx # Results screen component (polls backend & renders transcript)
```

---

## 16. Important Design Decisions

### 1. Three Microservices Architecture (Frontend + Backend + Agent)
- **Why we chose it**: Clean separation of concerns. Frontend handles browser UI; Server handles authentication, token issuance, and persistence; Agent runs heavy server-side voice AI processing loops.
- **Alternatives**: Monolithic Next.js app running agent in API route.
- **Why suitable**: Agent worker requires long-running WebSocket connections to LiveKit Cloud, which serverless Next.js API routes cannot sustain.

### 2. LiveKit for WebRTC Audio Streaming
- **Why we chose it**: Provides sub-second real-time audio routing and official `@livekit/agents` framework.
- **Alternatives**: HTTP polling, WebSockets, or Twilio Programmable Voice.
- **Why suitable**: Delivers sub-100ms transport latency necessary for fluid, natural human-AI voice conversations.

### 3. Deepgram `nova-3` for STT
- **Why we chose it**: Best-in-class real-time streaming speech transcription speed and accuracy over WebRTC.
- **Alternatives**: OpenAI Whisper or Google Speech-to-Text.
- **Why suitable**: Real-time streaming model prevents multi-second delays between user speech finish and transcription.

### 4. Google Gemini (`gemini-3.6-flash`) for LLM
- **Why we chose it**: Extremely low time-to-first-token (TTFT) and precise instruction adherence.
- **Alternatives**: OpenAI GPT-4o-mini or Anthropic Claude Haiku.
- **Why suitable**: Fast text token generation reduces total conversational turn-around time.

### 5. Cartesia for TTS
- **Why we chose it**: Ultra-low latency streaming voice synthesis.
- **Alternatives**: ElevenLabs or OpenAI TTS.
- **Why suitable**: Begins streaming audio frames back to candidate before the full sentence finishes generating.

### 6. Explicit Code-Based State Machine (`currentQuestionIndex`)
- **Why we chose it**: Application code tracks index explicitly rather than relying on LLM memory.
- **Alternatives**: Full LLM-driven prompt state.
- **Why suitable**: Guarantees deterministic question progression and fault tolerance during LLM retries.

---

## 17. Limitations

1. **In-Memory Storage**: Express server (`server/index.js`) stores interview results in a JavaScript object (`interviewResults`). Restarting the server clears stored results.
2. **Local Agent Dispatch**: Agent worker runs locally on developer machine. If worker process dies, pending interview dispatches will not connect.
3. **Basic LLM Retry**: The agent attempts a single retry on `generateReply` failure. If second attempt fails, error is logged without failing over to another LLM provider.
4. **Polling for Results**: Frontend `ResultsScreen.tsx` polls backend via `setInterval` every 2 seconds instead of using real-time WebSockets or push notifications.
5. **Egress Storage Requirement**: Room composite audio recording (`recordings/<roomName>.mp4`) requires an S3 or GCS bucket configured in LiveKit Cloud project settings. Without cloud storage configured, local playback falls back to transcript text.

---

## 18. Future Improvements

1. **Database Integration**: Replace in-memory `interviewResults` with PostgreSQL/Prisma or MongoDB to permanently store candidate transcripts and evaluation scores.
2. **AI Answer Evaluation**: Add a post-interview evaluation step using Gemini to automatically score candidate answers against ideal rubric criteria.
3. **Multi-Tenant Authentication**: Add authentication (e.g. NextAuth or Clerk) so recruiters can log in, view dashboards, and manage job role templates.
4. **WebSocket/Webhook Result Pushing**: Replace client HTTP polling with WebSocket events or LiveKit Webhooks.
5. **Streaming Real-Time Transcript UI**: Stream candidate and AI transcript text to frontend UI in real time during the active interview.

---

## 19. Interview Questions and Answers

### Basic Project Questions

#### Question: Can you explain this project from start to end?
- **Short Interview Answer**: "This project is an automated AI Voice Interviewer. A candidate enters their details and questions on a Next.js frontend. The frontend calls an Express backend which creates a LiveKit WebRTC room, dispatches a Node.js AI Agent, and returns a secure token. The candidate joins the room via browser audio. The AI agent greets them and asks pre-configured questions sequentially. Candidate speech is transcribed by Deepgram STT, processed by Google Gemini LLM, and synthesized into natural voice by Cartesia TTS. An explicit state variable (`currentQuestionIndex`) tracks question progress. When complete, the transcript and duration are saved to the backend and displayed on the results screen."
- **Detailed Explanation**: Refer to Section 4 (System Flow Step by Step) and Section 3 (Complete Architecture).

---

### Architecture Questions

#### Question: Why did you choose a three-tier microservices architecture (Frontend, Backend, Agent) instead of putting everything in Next.js?
- **Short Interview Answer**: "We separated frontend, backend, and agent because of their runtime requirements. The Next.js frontend handles browser UI. The Express backend securely manages API keys, creates rooms, and generates JWT tokens. The Node.js agent worker runs a persistent WebRTC connection loop to process heavy voice pipelines (STT, LLM, TTS). Next.js API routes are serverless and short-lived, so they cannot host long-running WebRTC worker sessions."
- **Detailed Explanation**: Serverless functions (like Next.js API routes) terminate after a few seconds and cannot maintain persistent WebSocket/WebRTC connections required by LiveKit worker agents.

---

### Frontend Questions

#### Question: How does the frontend display real-time audio visualization while the AI is speaking?
- **Short Interview Answer**: "The frontend uses `@livekit/components-react`. The `<InterviewRoom>` component wraps `<LiveKitRoom>`, providing context to `useVoiceAssistant()`. This hook provides the active audio track and voice state (`listening`, `speaking`). We pass these into `<BarVisualizer>`, which renders 7 animated canvas/SVG bars that react directly to real-time audio track volume frequencies."
- **Detailed Explanation**: Refer to Section 5 (`InterviewRoom.tsx` & `BarVisualizer`).

---

### Backend Questions

#### Question: Why do we generate tokens on the Express backend instead of the frontend?
- **Short Interview Answer**: "LiveKit tokens must be signed using `LIVEKIT_API_SECRET`. Storing this secret key on the frontend would expose it in browser bundle files, allowing anyone to steal administrative access to our LiveKit account. Generating tokens on the backend keeps secrets private and issues short-lived, restricted JWTs to the client."
- **Detailed Explanation**: Refer to Section 6 (Backend Security Principles).

---

### LiveKit Questions

#### Question: What is LiveKit and how does the AI Agent join the room?
- **Short Interview Answer**: "LiveKit is a WebRTC infrastructure platform for real-time audio/video. When the Express backend receives a start request, it calls `dispatchSvc.createDispatch(roomName, 'agent')`. LiveKit Cloud registers this dispatch request and routes it to our running Node.js agent worker. The worker executes `ctx.connect()`, joining the room as an audio participant."
- **Detailed Explanation**: Refer to Section 7 (LiveKit Explained) and Section 8 (AI Agent Explained).

---

### AI Agent Questions

#### Question: What does the `prewarm` function do in the Agent code?
- **Short Interview Answer**: "The `prewarm` function pre-loads heavy models—specifically Silero VAD (Voice Activity Detection)—ONCE when the agent worker process boots up. Loading models on worker startup ensures that when an individual candidate joins a room, session initialization is instantaneous."
- **Detailed Explanation**: Refer to Section 8 (`prewarm` phase in `agent/src/main.ts`).

---

### Deepgram Questions

#### Question: Why did you choose Deepgram for Speech-to-Text over other providers?
- **Short Interview Answer**: "Deepgram was chosen for its streaming real-time performance and low word error rate. Using the `nova-3` model via `@livekit/agents-plugin-deepgram`, it transcribes continuous WebRTC audio streams with sub-200ms latency, enabling natural conversational turn-taking."
- **Detailed Explanation**: Refer to Section 9 (Deepgram STT).

---

### Gemini Questions

#### Question: Why is Google Gemini used in this project instead of OpenAI?
- **Short Interview Answer**: "We intentionally integrated Google Gemini (`gemini-3.6-flash`) because of its low time-to-first-token (TTFT) latency, strong system instruction adherence, and cost efficiency. It processes candidate answer context quickly and formats exact question prompts without generating extra unauthorized follow-up questions."
- **Detailed Explanation**: Refer to Section 10 (LLM Gemini).

---

### Cartesia Questions

#### Question: How does Text-to-Speech audio reach the candidate?
- **Short Interview Answer**: "When Gemini generates response text, the agent passes it to Cartesia TTS (`@livekit/agents-plugin-cartesia`). Cartesia converts text into real-time audio frames and streams them into the LiveKit room WebRTC audio track. The candidate's browser plays this audio via `<RoomAudioRenderer>`."
- **Detailed Explanation**: Refer to Section 11 (Cartesia TTS).

---

### State Management Questions

#### Question: Why is interview state (`currentQuestionIndex`) tracked in code instead of inside the LLM prompt context?
- **Short Interview Answer**: "Tracking state in explicit application code makes the interview 100% deterministic. Relying on an LLM to remember question progression leads to skipped questions, duplicated questions, or unscripted follow-up probing. Tracking index in code ensures exact question ordering and allows graceful error recovery if an LLM call fails."
- **Detailed Explanation**: Refer to Section 12 (Interview State Management).

---

### Error Handling Questions

#### Question: What happens if the LLM call fails while processing Question 2?
- **Short Interview Answer**: "In `agent/src/main.ts`, the call to `session.generateReply()` inside `askNextQuestion()` is wrapped in a `try...catch` block. If Gemini fails or times out, the error is caught, `currentQuestionIndex` is **not** incremented, and a single retry attempt is executed with a simple fallback prompt. This preserves the interview state without skipping Question 2."
- **Detailed Explanation**: Refer to Section 12 & 13 (`askNextQuestion()` failure handling).

---

### Security Questions

#### Question: How does this project prevent API key exposure and unauthorized usage?
- **Short Interview Answer**: "All API keys (`LIVEKIT_API_SECRET`, `GOOGLE_API_KEY`, `DEEPGRAM_API_KEY`, `CARTESIA_API_KEY`) are stored in server-side `.env` files that are ignored by `.gitignore`. The client frontend only receives short-lived, single-room JWT access tokens created by the Express backend."
- **Detailed Explanation**: Refer to Section 14 (Environment Variables & Security Rules).

---

### Scenario-Based Questions

#### Question: What happens if a candidate disconnects their browser mid-interview?
- **Short Interview Answer**: "The agent worker listens to `ctx.room.on('participantDisconnected')`. When the candidate leaves, the listener calculates elapsed duration, posts the partial transcript collected so far to `/api/results/:roomName` with status `'Incomplete'`, and calls `ctx.shutdown()` to free server resources."
- **Detailed Explanation**: Refer to Section 8 & Section 13 (Candidate Disconnect).

#### Question: What would happen if the Express backend server was removed?
- **Short Interview Answer**: "Without the Express backend, the frontend would have to store master LiveKit API secrets to create rooms and issue tokens, creating a massive security vulnerability. Additionally, there would be no server endpoint to save or retrieve interview results."
- **Detailed Explanation**: Refer to Section 6 (Backend Explained).

#### Question: What is the biggest limitation of the current implementation and how would you fix it?
- **Short Interview Answer**: "The biggest limitation is in-memory result storage in `server/index.js`, meaning server restarts erase interview records. I would fix this by replacing the JavaScript object with a PostgreSQL database managed via Prisma ORM and adding S3 bucket storage for audio recordings."
- **Detailed Explanation**: Refer to Section 17 (Limitations) and Section 18 (Future Improvements).
