'use client';

import { useMemo } from 'react';
import { DayPicker } from 'react-day-picker';
import { ko, enUS, th, zhCN } from 'react-day-picker/locale';
import { getClientLocale } from '@/lib/i18n/client-copy';

interface DatePickerProps {
  availableDates: Date[];
  selected: Date | null;
  onSelect: (date: Date) => void;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function DatePicker({
  availableDates,
  selected,
  onSelect,
}: DatePickerProps) {
  const dateRange = useMemo(() => {
    if (availableDates.length === 0) return { from: undefined, to: undefined };
    const sorted = [...availableDates].sort(
      (a, b) => a.getTime() - b.getTime(),
    );
    return { from: sorted[0], to: sorted[sorted.length - 1] };
  }, [availableDates]);

  const disabledMatcher = useMemo(() => {
    return (date: Date) =>
      !availableDates.some((d) => isSameDay(d, date));
  }, [availableDates]);

  return (
    <div className="rounded-lg bg-gray-50 p-4">
      <DayPicker
        mode="single"
        locale={{ ko, en: enUS, th, 'zh-CN': zhCN }[getClientLocale()]}
        selected={selected ?? undefined}
        onSelect={(day) => {
          if (day) onSelect(day);
        }}
        disabled={disabledMatcher}
        startMonth={dateRange.from}
        endMonth={dateRange.to}
        showOutsideDays={false}
        classNames={{
          root: 'w-full',
          months: 'flex flex-col',
          month: 'space-y-2',
          month_caption: 'flex justify-center py-1',
          caption_label: 'text-base font-semibold text-gray-900',
          nav: 'flex items-center justify-between absolute inset-x-0 top-0 px-2',
          button_previous:
            'size-8 flex items-center justify-center rounded-md hover:bg-gray-200 text-gray-600',
          button_next:
            'size-8 flex items-center justify-center rounded-md hover:bg-gray-200 text-gray-600',
          weekdays: 'flex',
          weekday:
            'w-full text-center text-sm font-normal text-gray-500',
          week: 'flex',
          day: 'relative flex size-8 sm:size-10 items-center justify-center text-sm',
          day_button:
            'size-8 sm:size-10 rounded-full text-sm font-normal hover:bg-gray-200 focus-visible:ring-2 focus-visible:ring-primary',
          selected:
            '!bg-primary !text-white rounded-full font-semibold',
          today: 'font-semibold text-primary',
          disabled: 'text-gray-300 cursor-not-allowed hover:bg-transparent',
          outside: 'text-gray-300',
        }}
      />
    </div>
  );
}
