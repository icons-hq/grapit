'use client';

import { useState, useCallback, useRef } from 'react';
import type {
  FieldArrayWithId,
  UseFormRegister,
  UseFieldArrayAppend,
  UseFieldArrayRemove,
  UseFormSetValue,
  Control,
} from 'react-hook-form';
import { useWatch } from 'react-hook-form';
import { Plus, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import type { CreatePerformanceFormInput } from '@grabit/shared';
import { usePresignedUpload } from '@/hooks/use-admin';
import { uploadPresignedAsset } from '@/lib/admin-upload';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

interface CastingManagerProps {
  fields: FieldArrayWithId<CreatePerformanceFormInput, 'castings', 'id'>[];
  append: UseFieldArrayAppend<CreatePerformanceFormInput, 'castings'>;
  remove: UseFieldArrayRemove;
  register: UseFormRegister<CreatePerformanceFormInput>;
  setValue: UseFormSetValue<CreatePerformanceFormInput>;
  control: Control<CreatePerformanceFormInput>;
}

interface CastingCardProps {
  index: number;
  field: FieldArrayWithId<CreatePerformanceFormInput, 'castings', 'id'>;
  control: Control<CreatePerformanceFormInput>;
  register: UseFormRegister<CreatePerformanceFormInput>;
  remove: UseFieldArrayRemove;
  onPhotoUpload: (index: number, file: File) => void;
}

function CastingCard({
  index,
  field,
  control,
  register,
  remove,
  onPhotoUpload,
}: CastingCardProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const watchedPhotoUrl = useWatch({
    control,
    name: `castings.${index}.photoUrl`,
  });

  const displayUrl = preview ?? watchedPhotoUrl;

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (!f) return;

      // Create blob URL for instant preview
      const blobUrl = URL.createObjectURL(f);
      setPreview(blobUrl);

      onPhotoUpload(index, f);

      // Reset the input so the same file can be re-selected
      e.target.value = '';
    },
    [index, onPhotoUpload],
  );

  const triggerFileInput = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  return (
    <div className="flex flex-col items-center rounded-lg border bg-white p-4">
      {/* Photo */}
      <div className="relative mb-3">
        {displayUrl ? (
          <button
            type="button"
            className="h-16 w-16 overflow-hidden rounded-full focus:outline-none focus:ring-2 focus:ring-primary"
            onClick={triggerFileInput}
            aria-label="casting photo change"
          >
            <img
              src={displayUrl}
              alt={field.actorName || 'casting photo'}
              className="h-full w-full object-cover"
            />
          </button>
        ) : (
          <button
            type="button"
            className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-200 transition-colors hover:bg-gray-300"
            onClick={triggerFileInput}
            aria-label="casting photo upload"
          >
            <Upload className="h-5 w-5 text-gray-400" />
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {/* Name + Role */}
      <Input
        {...register(`castings.${index}.actorName`)}
        placeholder="배우 이름"
        className="mb-2 text-center text-sm"
      />
      <Input
        {...register(`castings.${index}.roleName`)}
        placeholder="역할 (선택)"
        className="mb-2 text-center text-sm"
      />

      {/* Delete */}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="text-gray-400 hover:text-red-600"
            aria-label={`${field.actorName || 'casting'} delete`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              캐스팅 정보를 삭제하시겠습니까?
            </AlertDialogTitle>
            <AlertDialogDescription>
              해당 배우의 캐스팅 정보가 삭제됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => remove(index)}
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function CastingManager({
  fields,
  append,
  remove,
  register,
  setValue,
  control,
}: CastingManagerProps) {
  const presignedUpload = usePresignedUpload();

  const handlePhotoUpload = useCallback(
    async (index: number, file: File) => {
      if (file.size > 5 * 1024 * 1024) {
        toast.error('사진은 5MB 이하여야 합니다.');
        return;
      }
      const ext = file.name.split('.').pop() ?? 'jpg';
      try {
        const { uploadUrl, publicUrl, mode, cacheControl } =
          await presignedUpload.mutateAsync({
            folder: 'castings',
            contentType: file.type,
            extension: ext,
          });
        await uploadPresignedAsset({
          uploadUrl,
          file,
          contentType: file.type,
          mode,
          cacheControl,
        });
        setValue(`castings.${index}.photoUrl`, publicUrl, {
          shouldDirty: true,
        });
        toast.success('사진이 업로드되었습니다.');
      } catch {
        toast.error('사진 업로드에 실패했습니다.');
      }
    },
    [presignedUpload, setValue],
  );

  return (
    <div>
      {fields.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-500">
          등록된 캐스팅이 없습니다.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {fields.map((field, index) => (
            <CastingCard
              key={field.id}
              index={index}
              field={field}
              control={control}
              register={register}
              remove={remove}
              onPhotoUpload={handlePhotoUpload}
            />
          ))}
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        className="mt-3"
        onClick={() =>
          append({
            actorName: '',
            roleName: null,
            photoUrl: null,
            sortOrder: fields.length,
          })
        }
      >
        <Plus className="mr-2 h-4 w-4" />
        캐스팅 추가
      </Button>
    </div>
  );
}
