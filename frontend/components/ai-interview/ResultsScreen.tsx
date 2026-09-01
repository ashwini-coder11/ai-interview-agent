'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

export function ResultsScreen({
  roomName,
  candidateName,
}: {
  roomName: string;
  candidateName: string;
}) {
  const [results, setResults] = useState<any>(null);

  useEffect(() => {
    // Poll the backend until results are available
    const interval = setInterval(async () => {
      try {
        const serverUrl = process.env.NEXT_PUBLIC_TOKEN_SERVER_URL || 'http://localhost:4000';
        const res = await fetch(
          `${serverUrl}/api/results/${roomName}`
        );
        const data = await res.json();
        if (data) {
          setResults(data);
          clearInterval(interval);
        }
      } catch (e) {
        console.error('Failed to fetch results', e);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [roomName]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 rounded-lg border border-gray-700 bg-gray-900 p-6 text-white shadow-lg">
      <h2 className="mb-2 text-3xl font-bold">Interview Results</h2>

      <div className="grid grid-cols-3 gap-4 rounded-md border border-gray-700 bg-gray-800 p-4">
        <div>
          <span className="block text-sm text-gray-400">Candidate</span>
          <span className="text-lg font-semibold">{candidateName}</span>
        </div>
        <div>
          <span className="block text-sm text-gray-400">Status</span>
          <span
            className={`text-lg font-semibold ${results?.status === 'Completed' ? 'text-green-400' : 'text-yellow-400'}`}
          >
            {results ? results.status : 'Processing...'}
          </span>
        </div>
        <div>
          <span className="block text-sm text-gray-400">Duration</span>
          <span className="text-lg font-semibold">
            {results?.durationMs
              ? `${String(Math.floor(results.durationMs / 60000)).padStart(2, '0')}:${String(Math.floor((results.durationMs % 60000) / 1000)).padStart(2, '0')}`
              : '--:--'}
          </span>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-xl font-semibold">Recording</h3>
        {results?.recordingUrl ? (
          <audio controls className="w-full rounded-md bg-gray-800">
            <source src={results.recordingUrl} type="audio/mp4" />
            Your browser does not support the audio element.
          </audio>
        ) : (
          <p className="text-sm text-gray-400">
            No recording available. To enable recordings, configure an S3 or GCS storage bucket
            in your LiveKit Cloud project under Egress settings.
          </p>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-xl font-semibold">Transcript</h3>
        {results?.transcript ? (
          <div className="flex max-h-96 flex-col gap-3 overflow-y-auto rounded-md border border-gray-700 bg-gray-800 p-4">
            {results.transcript.map((msg: any, i: number) => (
              <div
                key={i}
                className={`flex flex-col ${msg.speaker === 'ai' ? 'items-start' : 'items-end'}`}
              >
                <span className="mb-1 text-xs text-gray-400">
                  {msg.speaker === 'ai' ? 'AI' : 'Candidate'}
                </span>
                <div
                  className={`max-w-[80%] rounded-lg p-3 ${msg.speaker === 'ai' ? 'rounded-tl-none bg-blue-600 text-white' : 'rounded-tr-none bg-gray-700 text-white'}`}
                >
                  {msg.text}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex h-32 animate-pulse items-center justify-center rounded-md border border-gray-700 bg-gray-800">
            <span className="text-gray-400">Loading transcript...</span>
          </div>
        )}
      </div>

      <Button onClick={() => window.location.reload()} className="mt-4">
        Start New Interview
      </Button>
    </div>
  );
}
