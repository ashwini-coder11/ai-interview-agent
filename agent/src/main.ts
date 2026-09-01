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
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { EgressClient, EncodedFileOutput, EncodedFileType, RoomServiceClient } from 'livekit-server-sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: [path.resolve(__dirname, '../../.env'), path.resolve(__dirname, '../.env.local'), '.env.local', '.env'] });

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
      const candidateName = config.candidateName || 'Candidate';
      const jobTitle = config.jobTitle || 'the role';
      const questions = config.questions || [];

      console.log('[DEBUG] raw room metadata:', ctx.room.metadata);
      console.log('[DEBUG] parsed questions:', config.questions, 'count:', config.questions?.length);

      // 3. Track interview state EXPLICITLY.
      let currentQuestionIndex = 0;
      let isAskingQuestion = false;
      let userHasSpoken = false;
      let eouTimer: NodeJS.Timeout | null = null;
      let noAnswerTimer: NodeJS.Timeout | null = null;
      const EOU_DELAY_MS = 1500; // 1.5 seconds of silence means they are done speaking

      const transcript: { speaker: 'ai' | 'candidate'; text: string }[] = [];
      const startedAt = Date.now();
      let silenceTimer: NodeJS.Timeout | null = null;
      let interviewCompleted = false;
      let resultsSaved = false;

      // Track which conversation item IDs we've already processed to
      // prevent duplicate ConversationItemAdded events from double-
      // incrementing the question index.
      const processedUserItemIds = new Set<string>();

      const clearNoAnswerTimer = () => {
        if (noAnswerTimer) {
          clearTimeout(noAnswerTimer);
          noAnswerTimer = null;
        }
      };

      const startNoAnswerTimer = () => {
        clearNoAnswerTimer();
        noAnswerTimer = setTimeout(async () => {
          if (!interviewCompleted && !isAskingQuestion) {
            console.log('[DEBUG] No answer in 30 seconds. Ending interview.');
            interviewCompleted = true;
            await saveResults('Timeout (No Answer)');
            try {
              const roomName = ctx.room.name!;
              await ctx.room.disconnect();
              await ctx.shutdown();
              const roomSvc = new RoomServiceClient(process.env.LIVEKIT_URL!, process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);
              await roomSvc.deleteRoom(roomName);
            } catch (e) {
              console.error('Error during timeout disconnect', e);
            }
          }
        }, 30000); // 30 seconds timeout
      };

      const clearSilenceTimer = () => {
        if (silenceTimer) {
          clearTimeout(silenceTimer);
          silenceTimer = null;
        }
      };

      const startSilenceTimer = () => {
        clearSilenceTimer();
        silenceTimer = setTimeout(async () => {
          if (!interviewCompleted && currentQuestionIndex < questions.length && !isAskingQuestion) {
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

      // Helper: save results to the token server
      async function saveResults(status: string) {
        if (resultsSaved) return;
        resultsSaved = true;
        const durationMs = Date.now() - startedAt;

        // Build the final transcript directly from the agent's full chat context
        const finalTranscript = session.chatCtx.items
          .filter((m: any) => m.type === 'message' && (m.role === 'user' || m.role === 'assistant'))
          .map((m: any) => ({
            speaker: m.role === 'assistant' ? 'ai' : 'candidate',
            text: m.textContent || ''
          }))
          .filter((m: any) => m.text.trim() !== '');

        console.log(`[DEBUG] Saving results: status=${status}, transcript entries=${finalTranscript.length}, durationMs=${durationMs}`);
        try {
          await fetch(`http://localhost:4000/api/results/${ctx.room.name!}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              candidateName,
              status,
              transcript: finalTranscript,
              durationMs,
            }),
          });
          console.log('[DEBUG] Results saved successfully');
        } catch (e) {
          console.error('Failed to save results', e);
          resultsSaved = false; // allow retry
        }
      }

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
        turnHandling: {
          turnDetection: 'manual',
        },
      });

      // 5. Capture the transcript & handle candidate answer completion
      session.on(voice.AgentSessionEventTypes.ConversationItemAdded, async (event) => {
        if (!('role' in event.item)) return;

        const itemId = event.item.id;
        const text = event.item.textContent ?? '';

        console.log(`[DEBUG] conversation_item_added: role=${event.item.role}, id=${itemId}, text="${text?.substring(0, 60)}..."`);

        // Store transcript for both AI and candidate messages
        if (text) {
          transcript.push({
            speaker: event.item.role === 'assistant' ? 'ai' : 'candidate',
            text,
          });
        }

        // Only record that the user has spoken (turn advancement handled by VAD EOU)
        if (event.item.role === 'user' && !interviewCompleted && !isAskingQuestion) {
          if (text && text.trim().length > 0) {
            userHasSpoken = true;
          }
        }
      });

      // Handle silence / pause detection
      session.on(voice.AgentSessionEventTypes.AgentStateChanged, (ev) => {
        if (ev.newState === 'listening' || ev.newState === 'idle') {
          startSilenceTimer();
        } else {
          clearSilenceTimer();
        }
      });

      session.on(voice.AgentSessionEventTypes.UserStateChanged, (ev) => {
        if (ev.newState === 'speaking') {
          userHasSpoken = true;
          clearSilenceTimer();
          clearNoAnswerTimer(); // User started answering, clear the 30s timeout
          if (eouTimer) {
            clearTimeout(eouTimer);
            eouTimer = null;
          }
        } else if (ev.newState === 'listening') {
          // User stopped speaking. If they actually said something, wait to confirm End-Of-Utterance
          if (userHasSpoken && !interviewCompleted && !isAskingQuestion) {
            eouTimer = setTimeout(async () => {
              // EOU confirmed!
              console.log(`[DEBUG] End of utterance detected. Advancing to next question.`);
              userHasSpoken = false;
              eouTimer = null;
              
              // Explicitly commit the user's spoken turn so it gets added to the transcript
              session.commitUserTurn();

              currentQuestionIndex += 1;
              console.log(`[DEBUG] Advanced to question index: ${currentQuestionIndex} / ${questions.length}`);
              await askNextQuestion();
            }, EOU_DELAY_MS);
          }
        }
      });

      // Handle session errors (e.g., transient API issues)
      session.on(voice.AgentSessionEventTypes.Error, async (error: any) => {
        console.error('[DEBUG] AgentSession ERROR:', error);
        const errMsg = error?.error?.message || error?.message || '';
        
        // If the error is related to quota or rate limits, end the interview immediately
        if (errMsg.includes('429') || errMsg.includes('Quota exceeded') || errMsg.includes('rate-limit') || errMsg.includes('RESOURCE_EXHAUSTED')) {
          if (!interviewCompleted) {
            interviewCompleted = true;
            console.log('[DEBUG] API Quota Exceeded. Disconnecting.');
            await saveResults('API Limit Reached');
            
            try {
              const roomName = ctx.room.name!;
              await ctx.room.disconnect();
              await ctx.shutdown();
              
              const roomSvc = new RoomServiceClient(process.env.LIVEKIT_URL!, process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);
              await roomSvc.deleteRoom(roomName);
            } catch (e) {
              console.error('Error during quota disconnect', e);
            }
          }
        }
        
        // If the error is related to authentication (invalid API key)
        if (errMsg.includes('401') || errMsg.includes('authentication') || errMsg.includes('UNAUTHENTICATED')) {
          if (!interviewCompleted) {
            interviewCompleted = true;
            console.log('[DEBUG] Invalid API Key. Disconnecting.');
            await saveResults('Invalid API Key');
            
            try {
              const roomName = ctx.room.name!;
              await ctx.room.disconnect();
              await ctx.shutdown();
              
              const roomSvc = new RoomServiceClient(process.env.LIVEKIT_URL!, process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);
              await roomSvc.deleteRoom(roomName);
            } catch (e) {
              console.error('Error during auth disconnect', e);
            }
          }
        }
      });

      await session.start({ agent, room: ctx.room });

      // 6. Walk through the questions in order, one at a time
      async function askNextQuestion() {
        if (interviewCompleted || isAskingQuestion) return;
        isAskingQuestion = true;
        clearNoAnswerTimer();

        try {
          if (currentQuestionIndex >= questions.length) {
            // All configured questions have been asked and answered
            interviewCompleted = true;
            clearSilenceTimer();
            console.log('[DEBUG] All questions answered, generating closing message');

            await session.generateReply({
              instructions: `Thank ${candidateName} warmly for their time and let them know the interview is complete. Wish them the best! Do not ask any more questions.`,
            });

            // Wait for the closing message to be spoken, then save and disconnect.
            // We use a timer to allow the TTS to finish playing the closing message
            // and for the ConversationItemAdded event to capture it in the transcript.
            setTimeout(async () => {
              await saveResults('Completed');
              // Give a brief moment for the save to persist, then disconnect
              setTimeout(async () => {
                try {
                  const roomName = ctx.room.name!;
                  await ctx.room.disconnect();
                  await ctx.shutdown();

                  // Delete the room to gracefully disconnect the frontend and trigger the results screen
                  const roomSvc = new RoomServiceClient(process.env.LIVEKIT_URL!, process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);
                  await roomSvc.deleteRoom(roomName);
                  console.log(`[DEBUG] Room ${roomName} deleted successfully.`);
                } catch (e) {
                  console.error('Error during disconnect', e);
                }
              }, 2000);
            }, 6000); // 6s for TTS to finish speaking the closing message

            return;
          }

          const question = questions[currentQuestionIndex];
          console.log(`[DEBUG] Asking question ${currentQuestionIndex}: "${question}"`);

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
            // If the LLM is completely failing (e.g. 429 Quota Exceeded), tell the user.
            try {
              await session.say("I'm sorry, but I'm having trouble connecting to my brain right now. The API quota might be exceeded. Please wait a moment and try again.", { allowInterruptions: false });
            } catch (sayErr) {
              console.error('TTS error fallback failed', sayErr);
            }
          }
        } finally {
          isAskingQuestion = false;
          if (!interviewCompleted) {
            // Start the 30-second timeout timer waiting for candidate response
            startNoAnswerTimer();
          }
        }
      }

      // Kick off the interview with the greeting + Question 1
      await askNextQuestion();

      // 9. Handle candidate disconnecting early (requirement: "handle the
      //    situation where the candidate leaves before completion")
      ctx.room.on('participantDisconnected', async () => {
        if (interviewCompleted) return; // Already handled during normal completion
        console.log('Candidate disconnected before completing the interview.');
        await saveResults('Incomplete');
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
