'use client';

import { useState } from 'react';
import { useController, type Control, type FieldArrayWithId,
  type UseFieldArrayAppend,
  type UseFieldArrayRemove,
} from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import type { CreatePerformanceFormInput, CreatePerformanceInput } from '@grabit/shared';
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
  control: Control<CreatePerformanceFormInput, unknown, CreatePerformanceInput>;
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
  control,
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
                control={control}
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
  control,
  onRemove,
}: {
  index: number;
  control: Control<CreatePerformanceFormInput, unknown, CreatePerformanceInput>;
  onRemove: () => void;
}) {
  const { field } = useController({ control, name: `showtimes.${index}.dateTime` });
  const [pendingTime, setPendingTime] = useState('19:00');
  const date = parseDatePart(field.value ?? '');
  const time = field.value ? parseTimePart(field.value) : pendingTime;

  return (
    <TableRow>
      <TableCell>
        <Input
          id={`showtime-date-${index}`}
          aria-label={`회차 ${index + 1} 날짜`}
          type="date"
          value={date}
          ref={field.ref}
          onBlur={field.onBlur}
          onChange={(event) => field.onChange(event.target.value ? `${event.target.value}T${time}:00` : '')}
        />
      </TableCell>
      <TableCell>
        <Input
          id={`showtime-time-${index}`}
          aria-label={`회차 ${index + 1} 시간`}
          type="time"
          value={time}
          onBlur={field.onBlur}
          onChange={(event) => {
            setPendingTime(event.target.value);
            if (date) field.onChange(event.target.value ? `${date}T${event.target.value}:00` : '');
          }}
        />
      </TableCell>
      <TableCell>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
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
