'use client';

import type {
  FieldArrayWithId,
  UseFormRegister,
  UseFieldArrayAppend,
  UseFieldArrayRemove,
} from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import type { CreatePerformanceFormInput } from '@grabit/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatAdminKstDateTime } from '@/lib/admin-datetime';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface ShowtimeManagerProps {
  fields: FieldArrayWithId<CreatePerformanceFormInput, 'showtimes', 'id'>[];
  append: UseFieldArrayAppend<CreatePerformanceFormInput, 'showtimes'>;
  remove: UseFieldArrayRemove;
  register: UseFormRegister<CreatePerformanceFormInput>;
}

function parseDatePart(dateTime: string): string {
  if (!dateTime) return '';
  return formatAdminKstDateTime(dateTime).split('T')[0] ?? '';
}

function parseTimePart(dateTime: string): string {
  if (!dateTime || !dateTime.includes('T')) return '19:00';
  return formatAdminKstDateTime(dateTime).split('T')[1]?.substring(0, 5) ?? '19:00';
}

export function ShowtimeManager({
  fields,
  append,
  remove,
  register,
}: ShowtimeManagerProps) {
  return (
    <div>
      {fields.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-500">
          등록된 회차가 없습니다.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">날짜</TableHead>
              <TableHead scope="col">시간</TableHead>
              <TableHead scope="col" className="w-16">
                삭제
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {fields.map((field, index) => (
              <ShowtimeRow
                key={field.id}
                index={index}
                dateTime={field.dateTime}
                register={register}
                onRemove={() => remove(index)}
              />
            ))}
          </TableBody>
        </Table>
      )}
      <Button
        type="button"
        variant="outline"
        className="mt-3"
        onClick={() => append({ dateTime: '' })}
      >
        <Plus className="mr-2 h-4 w-4" />
        회차 추가
      </Button>
    </div>
  );
}

function ShowtimeRow({
  index,
  dateTime,
  register,
  onRemove,
}: {
  index: number;
  dateTime: string;
  register: UseFormRegister<CreatePerformanceFormInput>;
  onRemove: () => void;
}) {
  // Hidden input holds the actual dateTime value for react-hook-form
  const showtimeIdField = register(`showtimes.${index}.showtimeId`);
  const { onChange: rhfOnChange, ...rest } = register(
    `showtimes.${index}.dateTime`,
  );

  function handleDateChange(e: React.ChangeEvent<HTMLInputElement>) {
    const date = e.target.value;
    const timeEl = document.getElementById(
      `showtime-time-${index}`,
    ) as HTMLInputElement | null;
    const time = timeEl?.value || '19:00';
    rhfOnChange({
      target: {
        name: `showtimes.${index}.dateTime`,
        value: date ? `${date}T${time}:00` : '',
      },
      type: 'change',
    });
  }

  function handleTimeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const time = e.target.value;
    const dateEl = document.getElementById(
      `showtime-date-${index}`,
    ) as HTMLInputElement | null;
    const date = dateEl?.value || '';
    if (date) {
      rhfOnChange({
        target: {
          name: `showtimes.${index}.dateTime`,
          value: `${date}T${time}:00`,
        },
        type: 'change',
      });
    }
  }

  return (
    <TableRow>
      <TableCell>
        <Input
          id={`showtime-date-${index}`}
          type="date"
          defaultValue={parseDatePart(dateTime)}
          onChange={handleDateChange}
        />
      </TableCell>
      <TableCell>
        <Input
          id={`showtime-time-${index}`}
          type="time"
          defaultValue={parseTimePart(dateTime)}
          onChange={handleTimeChange}
        />
      </TableCell>
      <TableCell>
        <input type="hidden" {...showtimeIdField} />
        <input type="hidden" {...rest} onChange={rhfOnChange} />
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-gray-400 hover:text-red-600"
              aria-label="회차 삭제"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>회차를 삭제하시겠습니까?</AlertDialogTitle>
              <AlertDialogDescription>
                해당 회차가 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>취소</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={onRemove}>
                삭제
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </TableCell>
    </TableRow>
  );
}
