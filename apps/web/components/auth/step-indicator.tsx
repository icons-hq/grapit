'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

interface StepIndicatorProps {
  currentStep: 1 | 2 | 3;
  labels?: string[];
  ariaLabel?: string;
}

const DEFAULT_LABELS = ['이메일/비밀번호', '약관 동의', '추가 정보'];

export function StepIndicator({
  currentStep,
  labels = DEFAULT_LABELS,
  ariaLabel = '회원가입 진행 상태',
}: StepIndicatorProps) {
  const steps = [1, 2, 3] as const;

  return (
    <div className="flex w-full items-center justify-center" role="navigation" aria-label={ariaLabel}>
      {steps.map((step, index) => {
        const isCompleted = step < currentStep;
        const isActive = step === currentStep;
        const isFuture = step > currentStep;

        return (
          <div key={step} className="flex items-center">
            {/* Step dot */}
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors',
                  isCompleted && 'bg-primary text-white',
                  isActive && 'bg-primary text-white',
                  isFuture && 'border-2 border-gray-200 bg-white text-gray-400'
                )}
                aria-current={isActive ? 'step' : undefined}
              >
                {isCompleted ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <span>{step}</span>
                )}
              </div>
              {/* Label */}
              <span
                className={cn(
                  'mt-2 text-xs whitespace-nowrap',
                  isCompleted && 'text-primary',
                  isActive && 'font-semibold text-primary',
                  isFuture && 'text-gray-400'
                )}
              >
                {labels[index]}
              </span>
            </div>

            {/* Connecting line */}
            {index < steps.length - 1 && (
              <div
                className={cn(
                  'mx-2 mb-6 h-0.5 w-12 sm:w-16',
                  step < currentStep ? 'bg-primary' : 'bg-gray-200'
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
