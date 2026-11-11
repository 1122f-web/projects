import { useEffect, useRef, useState } from 'react';
import DailyIframe, { type DailyCall } from '@daily-co/daily-js';
import { PhoneOff, Video } from 'lucide-react';
import { Button } from './ui/Button';
import { Alert } from './ui/Feedback';

interface VideoConsultationProps {
  roomUrl: string;
  /** Personal meeting token; the room is private and rejects joins without one. */
  token: string;
  onLeave: () => void;
}

/** Embedded Daily call for an online consultation. */
export function VideoConsultation({ roomUrl, token, onLeave }: VideoConsultationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [call, setCall] = useState<DailyCall | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Keep the latest callback without re-creating the call when the parent re-renders.
  const onLeaveRef = useRef(onLeave);
  onLeaveRef.current = onLeave;

  useEffect(() => {
    if (!containerRef.current) return;
    const frame = DailyIframe.createFrame(containerRef.current, {
      iframeStyle: { width: '100%', height: '100%', border: '0', borderRadius: '8px' },
      showLeaveButton: true,
    });
    frame.on('left-meeting', () => onLeaveRef.current());
    frame.on('camera-error', () => setError('Your camera or microphone could not be started. Check the browser permission and try again.'));
    frame.on('error', (e) => setError(e?.errorMsg ?? 'The call ended unexpectedly.'));
    frame.join({ url: roomUrl, token }).catch(() => setError('Could not join the call. The link may have expired; close this and join again.'));
    setCall(frame);
    return () => {
      void frame.destroy();
    };
  }, [roomUrl, token]);

  return (
    <div className="rounded-xl bg-slate-900 p-3 shadow-lg sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-3 text-white">
        <h3 className="flex items-center gap-2 font-semibold">
          <Video className="h-5 w-5" aria-hidden="true" /> Live consultation
        </h3>
        <Button variant="danger" size="sm" onClick={() => (call ? void call.leave() : onLeave())}>
          <PhoneOff className="h-4 w-4" aria-hidden="true" /> End call
        </Button>
      </div>
      {error && (
        <div className="mb-3">
          <Alert variant="error">{error}</Alert>
        </div>
      )}
      <div ref={containerRef} className="h-[70vh] min-h-[360px] w-full overflow-hidden rounded-lg bg-black" />
    </div>
  );
}
 