import { useEffect, useState } from "react";

interface Session {
  start: number;
  end: number;
}

export default function TimeTracker({ jobId }: { jobId: string }) {
  const [running, setRunning] = useState(false);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [hourlyRate, setHourlyRate] = useState<number>(0);

  // Load from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(`time-${jobId}`);
    if (stored) setSessions(JSON.parse(stored));
  }, [jobId]);

  // Save to localStorage
  useEffect(() => {
    localStorage.setItem(`time-${jobId}`, JSON.stringify(sessions));
  }, [sessions, jobId]);

  const start = () => {
    setRunning(true);
    setStartTime(Date.now());
  };

  const stop = () => {
    if (!startTime) return;

    const newSession = {
      start: startTime,
      end: Date.now(),
    };

    setSessions([...sessions, newSession]);
    setRunning(false);
    setStartTime(null);
  };

  const reset = () => {
    setSessions([]);
    localStorage.removeItem(`time-${jobId}`);
  };

  const totalSeconds = sessions.reduce(
    (acc, s) => acc + (s.end - s.start) / 1000,
    0
  );

  const totalHours = totalSeconds / 3600;
  const estimated = totalHours * hourlyRate;

  return (
    <div className="card mt-6">
      <h2 className="text-lg font-semibold text-amber-100 mb-3">
        ⏱ Time Tracker
      </h2>

      <div className="flex gap-3 mb-4">
        {!running ? (
          <button onClick={start} className="btn-primary">Start</button>
        ) : (
          <button onClick={stop} className="btn-secondary">Stop</button>
        )}
        <button onClick={reset} className="btn-secondary">Reset</button>
      </div>

      <div className="mb-3">
        <label className="text-sm text-amber-300">Hourly Rate</label>
        <input
          type="number"
          value={hourlyRate}
          onChange={(e) => setHourlyRate(Number(e.target.value))}
          className="w-full mt-1 p-2 rounded bg-ink-800 border border-market-500/20"
        />
      </div>

      <p className="text-sm text-amber-300">
        Total Hours: {totalHours.toFixed(2)}
      </p>

      <p className="text-sm text-market-400">
        Estimated Earnings: {estimated.toFixed(2)}
      </p>

      <div className="mt-4 space-y-2">
        {sessions.map((s, i) => (
          <div key={i} className="text-xs text-amber-700">
            {new Date(s.start).toLocaleTimeString()} →{" "}
            {new Date(s.end).toLocaleTimeString()}
          </div>
        ))}
      </div>
    </div>
  );
}