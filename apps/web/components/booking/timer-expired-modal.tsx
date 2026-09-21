'use client';

import { getSeatSelectionCopy } from '@/lib/booking/seat-selection-copy';

import { Clock } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';

interface TimerExpiredModalProps {
  open: boolean;
  onReset: () => void;
}

export function TimerExpiredModal({ open, onReset }: TimerExpiredModalProps) {
  const seatCopy = getSeatSelectionCopy();
  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <div className="flex flex-col items-center gap-4 text-center">
          <Clock className="size-12 text-gray-400" />
          <AlertDialogTitle className="text-xl font-semibold text-gray-900">
            {seatCopy.expired}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm text-gray-600">
            {seatCopy.expiredBody}
          </AlertDialogDescription>
        </div>
        <AlertDialogAction
          onClick={onReset}
          size="lg"
          className="w-full"
        >
          {seatCopy.restart}
        </AlertDialogAction>
      </AlertDialogContent>
    </AlertDialog>
  );
}
