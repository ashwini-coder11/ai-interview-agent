'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

const PREDEFINED_QUESTIONS = [
  "Tell me about yourself.",
  "What is your experience with Node.js?",
  "Tell me about a challenging project you worked on.",
  "How do you handle database performance issues?"
];

export function SetupForm({ onStart }: { onStart: (data: any) => void }) {
  const [candidateName, setCandidateName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const serverUrl = process.env.NEXT_PUBLIC_TOKEN_SERVER_URL || 'http://localhost:4000';
      const response = await fetch(`${serverUrl}/api/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateName,
          jobTitle,
          questions: PREDEFINED_QUESTIONS,
        }),
      });

      const data = await response.json();
      onStart(data); // { token, roomName, url }
    } catch (err) {
      console.error('Failed to start interview', err);
      alert('Failed to start interview. Check if the token server is running.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-auto flex w-full max-w-md flex-col gap-4 rounded-lg border border-gray-700 bg-gray-900 p-6 text-white shadow-lg"
    >
      <h2 className="mb-4 text-center text-2xl font-semibold">AI Interview Setup</h2>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">Candidate Name</label>
        <input
          required
          value={candidateName}
          onChange={(e) => setCandidateName(e.target.value)}
          placeholder="Jane Doe"
          className="flex h-10 w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:outline-none"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">Job Title</label>
        <input
          required
          value={jobTitle}
          onChange={(e) => setJobTitle(e.target.value)}
          placeholder="Software Engineer"
          className="flex h-10 w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:outline-none"
        />
      </div>

      <Button type="submit" disabled={isLoading} className="mt-4">
        {isLoading ? 'Starting...' : 'Start Interview'}
      </Button>
    </form>
  );
}
