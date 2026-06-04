'use client';

import { useRef, useEffect, useState } from 'react';
import { Clock, AlertTriangle } from 'lucide-react';
import { useCountdown } from '@/hooks/use-countdown';

interface CountdownTimerProps {
  expiresAt: number | null;
  onExpire: () => void;
}

export function CountdownTimer({ expiresAt, onExpire }: CountdownTimerProps) {
  const { minutes, seconds, isWarning, isActive } = useCountdown(
    expiresAt,
    onExpire,
  );
  const [wasWarningAnnounced, setWasWarningAnnounced] = useState(false);
  const prevWarning = useRef(false);

  // Announce 3-minute warning for screen readers
  useEffect(() => {
    if (isWarning && !prevWarning.current) {
      setWasWarningAnnounced(true);
    }
    prevWarning.current = isWarning;
  }, [isWarning]);

  // Reset announcement tracking when timer restarts
  useEffect(() => {
    if (!isActive) {
      setWasWarningAnnounced(false);
    }
  }, [isActive]);

  if (!isActive && expiresAt === null) {
    return null;
  }

  const formattedTime = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  return (
    <>
      <div
        className={`flex items-center gap-1 rounded-full px-3 py-1 transition-colors duration-300 ${
          isWarning ? 'bg-destructive text-white' : 'bg-primary text-white'
        }`}
        aria-live="polite"
        aria-label={`남은 시간 ${minutes}분 ${seconds}초`}
      >
        {isWarning ? (
          <AlertTriangle className="size-4" />
        ) : (
          <Clock className="size-4" />
        )}
        <span className="whitespace-nowrap text-sm">
          <span className="text-xs">남은시간</span>{' '}
          <span className="font-mono text-base font-semibold">
            {formattedTime}
          </span>
        </span>
      </div>

      {/* Screen reader announcement for 3-minute warning */}
      {wasWarningAnnounced && (
        <span className="sr-only" aria-live="assertive">
          남은 시간이 3분 미만입니다
        </span>
      )}
    </>
  );
}
