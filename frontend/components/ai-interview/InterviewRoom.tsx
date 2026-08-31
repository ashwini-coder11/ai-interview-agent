'use client';

import { useCallback, useState } from 'react';
import {
  BarVisualizer,
  LiveKitRoom,
  RoomAudioRenderer,
  VoiceAssistantControlBar,
  useVoiceAssistant,
} from '@livekit/components-react';

function InterviewVisualizer() {
  const { state, audioTrack } = useVoiceAssistant();

  return (
    <div className="my-4 flex w-full flex-1 flex-col items-center justify-center rounded-lg border border-gray-700 bg-gray-900 p-8 shadow-inner">
      <div className="flex h-48 items-center justify-center">
        <BarVisualizer
          state={state}
          barCount={7}
          trackRef={audioTrack}
          className="h-full w-full text-blue-500"
          options={{ minHeight: 24 }}
        />
      </div>
      <div className="mt-8 text-xl font-semibold text-gray-300">
        {state === 'connecting' && 'Connecting...'}
        {state === 'initializing' && 'Initializing...'}
        {state === 'listening' && 'AI is Listening...'}
        {state === 'speaking' && 'AI is Speaking...'}
        {state === 'disconnected' && 'Disconnected'}
      </div>
    </div>
  );
}

export function InterviewRoom({
  token,
  url,
  onDisconnect,
}: {
  token: string;
  url: string;
  onDisconnect: () => void;
}) {
  return (
    <div className="bg-card mx-auto flex h-full min-h-[600px] w-full max-w-4xl flex-col rounded-lg border p-6 shadow-lg">
      <h2 className="mb-4 text-center text-2xl font-bold">Active Interview</h2>
      <LiveKitRoom
        token={token}
        serverUrl={url}
        connect={true}
        onDisconnected={onDisconnect}
        className="flex flex-1 flex-col"
      >
        <RoomAudioRenderer />
        <InterviewVisualizer />

        <div className="mt-4 flex justify-center">
          <VoiceAssistantControlBar controls={{ leave: true, mic: true }} />
        </div>
      </LiveKitRoom>
    </div>
  );
}
