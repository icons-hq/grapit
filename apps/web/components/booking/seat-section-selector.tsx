'use client';

import type { SeatMapConfig, SeatState } from '@grabit/shared';
import { getSeatSelectionCopy } from '@/lib/booking/seat-selection-copy';
import { formatCopy } from '@/lib/i18n/client-copy';

export function SeatSectionSelector({ sections, selected, onChange, seatStates }: {
  sections: NonNullable<SeatMapConfig['sections']>;
  selected: string | null;
  onChange: (key: string | null) => void;
  seatStates: ReadonlyMap<string, SeatState | 'disabled'>;
}) {
  const copy = getSeatSelectionCopy();
  if (!sections.length) return null;
  return <div role="group" aria-label={copy.chooseSection} className="flex items-center gap-2 overflow-x-auto px-4 py-2 lg:flex-wrap lg:py-3">
    <span className="mr-1 shrink-0 text-xs font-medium text-gray-500">{copy.chooseSection}</span>
    {[{ sectionKey: '', label: copy.allSections, seatIds: [] }, ...sections].map((section) => {
      const count = section.seatIds.filter((id) => !seatStates.has(id) || seatStates.get(id) === 'available').length;
      const active = (selected ?? '') === section.sectionKey;
      return <button key={section.sectionKey} type="button" aria-pressed={active}
        onClick={() => onChange(section.sectionKey || null)}
        className={`min-h-9 shrink-0 whitespace-nowrap rounded-full border px-3 text-xs font-medium ${active ? 'border-primary bg-primary/5 text-primary' : 'border-border bg-white text-gray-600 hover:bg-gray-50'}`}>
        {section.label}{section.sectionKey ? <span className="ml-1.5 opacity-75">{formatCopy(copy.remainingSeats, { count })}</span> : null}
      </button>;
    })}
  </div>;
}
