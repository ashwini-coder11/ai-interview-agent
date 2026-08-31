# AI Interview Agent

## Setup

### Prerequisites

- Node.js >= 20 (Node.js 24 recommended as specified in package engines)
- A LiveKit Cloud account
- Required API keys:
  - Deepgram API key (`DEEPGRAM_API_KEY`)
  - Google Gemini API key (`GOOGLE_API_KEY`)
  - Cartesia API key (`CARTESIA_API_KEY`)

*Note: This implementation intentionally uses Google Gemini (`gemini-3.6-flash`) as the LLM provider instead of OpenAI.*

### Installation

Install dependencies for each service from its respective directory:

```bash
# Agent
cd agent
npm install

# Server
cd server
npm install

# Frontend
cd frontend
npm install
```

## Environment Variables

A single, unified `.env` file in the root directory is used across all services (`server`, `agent`, and `frontend`). To set up your environment, copy `.env.example` in the root directory to `.env`:

```bash
cp .env.example .env
```

Environment variables configured in `.env`:

```env
# LiveKit Server Configuration
LIVEKIT_URL=wss://<project-subdomain>.livekit.cloud
LIVEKIT_API_KEY=<your_livekit_api_key>
LIVEKIT_API_SECRET=<your_livekit_api_secret>

# Express Token Server Configuration
PORT=4000

# AI Agent Service API Keys
DEEPGRAM_API_KEY=<your_deepgram_api_key>
GOOGLE_API_KEY=<your_google_api_key>
CARTESIA_API_KEY=<your_cartesia_api_key>

# Frontend Configuration
NEXT_PUBLIC_LIVEKIT_URL=wss://<project-subdomain>.livekit.cloud
NEXT_PUBLIC_TOKEN_SERVER_URL=http://localhost:4000
```

- `LIVEKIT_URL`: WebSocket URL of your LiveKit server or LiveKit Cloud project.
- `LIVEKIT_API_KEY`: API Key for authenticating with LiveKit.
- `LIVEKIT_API_SECRET`: API Secret for signing LiveKit access tokens and agent dispatch requests.
- `PORT`: Port number for the Express token server (defaults to 4000).
- `DEEPGRAM_API_KEY`: API Key for Deepgram speech-to-text (STT).
- `GOOGLE_API_KEY`: API Key for Google Gemini LLM services.
- `CARTESIA_API_KEY`: API Key for Cartesia text-to-speech (TTS).
- `NEXT_PUBLIC_LIVEKIT_URL`: WebSocket URL exposed to the frontend browser.
- `NEXT_PUBLIC_TOKEN_SERVER_URL`: Express token server URL for frontend API calls.

## Running the Project

Start the three development services in order using separate terminal windows. All three services must be running for the AI interview agent to work.

**Terminal 1: Agent**
```bash
cd agent
npm run dev
```

**Terminal 2: Server**
```bash
cd server
node index.js
```

**Terminal 3: Frontend**
```bash
cd frontend
npm run dev
```

# Architecture

```
Frontend (Next.js)
        ↓
Token Server (Express)
        ↓
LiveKit Room
        ↓
AI Agent (Node.js)
        ↓
STT (Deepgram)
        ↓
LLM (Gemini)
        ↓
TTS (Cartesia)
        ↓
LiveKit Room
        ↓
Frontend (Next.js)
```

**How it works:**
1. **Frontend**: Candidate enters details (name, job title, questions) and joins the interview session.
2. **Token Server**: Creates a LiveKit room with metadata, dispatches the AI agent, and returns a JWT access token to the frontend.
3. **LiveKit Room**: Handles real-time WebRTC audio communication between the candidate and the agent worker.
4. **AI Agent**: Orchestrates the speech pipeline—converting candidate speech to text, generating questions/responses with Gemini, and synthesizing audio back to the candidate with Cartesia.

# AI Providers

### STT: Deepgram

- **Model**: Deepgram `nova-3` (via `@livekit/agents-plugin-deepgram`)
- **Role**: Converts candidate voice audio into text in real time.
- **Why**: Deepgram `nova-3` offers ultra-low latency streaming transcription essential for smooth voice interactions.

### LLM: Gemini

- **Model**: Google Gemini `gemini-3.6-flash` (via `@livekit/agents-plugin-google`)
- **Role**: Processes the interview prompt, candidate answers, and generates interview questions and brief acknowledgments.
- **Why**: Gemini `gemini-3.6-flash` provides fast response generation, accurate instruction following, and low latency for real-time conversational flows. *(Replaces the OpenAI provider mentioned in original guides).*

### TTS: Cartesia

- **Model**: Cartesia TTS (via `@livekit/agents-plugin-cartesia`)
- **Role**: Converts the agent's text responses into natural-sounding spoken audio.
- **Why**: Delivers low-latency audio streaming suitable for voice agent conversations.

# Interview Flow

The AI agent manages the interview deterministically through an explicit state machine in `agent/src/main.ts`:

1. **Session Initialization**: The Express server creates a room with metadata containing `candidateName`, `jobTitle`, and `questions`. The agent worker joins the room, parses metadata, and initializes state (`currentQuestionIndex = 0`, `transcript = []`, `isAskingQuestion = false`).
2. **Question 1 Prompt**: The agent calls `askNextQuestion()`. For index 0, it greets the candidate and asks the first question.
3. **Candidate Response**: The candidate speaks. Audio is transcribed via Deepgram STT.
4. **Event Detection & Advancement**: The agent listens for `voice.AgentSessionEventTypes.ConversationItemAdded`. When a user item is added (`event.item.role === 'user'`), the agent increments `currentQuestionIndex += 1` and invokes `askNextQuestion()`.
5. **Subsequent Questions**: For subsequent questions, the agent delivers a brief 1-sentence acknowledgment of the candidate's previous response, followed by the next question in the `questions` array.
6. **Silence Handling**: If the candidate remains silent for 10 seconds while waiting, an `AgentStateChanged` timer triggers a gentle check-in prompt asking if they are ready or need the question repeated.
7. **Session Completion**: When `currentQuestionIndex >= questions.length`, the agent speaks a warm closing message, posts the transcript and session duration with status `"Completed"` to the token server (`/api/results/:roomName`), waits 4 seconds for TTS playback, and gracefully disconnects from the room.

# Failure Handling

### STT Failure

- Handled by voice activity detection (Silero VAD) and state event listeners. If speech is misheard or fails to generate text, the 10-second silence timer acts as a fallback to ask the candidate if they'd like to repeat their answer.

### LLM Failure

- Calls to `session.generateReply()` in `askNextQuestion()` are wrapped in a `try...catch` block.
- If an LLM call fails, the catch block logs the error and attempts a single retry with simple instructions (`Please ask: "<question>"`).
- `currentQuestionIndex` is preserved during the failure and retry, ensuring the interview does not skip questions or advance prematurely.

### TTS Failure

- TTS synthesis errors during `generateReply()` trigger the `try...catch` block in `askNextQuestion()`, falling back to the retry mechanism to preserve interview state.

### Candidate Disconnect

- The agent registers a `ctx.room.on('participantDisconnected', ...)` handler.
- If the candidate disconnects early, the handler captures the partial transcript, posts it to the token server with status `"Incomplete"`, and cleanly shuts down the agent session (`await ctx.shutdown()`).

# Problem-Solving Question

## Why is interview state tracked outside the LLM?

Interview state (`currentQuestionIndex`) is tracked explicitly in code outside the LLM for the following reasons:

1. **Separation of Concerns**: The LLM's role is natural language processing and generation, while the application code controls deterministic interview logic and session state.
2. **Deterministic Question Ordering**: Relying solely on the LLM to remember which question to ask next can lead to skipped questions, repeated questions, or hallucinated follow-ups. Explicit state guarantees questions are asked in the exact predefined sequence.
3. **Fault Tolerance and State Preservation**: If an LLM API call fails, times out, or requires a retry, tracking `currentQuestionIndex` in code ensures the active question index is preserved. The system will retry the current question rather than blindly advancing to the next index.
4. **Reliable Session Persistence**: Application-managed state enables accurate tracking of partial transcripts, session durations, and completion statuses (`Completed` vs. `Incomplete`) regardless of LLM context limits or network dropouts.
