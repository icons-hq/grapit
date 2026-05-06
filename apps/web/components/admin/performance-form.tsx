'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Trash2, Plus, Upload, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  createPerformanceSchema,
  type CreatePerformanceInput,
  type CreatePerformanceFormInput,
  type PerformanceWithDetails,
  GENRES,
  GENRE_LABELS,
} from '@grabit/shared';
import {
  useCreatePerformance,
  useUpdatePerformance,
  usePresignedUpload,
} from '@/hooks/use-admin';
import { ShowtimeManager } from '@/components/admin/showtime-manager';
import { CastingManager } from '@/components/admin/casting-manager';
import { SvgPreview } from '@/components/admin/svg-preview';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { formatAdminKstDate, formatAdminKstDateTime } from '@/lib/admin-datetime';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const AGE_RATINGS = [
  '전체 관람가',
  '만 7세 이상',
  '만 12세 이상',
  '만 15세 이상',
  '만 19세 이상',
] as const;

function mapToFormValues(
  data: PerformanceWithDetails,
): CreatePerformanceFormInput {
  return {
    title: data.title,
    genre: data.genre,
    subcategory: data.subcategory,
    venueName: data.venue?.name ?? '',
    venueAddress: data.venue?.address,
    posterUrl: data.posterUrl,
    description: data.description,
    startDate: formatAdminKstDate(data.startDate),
    endDate: formatAdminKstDate(data.endDate),
    runtime: data.runtime,
    ageRating: data.ageRating,
    salesInfo: data.salesInfo,
    priceTiers: data.priceTiers.map((t) => ({
      tierName: t.tierName,
      price: t.price,
      sortOrder: t.sortOrder,
    })),
    showtimes: data.showtimes.map((s) => ({
      dateTime: formatAdminKstDateTime(s.dateTime),
    })),
    castings: data.castings.map((c) => ({
      actorName: c.actorName,
      roleName: c.roleName,
      photoUrl: c.photoUrl,
      sortOrder: c.sortOrder,
    })),
  };
}

interface PerformanceFormProps {
  mode: 'create' | 'edit';
  initialData?: PerformanceWithDetails;
  performanceId?: string;
}

export function PerformanceForm({
  mode,
  initialData,
  performanceId,
}: PerformanceFormProps) {
  const router = useRouter();
  const [posterPreview, setPosterPreview] = useState<string | null>(
    initialData?.posterUrl ?? null,
  );

  const form = useForm<CreatePerformanceFormInput, unknown, CreatePerformanceInput>({
    resolver: zodResolver(createPerformanceSchema),
    mode: 'onBlur',
    defaultValues: initialData
      ? mapToFormValues(initialData)
      : {
          title: '',
          genre: undefined,
          venueName: '',
          venueAddress: null,
          posterUrl: null,
          description: null,
          startDate: '',
          endDate: '',
          runtime: null,
          ageRating: '',
          salesInfo: null,
          priceTiers: [{ tierName: '', price: 0, sortOrder: 0 }],
          showtimes: [],
          castings: [],
        },
  });

  const priceTiersField = useFieldArray({
    control: form.control,
    name: 'priceTiers',
  });

  const showtimesField = useFieldArray({
    control: form.control,
    name: 'showtimes',
  });

  const castingsField = useFieldArray({
    control: form.control,
    name: 'castings',
  });

  const createMutation = useCreatePerformance();
  const updateMutation = useUpdatePerformance(performanceId ?? '');
  const presignedUpload = usePresignedUpload();

  const handlePosterUpload = useCallback(
    async (file: File) => {
      if (file.size > 5 * 1024 * 1024) {
        toast.error('포스터 이미지는 5MB 이하여야 합니다.');
        return;
      }

      // Show immediate blob preview for better UX
      const blobUrl = URL.createObjectURL(file);
      setPosterPreview(blobUrl);

      const ext = file.name.split('.').pop() ?? 'jpg';
      try {
        const { uploadUrl, publicUrl, mode } =
          await presignedUpload.mutateAsync({
            folder: 'posters',
            contentType: file.type,
            extension: ext,
          });
        await fetch(uploadUrl, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': file.type },
          ...(mode === 'local' ? { credentials: 'include' as const } : {}),
        });
        form.setValue('posterUrl', publicUrl, { shouldDirty: true });
        // Keep blobUrl for preview (avoids auth issues with local mode URLs)
        // Form submits publicUrl to server regardless
        toast.success('포스터가 업로드되었습니다.');
      } catch {
        URL.revokeObjectURL(blobUrl);
        setPosterPreview(posterPreview);
        toast.error('포스터 업로드에 실패했습니다.');
      }
    },
    [form, presignedUpload, posterPreview],
  );

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      handlePosterUpload(file);
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      handlePosterUpload(file);
    }
  }

  function removePoster() {
    form.setValue('posterUrl', null, { shouldDirty: true });
    setPosterPreview(null);
  }

  async function onSubmit(data: CreatePerformanceInput) {
    try {
      if (mode === 'create') {
        await createMutation.mutateAsync(data);
      } else if (performanceId) {
        await updateMutation.mutateAsync(data);
      }
      toast.success('공연이 저장되었습니다');
      router.push('/admin/performances');
    } catch {
      toast.error('공연 저장에 실패했습니다.');
    }
  }

  const isSubmitting = form.formState.isSubmitting;

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8 pb-24">
      {/* Section: 기본 정보 */}
      <section className="rounded-lg bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-xl font-semibold">기본 정보</h2>
        <div className="grid gap-4">
          <div>
            <label htmlFor="title" className="mb-1 block text-sm font-semibold">
              공연명 <span className="text-red-500">*</span>
            </label>
            <Input
              id="title"
              {...form.register('title')}
              placeholder="공연명을 입력해주세요"
            />
            {form.formState.errors.title && (
              <p className="mt-1 text-sm text-red-500">
                {form.formState.errors.title.message}
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-semibold">
                장르 <span className="text-red-500">*</span>
              </label>
              <Controller
                control={form.control}
                name="genre"
                render={({ field }) => (
                  <Select
                    value={field.value ?? ''}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="장르를 선택해주세요" />
                    </SelectTrigger>
                    <SelectContent>
                      {GENRES.map((g) => (
                        <SelectItem key={g} value={g}>
                          {GENRE_LABELS[g]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {form.formState.errors.genre && (
                <p className="mt-1 text-sm text-red-500">
                  {form.formState.errors.genre.message}
                </p>
              )}
            </div>

            <div>
              <label className="mb-1 block text-sm font-semibold">
                관람연령 <span className="text-red-500">*</span>
              </label>
              <Controller
                control={form.control}
                name="ageRating"
                render={({ field }) => (
                  <Select
                    value={field.value ?? ''}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="관람연령을 선택해주세요" />
                    </SelectTrigger>
                    <SelectContent>
                      {AGE_RATINGS.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {form.formState.errors.ageRating && (
                <p className="mt-1 text-sm text-red-500">
                  {form.formState.errors.ageRating.message}
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="venueName" className="mb-1 block text-sm font-semibold">
                장소 <span className="text-red-500">*</span>
              </label>
              <Input
                id="venueName"
                {...form.register('venueName')}
                placeholder="공연장 이름"
              />
              {form.formState.errors.venueName && (
                <p className="mt-1 text-sm text-red-500">
                  {form.formState.errors.venueName.message}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="venueAddress" className="mb-1 block text-sm font-semibold">
                주소 (선택)
              </label>
              <Input
                id="venueAddress"
                {...form.register('venueAddress')}
                placeholder="공연장 주소"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="startDate" className="mb-1 block text-sm font-semibold">
                시작일 <span className="text-red-500">*</span>
              </label>
              <Input
                id="startDate"
                type="date"
                {...form.register('startDate')}
              />
              {form.formState.errors.startDate && (
                <p className="mt-1 text-sm text-red-500">
                  {form.formState.errors.startDate.message}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="endDate" className="mb-1 block text-sm font-semibold">
                종료일 <span className="text-red-500">*</span>
              </label>
              <Input
                id="endDate"
                type="date"
                {...form.register('endDate')}
              />
              {form.formState.errors.endDate && (
                <p className="mt-1 text-sm text-red-500">
                  {form.formState.errors.endDate.message}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="runtime" className="mb-1 block text-sm font-semibold">
                공연시간 (선택)
              </label>
              <Input
                id="runtime"
                {...form.register('runtime')}
                placeholder="예: 150분"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Section: 미디어 (포스터) */}
      <section className="rounded-lg bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-xl font-semibold">미디어</h2>
        {posterPreview ? (
          <div className="relative inline-block">
            <img
              src={posterPreview}
              alt="포스터 미리보기"
              className="h-[240px] w-[160px] rounded-lg object-cover"
            />
            <button
              type="button"
              onClick={removePoster}
              className="absolute -right-2 -top-2 rounded-full bg-red-500 p-1 text-white shadow-md hover:bg-red-600"
              aria-label="포스터 삭제"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            className="flex h-[240px] w-[160px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 transition-colors hover:border-primary hover:bg-primary/5"
            onClick={() =>
              document.getElementById('poster-input')?.click()
            }
          >
            <Upload className="mb-2 h-8 w-8 text-gray-400" />
            <p className="text-xs text-gray-500">포스터 업로드</p>
            <p className="mt-1 text-xs text-gray-400">
              jpg, png, webp (5MB)
            </p>
          </div>
        )}
        <input
          id="poster-input"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleFileInput}
        />
      </section>

      {/* Section: 가격 등급 */}
      <section className="rounded-lg bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-xl font-semibold">가격 등급</h2>
        <div className="space-y-3">
          {priceTiersField.fields.map((field, index) => (
            <div key={field.id} className="flex items-center gap-3">
              <Input
                {...form.register(`priceTiers.${index}.tierName`)}
                placeholder="등급명, e.g. VIP"
                className="flex-1"
              />
              <Input
                type="number"
                {...form.register(`priceTiers.${index}.price`, {
                  valueAsNumber: true,
                })}
                placeholder="가격"
                className="w-32"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => priceTiersField.remove(index)}
                disabled={priceTiersField.fields.length <= 1}
                aria-label="가격 등급 삭제"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {form.formState.errors.priceTiers && (
            <p className="text-sm text-red-500">
              {form.formState.errors.priceTiers.message ??
                form.formState.errors.priceTiers.root?.message}
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          className="mt-3"
          onClick={() =>
            priceTiersField.append({
              tierName: '',
              price: 0,
              sortOrder: priceTiersField.fields.length,
            })
          }
        >
          <Plus className="mr-2 h-4 w-4" />
          등급 추가
        </Button>
      </section>

      {/* Section: 회차 관리 */}
      <section className="rounded-lg bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-xl font-semibold">회차 관리</h2>
        <ShowtimeManager
          fields={showtimesField.fields}
          append={showtimesField.append}
          remove={showtimesField.remove}
          register={form.register}
        />
      </section>

      {/* Section: 캐스팅 */}
      <section className="rounded-lg bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-xl font-semibold">캐스팅</h2>
        <CastingManager
          fields={castingsField.fields}
          append={castingsField.append}
          remove={castingsField.remove}
          register={form.register}
          setValue={form.setValue}
          control={form.control}
        />
      </section>

      {/* Section: 좌석맵 (edit mode only) */}
      {mode === 'edit' && performanceId && (
        <section className="rounded-lg bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-xl font-semibold">좌석맵</h2>
          <SvgPreview
            performanceId={performanceId}
            currentSvgUrl={initialData?.seatMap?.svgUrl}
            currentConfig={initialData?.seatMap?.seatConfig ?? undefined}
          />
        </section>
      )}

      {/* Section: 판매/상세 정보 */}
      <section className="rounded-lg bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-xl font-semibold">판매/상세 정보</h2>
        <div className="space-y-4">
          <div>
            <label htmlFor="description" className="mb-1 block text-sm font-semibold">
              상세정보
            </label>
            <Textarea
              id="description"
              {...form.register('description')}
              rows={6}
              placeholder="공연 상세 정보를 입력해주세요"
            />
          </div>
          <div>
            <label htmlFor="salesInfo" className="mb-1 block text-sm font-semibold">
              판매정보
            </label>
            <Textarea
              id="salesInfo"
              {...form.register('salesInfo')}
              rows={4}
              placeholder="취소/환불 규정 등 판매 관련 정보"
            />
          </div>
        </div>
      </section>

      {/* Sticky bottom bar */}
      <div className="sticky bottom-0 flex justify-end gap-3 border-t bg-white px-8 py-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push('/admin/performances')}
        >
          취소
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              저장 중...
            </>
          ) : (
            '저장'
          )}
        </Button>
      </div>
    </form>
  );
}
