'use client';

import { useState } from 'react';
import { InterviewRoom } from '@/components/ai-interview/InterviewRoom';
import { ResultsScreen } from '@/components/ai-interview/ResultsScreen';
import { SetupForm } from '@/components/ai-interview/SetupForm';

type AppState = 'setup' | 'interviewing' | 'results';

export default function Page() {
  const [appState, setAppState] = useState<AppState>('setup');
  const [roomData, setRoomData] = useState<{
    token: string;
    roomName: string;
    url: string;
    candidateName: string;
  } | null>(null);

  const handleStart = (data: any) => {
    // The data comes from the server: { token, roomName, url, metadata }
    const metadataObj = JSON.parse(data.metadata || '{}');
    setRoomData({
      token: data.token,
      roomName: data.roomName,
      url: data.url,
      candidateName: metadataObj.candidateName || 'Candidate',
    });
    setAppState('interviewing');
  };

  const handleDisconnect = () => {
    setAppState('results');
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-black p-4 text-white">
      {appState === 'setup' && <SetupForm onStart={handleStart} />}

      {appState === 'interviewing' && roomData && (
        <InterviewRoom token={roomData.token} url={roomData.url} onDisconnect={handleDisconnect} />
      )}

      {appState === 'results' && roomData && (
        <ResultsScreen roomName={roomData.roomName} candidateName={roomData.candidateName} />
      )}
    </main>
  );
}
