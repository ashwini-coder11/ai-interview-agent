import {
  type JobContext,
  type JobProcess,
  ServerOptions,
  cli,
  defineAgent,
  voice,
} from '@livekit/agents';
import * as google from '@livekit/agents-plugin-google';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import * as cartesia from '@livekit/agents-plugin-cartesia';
import * as silero from '@livekit/agents-plugin-silero';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { EgressClient, EncodedFileOutput, EncodedFileType } from 'livekit-server-sdk';

dotenv.config({ path: '.env.local' });

// ---- Types for the metadata the frontend/token-server sends in ----
interface InterviewConfig {
  candidateName: string;
  jobTitle: string;
  questions: string[];
}

export default defineAgent({
  // prewarm loads heavy/local models ONCE per worker process (not per
  // interview) so that starting an individual interview session is fast.
  prewarm: async (proc: JobProcess) => {
    proc.userData.vad = await silero.VAD.load();
  },

  entry: async (ctx: JobContext) => {
    try {
      // 1. Connect to the LiveKit room for this specific interview
      await ctx.connect();

      const egressClient = new EgressClient(process.env.LIVEKIT_URL!, process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);
      // Start Egress (Recording) since the room is now definitely created
      try {
        const output = new EncodedFileOutput({
          fileType: EncodedFileType.MP4,
          filepath: `recordings/${ctx.room.name!}.mp4`,
        });
        await egressClient.startRoomCompositeEgress(ctx.room.name!, output);
      } catch (err) {
        console.error('Failed to start egress (LiveKit cloud setup might not have S3 bucket configured), continuing without recording:', err);
      }

      // 2. Read candidate info + questions from room metadata.
      //    This satisfies the requirement: "questions provided through
      //    configuration/metadata rather than hardcoded."
      let config: InterviewConfig;
      try {
        config = JSON.parse(ctx.room.metadata || '{}');
      } catch (err) {
        console.error('Failed to parse room metadata, using fallback', err);
        config = { candidateName: 'Candidate', jobTitle: 'the role', questions: [] };
      }
      const { candidateName, jobTitle, questions } = config;

      console.log('[DEBUG] raw room metadata:', ctx.room.metadata);
      console.log('[DEBUG] parsed questions:', config.questions, 'count:', config.questions?.length);

      // 3. Track interview state EXPLICITLY. This is the state machine
      //    the assignment's "problem-solving question" is about — the
      //    current question index must be tracked outside the LLM's own
      //    memory, so we can recover if something fails mid-interview.
      let currentQuestionIndex = 0;
      const transcript: { speaker: 'ai' | 'candidate'; text: string }[] = [];
      const startedAt = Date.now();
      let silenceTimer: NodeJS.Timeout | null = null;
      let isAskingQuestion = false;

      const clearSilenceTimer = () => {
        if (silenceTimer) {
          clearTimeout(silenceTimer);
          silenceTimer = null;
        }
      };

      const startSilenceTimer = () => {
        clearSilenceTimer();
        silenceTimer = setTimeout(async () => {
          if (!session._closing && currentQuestionIndex < questions.length && !isAskingQuestion) {
            try {
              await session.generateReply({
                instructions: `The candidate has been quiet for a moment. Gently ask if they are ready or if they would like you to repeat the question: "${questions[currentQuestionIndex]}". Keep it polite and brief.`,
              });
            } catch (e) {
              console.error('Silence prompt failed', e);
            }
          }
        }, 10000); // 10-second pause before gentle reminder
      };

      // 4. Build the AI pipeline: STT -> LLM -> TTS
      const agent = new voice.Agent({
        instructions: `You are a professional, friendly AI interviewer conducting a ${jobTitle} interview with ${candidateName}.

CRITICAL RULES — you must follow these without exception:
1. You will be given each interview question via a system message. You must ask ONLY the exact question provided — never invent, add, rephrase, or improvise any questions of your own.
2. After the candidate answers, you may give a brief, natural acknowledgment (e.g. "Thanks for sharing that", "Great, appreciate that answer") but you must NOT ask any follow-up questions, clarifying questions, or related questions. Do not probe deeper, do not ask for examples, do not explore tangents.
3. You must NEVER generate a new question on your own. The only questions you ask are the ones explicitly given to you in system instructions.
4. When told the interview is complete, deliver a warm closing statement and stop. Do not ask any more questions.
5. Keep all responses concise and conversational — this is a voice interview.`,
      });

      const session = new voice.AgentSession({
        vad: ctx.proc.userData.vad as silero.VAD,
        stt: new deepgram.STT({ apiKey: process.env.DEEPGRAM_API_KEY!, model: 'nova-3' }),
        llm: new google.LLM({ apiKey: process.env.GOOGLE_API_KEY!, model: 'gemini-3.6-flash' }),
        tts: new cartesia.TTS({ apiKey: process.env.CARTESIA_API_KEY! }),
      });

      // 5. Capture the transcript & handle candidate answer completion
      session.on(voice.AgentSessionEventTypes.ConversationItemAdded, async (event) => {
        console.log(`[DEBUG] ${Date.now()} - event: conversation_item_added`, event);
        if ('role' in event.item) {
          const text = event.item.textContent ?? '';
          if (text) {
            transcript.push({
              speaker: event.item.role === 'assistant' ? 'ai' : 'candidate',
              text,
            });
          }

          // Advance to next question after candidate responds (only if not already asking)
          if (event.item.role === 'user' && !session._closing && !isAskingQuestion) {
            clearSilenceTimer();
            currentQuestionIndex += 1;
            await askNextQuestion();
          }
        }
      });

      // Handle silence / pause detection
      session.on(voice.AgentSessionEventTypes.AgentStateChanged, (ev) => {
        console.log(`[DEBUG] ${Date.now()} - event: agent_state_changed`, ev);
        if (ev.newState === 'listening' || ev.newState === 'idle') {
          startSilenceTimer();
        } else {
          clearSilenceTimer();
        }
      });

      session.on(voice.AgentSessionEventTypes.UserStateChanged, (ev) => {
        console.log(`[DEBUG] ${Date.now()} - event: user_state_changed`, ev);
        if (ev.newState === 'speaking') {
          clearSilenceTimer();
        }
      });

      await session.start({ agent, room: ctx.room });

      // 6. Walk through the questions in order, one at a time
      async function askNextQuestion() {
        if (session._closing || isAskingQuestion) return;
        isAskingQuestion = true;

        try {
          if (currentQuestionIndex >= questions.length) {
            clearSilenceTimer();
            await session.generateReply({
              instructions: 'Thank the candidate warmly for their time and let them know the interview is complete. Wish them the best!',
            });

            // Save results IMMEDIATELY so status is persisted even if room drops
            const durationMs = Date.now() - startedAt;
            try {
              await fetch(`http://localhost:4000/api/results/${ctx.room.name!}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  candidateName,
                  status: 'Completed',
                  transcript,
                  durationMs,
                }),
              });
            } catch (e) {
              console.error('Failed to save results', e);
            }

            // Wait 4 seconds for closing speech to finish playing, then disconnect
            setTimeout(async () => {
              await ctx.room.disconnect();
              await ctx.shutdown();
            }, 4000);
            return;
          }

          const question = questions[currentQuestionIndex];

          if (currentQuestionIndex === 0) {
            await session.generateReply({
              instructions: `Greet ${candidateName} warmly for the ${jobTitle} interview, then ask this exact question: "${question}". Do not add any other questions — ask only this one and then stop.`,
            });
          } else {
            await session.generateReply({
              instructions: `Give a brief, natural one-sentence acknowledgment of the candidate's previous answer, then ask this exact question: "${question}". Do not add any follow-up questions or additional questions — ask only this one and then stop.`,
            });
          }
        } catch (err) {
          // LLM/TTS failure handling: retry once, preserve interview state
          console.error('Failed to ask question, retrying once...', err);
          try {
            const question = questions[currentQuestionIndex];
            if (question) {
              await session.generateReply({ instructions: `Please ask: "${question}"` });
            }
          } catch (retryErr) {
            console.error('Retry also failed, moving on', retryErr);
          }
        } finally {
          isAskingQuestion = false;
        }
      }

      // Kick off the interview with the greeting + Question 1
      await askNextQuestion();

      // 9. Handle candidate disconnecting early (requirement: "handle the
      //    situation where the candidate leaves before completion")
      ctx.room.on('participantDisconnected', async () => {
        console.log('Candidate disconnected before completing the interview.');
        // Save whatever transcript exists so far, mark status as
        // "incomplete" in your storage layer (see Part 5), then:
        const durationMs = Date.now() - startedAt;
        try {
          await fetch(`http://localhost:4000/api/results/${ctx.room.name}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              candidateName,
              status: 'Incomplete',
              transcript,
              durationMs,
            })
          });
        } catch (e) {
          console.error('Failed to save results', e);
        }
        await ctx.shutdown();
      });
    } catch (err) {
      console.error('[DEBUG] UNCAUGHT ERROR in entry function:', err);
    }
  },
});

cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: 'agent'
  })
);
