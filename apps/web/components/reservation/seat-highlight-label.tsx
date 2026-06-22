import type { CSSProperties, ReactNode } from 'react';

import { cn } from '@/lib/cn';

type SeatHighlightLabelProps = {
  children: ReactNode;
  tierColor?: string | null;
  testId?: string;
  className?: string;
};

export function SeatHighlightLabel({
  children,
  tierColor,
  testId,
  className,
}: SeatHighlightLabelProps) {
  const backgroundColor = tierColor?.trim();
  const style = backgroundColor
    ? ({
        backgroundColor,
        color: contrastTextColor(backgroundColor),
      } satisfies CSSProperties)
    : undefined;

  return (
    <span
      data-testid={testId}
      className={cn(
        'inline box-decoration-clone',
        backgroundColor ? 'rounded-md px-1.5 py-0.5' : '',
        className,
      )}
      style={style}
    >
      {children}
    </span>
  );
}

function contrastTextColor(color: string): string | undefined {
  const rgb = parseHexColor(color);
  if (!rgb) {
    return undefined;
  }

  const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return luminance > 0.58 ? '#111827' : '#FFFFFF';
}

function parseHexColor(color: string): { r: number; g: number; b: number } | null {
  const hex = color.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return {
      r: Number.parseInt(hex[0]! + hex[0]!, 16),
      g: Number.parseInt(hex[1]! + hex[1]!, 16),
      b: Number.parseInt(hex[2]! + hex[2]!, 16),
    };
  }
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
    };
  }

  return null;
}
