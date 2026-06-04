'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowDown,
  ArrowUp,
  Image as ImageIcon,
  Trash2,
  Plus,
  Upload,
  X,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  DEFAULT_PERFORMANCE_BOOKING_POLICY,
  createPerformanceSchema,
  type CreatePerformanceInput,
  type CreatePerformanceFormInput,
  type PerformanceAllowedPaymentMethod,
  type PerformanceDetailImageInput,
  type PerformanceSeatMapInput,
  type PerformanceWithDetails,
  GENRES,
  GENRE_LABELS,
  type EventCategory,
  type PerformanceStatus,
} from '@grabit/shared';
import {
  useCreatePerformance,
  usePublishPerformance,
  useUpdatePerformance,
  usePresignedUpload,
} from '@/hooks/use-admin';
import { uploadPresignedAsset } from '@/lib/admin-upload';
import {
  EventPublishConfirmationDialog,
  type EventPublishConfirmInput,
  type EventPublishReviewSummary,
} from '@/components/admin/event-publish-confirmation-dialog';
import { ShowtimeManager } from '@/components/admin/showtime-manager';
import { CastingManager } from '@/components/admin/casting-manager';
import {
  findDuplicateFloorKeys,
  FloorSeatMapEditor,
} from '@/components/admin/floor-seat-map-editor';
import { SvgPreview } from '@/components/admin/svg-preview';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { formatAdminKstDate, formatAdminKstDateTime } from '@/lib/admin-datetime';
import { ApiClientError } from '@/lib/api-client';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const AGE_RATINGS = [
  '전체 관람가',
  '만 7세 이상',
  '만 12세 이상',
  '만 15세 이상',
  '만 19세 이상',
] as const;

const PAYMENT_METHOD_LABELS: Record<PerformanceAllowedPaymentMethod, string> = {
  CARD: '카드 결제(국내/해외)',
  VIRTUAL_ACCOUNT: '가상계좌',
  TRANSFER: '계좌이체',
  MOBILE_PHONE: '휴대폰 결제',
  FOREIGN_EASY_PAY: '해외 간편결제',
  SIMPLE_PAY: '국내 간편결제',
};

const ACTIVE_BOOKING_PAYMENT_METHODS = [
  'CARD',
  'TRANSFER',
  'FOREIGN_EASY_PAY',
] as const satisfies readonly PerformanceAllowedPaymentMethod[];

const ACTIVE_BOOKING_PAYMENT_METHOD_SET = new Set<PerformanceAllowedPaymentMethod>(
  ACTIVE_BOOKING_PAYMENT_METHODS,
);

const ADMIN_EVENT_LOCALE_ORDER = ['ko', 'en', 'th', 'zh-CN'] as const;
const PERFORMANCE_OPEN_STATUS_OPTIONS: Array<{
  value: Extract<PerformanceStatus, 'upcoming' | 'selling'>;
  label: string;
}> = [
  { value: 'upcoming', label: '오픈예정' },
  { value: 'selling', label: '오픈' },
];

function isEventCategory(genre: string): genre is EventCategory {
  return (GENRES as readonly string[]).includes(genre);
}

function mapSeatMapToFormValue(
  seatMap: PerformanceWithDetails['seatMaps'][number],
): PerformanceSeatMapInput {
  return {
    floorKey: seatMap.floorKey,
    floorLabel: seatMap.floorLabel,
    sortOrder: seatMap.sortOrder,
    svgUrl: seatMap.svgUrl,
    seatConfig: seatMap.seatConfig,
    totalSeats: seatMap.totalSeats,
  };
}

function normalizeSeatMapsForEditor(
  seatMaps: CreatePerformanceFormInput['seatMaps'],
): PerformanceSeatMapInput[] {
  return (seatMaps ?? []).map((seatMap, index) => ({
    floorKey: seatMap.floorKey,
    floorLabel: seatMap.floorLabel,
    sortOrder: seatMap.sortOrder ?? index,
    svgUrl: seatMap.svgUrl,
    seatConfig: seatMap.seatConfig ?? null,
    totalSeats: seatMap.totalSeats ?? 0,
  }));
}

function normalizeDetailImagesForSave(
  detailImages: CreatePerformanceFormInput['detailImages'],
): PerformanceDetailImageInput[] {
  return (detailImages ?? [])
    .filter((image) => typeof image.imageUrl === 'string' && image.imageUrl.length > 0)
    .map((image, index) => ({
      imageUrl: image.imageUrl,
      altText: image.altText?.trim() ? image.altText.trim() : null,
      sortOrder: index,
    }));
}

function getChangedFieldNames(dirtyFields: unknown, prefix = ''): string[] {
  if (dirtyFields === true) {
    return prefix ? [prefix] : [];
  }

  if (
    typeof dirtyFields !== 'object' ||
    dirtyFields === null ||
    Array.isArray(dirtyFields)
  ) {
    return [];
  }

  return Object.entries(dirtyFields).flatMap(([key, value]) =>
    getChangedFieldNames(value, prefix ? `${prefix}.${key}` : key),
  );
}

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function buildPublishReviewSummary(
  values: CreatePerformanceFormInput,
  dirtyFields: unknown,
): EventPublishReviewSummary {
  const contentChecklist = {
    ko: {
      title: hasText(values.title),
      description: hasText(values.description),
    },
    en: {
      title: hasText(values.title),
      description: hasText(values.description),
    },
  };
  const seatMaps = normalizeSeatMapsForEditor(values.seatMaps);
  const changedFields = getChangedFieldNames(dirtyFields);

  return {
    title: values.title || '제목 미입력',
    changedFields: changedFields.length > 0 ? changedFields : ['publishState'],
    localeStates: ADMIN_EVENT_LOCALE_ORDER.map((locale) => {
      const required = locale === 'ko' || locale === 'en';
      const ready =
        locale === 'ko'
          ? contentChecklist.ko.title && contentChecklist.ko.description
          : locale === 'en'
            ? contentChecklist.en.title && contentChecklist.en.description
            : false;

      return {
        locale,
        label: locale,
        required,
        ready,
      };
    }),
    venue: {
      name: values.venueName || '',
      address: values.venueAddress ?? null,
      accessNotes: values.venueAccessNotes ?? null,
    },
    transportSummary: values.transportSummary ?? null,
    saleSummary: {
      salesInfo: values.salesInfo ?? null,
      paymentMethods: values.bookingPolicy?.allowedPaymentMethods ?? [],
      maxTicketsPerUser: values.bookingPolicy?.maxTicketsPerUser ?? 1,
      seatMapCount: seatMaps.length,
      totalSeats: seatMaps.reduce((sum, seatMap) => sum + seatMap.totalSeats, 0),
    },
    contentChecklist,
  };
}

function copyVisibilityHelperText(visible: boolean): string {
  return visible
    ? '사용자 상세 페이지에 표시'
    : '입력값은 저장되고 사용자에게는 숨김';
}

function copyVisibilityChipClasses(visible: boolean): string {
  return visible
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : 'border-gray-300 bg-gray-100 text-gray-700';
}

function normalizeAllowedBookingPaymentMethods(
  methods: PerformanceAllowedPaymentMethod[] | null | undefined,
): PerformanceAllowedPaymentMethod[] {
  const filtered = (methods ?? DEFAULT_PERFORMANCE_BOOKING_POLICY.allowedPaymentMethods)
    .filter((method) => ACTIVE_BOOKING_PAYMENT_METHOD_SET.has(method));

  return filtered.length > 0
    ? filtered
    : [...DEFAULT_PERFORMANCE_BOOKING_POLICY.allowedPaymentMethods];
}

function normalizeBookingPolicy(
  bookingPolicy: CreatePerformanceFormInput['bookingPolicy'] | undefined,
): NonNullable<CreatePerformanceFormInput['bookingPolicy']> {
  return {
    ...DEFAULT_PERFORMANCE_BOOKING_POLICY,
    ...bookingPolicy,
    allowedPaymentMethods: normalizeAllowedBookingPaymentMethods(
      bookingPolicy?.allowedPaymentMethods,
    ),
  };
}

function mapToFormValues(
  data: PerformanceWithDetails,
): CreatePerformanceFormInput {
  const mappedSeatMaps = data.seatMaps.length
    ? data.seatMaps.map(mapSeatMapToFormValue)
    : data.seatMap
      ? [mapSeatMapToFormValue(data.seatMap)]
      : [];

  return {
    title: data.title,
    genre: isEventCategory(data.genre) ? data.genre : 'artist_celebrity',
    subcategory: data.subcategory,
    venueName: data.venue?.name ?? '',
    venueAddress: data.venue?.address,
    venueAccessNotes: data.venue?.accessNotes,
    transportSummary: data.venue?.transportSummary,
    posterUrl: data.posterUrl,
    description: data.description,
    descriptionVisible: data.descriptionVisible !== false,
    startDate: formatAdminKstDate(data.startDate),
    endDate: formatAdminKstDate(data.endDate),
    runtime: data.runtime,
    ageRating: data.ageRating,
    status: data.status,
    salesInfo: data.salesInfo,
    salesInfoVisible: data.salesInfoVisible !== false,
    detailImages: normalizeDetailImagesForSave(data.detailImages),
    priceTiers: data.priceTiers.map((t) => ({
      tierName: t.tierName,
      price: t.price,
      sortOrder: t.sortOrder,
    })),
    showtimes: data.showtimes.map((s) => ({
      showtimeId: s.id,
      dateTime: formatAdminKstDateTime(s.dateTime),
    })),
    castings: data.castings.map((c) => ({
      actorName: c.actorName,
      roleName: c.roleName,
      photoUrl: c.photoUrl,
      sortOrder: c.sortOrder,
    })),
    seatMaps: mappedSeatMaps,
    bookingPolicy: normalizeBookingPolicy(data.bookingPolicy),
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
  const [seatMapDuplicateError, setSeatMapDuplicateError] = useState<string | null>(
    null,
  );
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);

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
          venueAccessNotes: null,
          transportSummary: null,
          posterUrl: null,
          description: null,
          descriptionVisible: true,
          startDate: '',
          endDate: '',
          runtime: null,
          ageRating: '',
          status: 'upcoming',
          salesInfo: null,
          salesInfoVisible: true,
          detailImages: [],
          priceTiers: [{ tierName: '', price: 0, sortOrder: 0 }],
          showtimes: [],
          castings: [],
          seatMaps: [],
          bookingPolicy: {
            ...DEFAULT_PERFORMANCE_BOOKING_POLICY,
          },
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
  const publishMutation = usePublishPerformance(performanceId ?? '');
  const presignedUpload = usePresignedUpload();
  const seatMaps = normalizeSeatMapsForEditor(form.watch('seatMaps'));
  const detailImages = normalizeDetailImagesForSave(form.watch('detailImages'));
  const watchedValues = form.watch();
  const publishReviewSummary = buildPublishReviewSummary(
    watchedValues,
    form.formState.dirtyFields,
  );

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
        const { uploadUrl, publicUrl, mode, cacheControl } =
          await presignedUpload.mutateAsync({
            folder: 'posters',
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

  async function handleDetailImagesUpload(files: FileList | File[]) {
    const imageFiles = Array.from(files).filter((file) =>
      file.type.startsWith('image/'),
    );

    if (imageFiles.length === 0) {
      toast.error('이미지 파일을 선택해주세요.');
      return;
    }

    const oversizedFile = imageFiles.find(
      (file) => file.size > 5 * 1024 * 1024,
    );
    if (oversizedFile) {
      toast.error('상세 이미지는 파일당 5MB 이하여야 합니다.');
      return;
    }

    const currentImages = normalizeDetailImagesForSave(
      form.getValues('detailImages'),
    );
    const uploadedImages: PerformanceDetailImageInput[] = [];

    try {
      for (const file of imageFiles) {
        const ext = file.name.split('.').pop() ?? 'jpg';
        const { uploadUrl, publicUrl, mode, cacheControl } =
          await presignedUpload.mutateAsync({
            folder: 'performance-detail',
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

        uploadedImages.push({
          imageUrl: publicUrl,
          altText: '',
          sortOrder: currentImages.length + uploadedImages.length,
        });
      }

      form.setValue(
        'detailImages',
        normalizeDetailImagesForSave([...currentImages, ...uploadedImages]),
        { shouldDirty: true },
      );
      toast.success(`${uploadedImages.length}개의 상세 이미지가 업로드되었습니다.`);
    } catch {
      toast.error('상세 이미지 업로드에 실패했습니다.');
    }
  }

  function reorderDetailImage(index: number, direction: -1 | 1) {
    const currentImages = normalizeDetailImagesForSave(
      form.getValues('detailImages'),
    );
    const nextIndex = index + direction;

    if (nextIndex < 0 || nextIndex >= currentImages.length) return;

    const nextImages = [...currentImages];
    const [movedImage] = nextImages.splice(index, 1);
    if (!movedImage) return;
    nextImages.splice(nextIndex, 0, movedImage);

    form.setValue('detailImages', normalizeDetailImagesForSave(nextImages), {
      shouldDirty: true,
    });
  }

  function removeDetailImage(index: number) {
    const nextImages = normalizeDetailImagesForSave(form.getValues('detailImages'))
      .filter((_, imageIndex) => imageIndex !== index);

    form.setValue('detailImages', nextImages, { shouldDirty: true });
  }

  function updateSeatMaps(nextSeatMaps: PerformanceSeatMapInput[]) {
    setSeatMapDuplicateError(null);
    form.setValue('seatMaps', nextSeatMaps, {
      shouldDirty: true,
    });
  }

  async function onSubmit(data: CreatePerformanceInput) {
    const payload: CreatePerformanceInput = {
      ...data,
      detailImages: normalizeDetailImagesForSave(data.detailImages),
      bookingPolicy: normalizeBookingPolicy(data.bookingPolicy),
    };
    const duplicateFloorKeys = findDuplicateFloorKeys(data.seatMaps ?? []);

    if (duplicateFloorKeys.length > 0) {
      const correctionMessage = `중복된 floorKey가 있습니다: ${duplicateFloorKeys.join(', ')}. 각 층 키를 고유하게 수정한 뒤 다시 저장해주세요.`;

      setSeatMapDuplicateError(correctionMessage);
      toast.error('중복된 floorKey를 수정한 뒤 다시 저장해주세요.');
      return;
    }

    try {
      if (mode === 'create') {
        await createMutation.mutateAsync(payload);
      } else if (performanceId) {
        await updateMutation.mutateAsync(payload);
      }

      toast.success('공연이 저장되었습니다');
      router.push('/admin/performances');
    } catch (error) {
      if (
        error instanceof ApiClientError &&
        error.statusCode === 422 &&
        error.message.includes('Validation failed')
      ) {
        const correctionMessage =
          '서버에서 중복된 floorKey를 확인했습니다. 각 층 키를 고유하게 수정한 뒤 다시 저장해주세요.';

        setSeatMapDuplicateError(correctionMessage);
        toast.error('중복된 floorKey를 수정한 뒤 다시 저장해주세요.');
        return;
      }

      toast.error(
        error instanceof Error ? error.message : '공연 저장에 실패했습니다.',
      );
    }
  }

  async function handlePublishConfirm(input: EventPublishConfirmInput) {
    if (!performanceId) return;

    try {
      await publishMutation.mutateAsync(input);
      toast.success('이벤트가 게시되었습니다');
      setPublishDialogOpen(false);
      router.push('/admin/performances');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : '이벤트 게시에 실패했습니다.',
      );
    }
  }

  const isSubmitting =
    form.formState.isSubmitting ||
    createMutation.isPending ||
    updateMutation.isPending;
  const canPublish = mode === 'edit' && Boolean(performanceId);

  return (
    <>
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

          <div className="grid gap-4 sm:grid-cols-3">
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
                오픈 상태 <span className="text-red-500">*</span>
              </label>
              <Controller
                control={form.control}
                name="status"
                render={({ field }) => (
                  <Select
                    value={field.value ?? 'upcoming'}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="오픈 상태를 선택해주세요" />
                    </SelectTrigger>
                    <SelectContent>
                      {PERFORMANCE_OPEN_STATUS_OPTIONS.map((status) => (
                        <SelectItem key={status.value} value={status.value}>
                          {status.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {form.formState.errors.status && (
                <p className="mt-1 text-sm text-red-500">
                  {form.formState.errors.status.message}
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

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="venueAccessNotes"
                className="mb-1 block text-sm font-semibold"
              >
                입장 안내
              </label>
              <Textarea
                id="venueAccessNotes"
                {...form.register('venueAccessNotes')}
                rows={3}
                placeholder="게이트, 접근성, 현장 안내를 입력하세요"
              />
            </div>
            <div>
              <label
                htmlFor="transportSummary"
                className="mb-1 block text-sm font-semibold"
              >
                교통 안내
              </label>
              <Textarea
                id="transportSummary"
                {...form.register('transportSummary')}
                rows={3}
                placeholder="대중교통, 셔틀, 주차 안내를 입력하세요"
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

      <section className="rounded-lg bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold">상세페이지 이미지</h2>
            <p className="mt-1 text-sm text-gray-600">
              공연 상세페이지 본문에 노출될 이미지를 순서대로 관리합니다.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              document.getElementById('detail-images-input')?.click()
            }
            disabled={presignedUpload.isPending}
          >
            {presignedUpload.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            이미지 추가
          </Button>
        </div>

        <input
          id="detail-images-input"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={(event) => {
            const files = event.target.files;
            if (files) {
              void handleDetailImagesUpload(files);
              event.target.value = '';
            }
          }}
        />

        {detailImages.length === 0 ? (
          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void handleDetailImagesUpload(event.dataTransfer.files);
            }}
            onClick={() =>
              document.getElementById('detail-images-input')?.click()
            }
            className="flex min-h-[180px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 px-6 py-8 text-center transition-colors hover:border-primary hover:bg-primary/5"
          >
            <ImageIcon className="mb-3 h-9 w-9 text-gray-400" />
            <p className="text-sm font-semibold text-gray-900">
              상세 이미지를 업로드하세요
            </p>
            <p className="mt-1 text-sm text-gray-500">
              jpg, png, webp / 파일당 5MB / 여러 장 선택 가능
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {detailImages.map((image, index) => (
              <div
                key={`${image.imageUrl}-${index}`}
                className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50"
              >
                <input
                  type="hidden"
                  {...form.register(`detailImages.${index}.imageUrl`)}
                />
                <input
                  type="hidden"
                  {...form.register(`detailImages.${index}.sortOrder`, {
                    valueAsNumber: true,
                  })}
                />

                <div className="relative aspect-[2/3] bg-gray-100">
                  <img
                    src={image.imageUrl}
                    alt={image.altText || `상세 이미지 ${index + 1}`}
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute left-3 top-3 rounded-full bg-black/75 px-2.5 py-1 text-xs font-semibold text-white">
                    {index + 1}
                  </div>
                  <div className="absolute right-2 top-2 flex gap-1">
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="secondary"
                      onClick={() => reorderDetailImage(index, -1)}
                      disabled={index === 0}
                      aria-label="상세 이미지 위로 이동"
                    >
                      <ArrowUp className="h-3 w-3" />
                    </Button>
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="secondary"
                      onClick={() => reorderDetailImage(index, 1)}
                      disabled={index === detailImages.length - 1}
                      aria-label="상세 이미지 아래로 이동"
                    >
                      <ArrowDown className="h-3 w-3" />
                    </Button>
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="destructive"
                      onClick={() => removeDetailImage(index)}
                      aria-label="상세 이미지 삭제"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2 p-3">
                  <Label htmlFor={`detailImages.${index}.altText`}>
                    대체 텍스트
                  </Label>
                  <Input
                    id={`detailImages.${index}.altText`}
                    {...form.register(`detailImages.${index}.altText`)}
                    placeholder="예: 좌석 안내 이미지"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
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

      {/* Section: 좌석맵 및 예매 정책 */}
      <section className="rounded-lg bg-white p-6 shadow-sm">
        <div className="space-y-6">
          <div>
            <h2 className="mb-2 text-xl font-semibold">좌석맵 및 예매 정책</h2>
            <p className="text-sm text-gray-600">
              층별 SVG 좌석맵과 공연별 예매 정책을 함께 설정합니다.
            </p>
          </div>

          <FloorSeatMapEditor
            value={seatMaps}
            onChange={updateSeatMaps}
            duplicateFloorError={seatMapDuplicateError}
            renderPreview={({ floor, index, updateFloor }) => (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <SvgPreview
                  inputId={`svg-input-${index}`}
                  currentSvgUrl={floor.svgUrl || undefined}
                  currentConfig={floor.seatConfig}
                  currentTotalSeats={floor.totalSeats}
                  expectedFloorKey={floor.floorKey}
                  allowTierStructureEditing={false}
                  onChange={({ svgUrl, seatConfig, totalSeats }) => {
                    setSeatMapDuplicateError(null);
                    updateFloor({
                      ...floor,
                      svgUrl,
                      seatConfig,
                      totalSeats,
                    });
                  }}
                />
              </div>
            )}
          />

          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="bookingPolicy.maxTicketsPerUser">
                  1인 최대 예매 가능 매수
                </Label>
                <Input
                  id="bookingPolicy.maxTicketsPerUser"
                  type="number"
                  min={1}
                  {...form.register('bookingPolicy.maxTicketsPerUser', {
                    valueAsNumber: true,
                  })}
                />
                <p className="text-sm text-gray-500">
                  이 공연은 전체 층 합산 기준으로 최대 예매 매수를 제한합니다.
                </p>
                {form.formState.errors.bookingPolicy?.maxTicketsPerUser && (
                  <p className="text-sm text-red-500">
                    {form.formState.errors.bookingPolicy.maxTicketsPerUser.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>허용 결제 수단</Label>
                <Controller
                  control={form.control}
                  name="bookingPolicy.allowedPaymentMethods"
                  render={({ field }) => (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {ACTIVE_BOOKING_PAYMENT_METHODS.map((method) => {
                        const checked = field.value?.includes(method) ?? false;

                        return (
                          <label
                            key={method}
                            className="flex min-h-11 items-center gap-3 rounded-lg border bg-white px-3 py-2 text-sm font-medium text-gray-900"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(nextChecked) => {
                                const nextValue = nextChecked
                                  ? [...(field.value ?? []), method]
                                  : (field.value ?? []).filter((value) => value !== method);

                                field.onChange(nextValue);
                              }}
                            />
                            <span>{PAYMENT_METHOD_LABELS[method]}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                />
                {form.formState.errors.bookingPolicy?.allowedPaymentMethods && (
                  <p className="text-sm text-red-500">
                    {form.formState.errors.bookingPolicy.allowedPaymentMethods.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="bookingPolicy.paymentWindowMinutes">
                  결제 가능 시간 (분)
                </Label>
                <Input
                  id="bookingPolicy.paymentWindowMinutes"
                  type="number"
                  min={1}
                  {...form.register('bookingPolicy.paymentWindowMinutes', {
                    valueAsNumber: true,
                  })}
                />
                {form.formState.errors.bookingPolicy?.paymentWindowMinutes && (
                  <p className="text-sm text-red-500">
                    {form.formState.errors.bookingPolicy.paymentWindowMinutes.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="bookingPolicy.seatHoldMinutes">
                  좌석 hold 시간 (분)
                </Label>
                <Input
                  id="bookingPolicy.seatHoldMinutes"
                  type="number"
                  min={1}
                  {...form.register('bookingPolicy.seatHoldMinutes', {
                    valueAsNumber: true,
                  })}
                />
                {form.formState.errors.bookingPolicy?.seatHoldMinutes && (
                  <p className="text-sm text-red-500">
                    {form.formState.errors.bookingPolicy.seatHoldMinutes.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="bookingPolicy.cancelledSeatHoldMinMinutes">
                  취소 좌석 hold 최소 시간 (분)
                </Label>
                <Input
                  id="bookingPolicy.cancelledSeatHoldMinMinutes"
                  type="number"
                  min={1}
                  {...form.register('bookingPolicy.cancelledSeatHoldMinMinutes', {
                    valueAsNumber: true,
                  })}
                />
                {form.formState.errors.bookingPolicy?.cancelledSeatHoldMinMinutes && (
                  <p className="text-sm text-red-500">
                    {form.formState.errors.bookingPolicy.cancelledSeatHoldMinMinutes.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="bookingPolicy.cancelledSeatHoldMaxMinutes">
                  취소 좌석 hold 최대 시간 (분)
                </Label>
                <Input
                  id="bookingPolicy.cancelledSeatHoldMaxMinutes"
                  type="number"
                  min={1}
                  {...form.register('bookingPolicy.cancelledSeatHoldMaxMinutes', {
                    valueAsNumber: true,
                  })}
                />
                <p className="text-sm text-gray-500">
                  취소 후 좌석이 재오픈되기 전 랜덤 hold 구간의 상한입니다.
                </p>
                {form.formState.errors.bookingPolicy?.cancelledSeatHoldMaxMinutes && (
                  <p className="text-sm text-red-500">
                    {form.formState.errors.bookingPolicy.cancelledSeatHoldMaxMinutes.message}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <Controller
                control={form.control}
                name="bookingPolicy.changePolicyEnabled"
                render={({ field }) => (
                  <div className="flex items-start justify-between gap-4 rounded-lg border bg-white px-4 py-3">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-gray-900">
                        결제 전 좌석 변경 허용
                      </p>
                      <p className="text-sm text-gray-500">
                        결제 완료 전까지 좌석 변경 정책을 운영자 설정으로 제어합니다.
                      </p>
                    </div>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </div>
                )}
              />

              <Controller
                control={form.control}
                name="bookingPolicy.manualOpenEnabled"
                render={({ field }) => (
                  <div className="flex items-start justify-between gap-4 rounded-lg border bg-white px-4 py-3">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-gray-900">
                        운영자 수동 재오픈 허용
                      </p>
                      <p className="text-sm text-gray-500">
                        취소 좌석의 즉시 재오픈 예외 정책을 저장합니다.
                      </p>
                    </div>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </div>
                )}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Section: 판매/상세 정보 */}
      <section className="rounded-lg bg-white p-6 shadow-sm">
        <div className="space-y-6">
          <div className="space-y-3">
            <Controller
              control={form.control}
              name="descriptionVisible"
              render={({ field }) => {
                const visible = field.value !== false;

                return (
                  <div className="flex flex-col gap-3 border-b border-gray-100 pb-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <Label
                        htmlFor="description"
                        className="text-lg font-semibold text-gray-900"
                      >
                        상세정보
                      </Label>
                      <p className="mt-1 text-sm text-gray-500">
                        {copyVisibilityHelperText(visible)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${copyVisibilityChipClasses(visible)}`}
                      >
                        {visible ? '공개' : '비공개'}
                      </span>
                      <Switch
                        checked={visible}
                        onCheckedChange={field.onChange}
                        aria-label="상세정보 공개 상태"
                      />
                    </div>
                  </div>
                );
              }}
            />
            <Textarea
              id="description"
              {...form.register('description')}
              rows={6}
              placeholder="공연 상세 정보를 입력해주세요"
            />
          </div>
          <div className="space-y-3">
            <Controller
              control={form.control}
              name="salesInfoVisible"
              render={({ field }) => {
                const visible = field.value !== false;

                return (
                  <div className="flex flex-col gap-3 border-b border-gray-100 pb-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <Label
                        htmlFor="salesInfo"
                        className="text-lg font-semibold text-gray-900"
                      >
                        판매정보
                      </Label>
                      <p className="mt-1 text-sm text-gray-500">
                        {copyVisibilityHelperText(visible)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${copyVisibilityChipClasses(visible)}`}
                      >
                        {visible ? '공개' : '비공개'}
                      </span>
                      <Switch
                        checked={visible}
                        onCheckedChange={field.onChange}
                        aria-label="판매정보 공개 상태"
                      />
                    </div>
                  </div>
                );
              }}
            />
            <Textarea
              id="salesInfo"
              {...form.register('salesInfo')}
              rows={4}
              placeholder="취소/환불 규정 등 판매 관련 정보"
            />
          </div>
        </div>
      </section>

      <section className="rounded-lg bg-white p-6 shadow-sm">
        <div className="space-y-5">
          <div>
            <h2 className="mb-2 text-xl font-semibold">게시 검토</h2>
            <p className="text-sm text-gray-600">
              공개 전 언어 상태, 장소/교통, 판매 설정을 한 번에 확인합니다.
            </p>
          </div>

          <Tabs defaultValue="ko" className="w-full">
            <TabsList>
              {publishReviewSummary.localeStates.map((state) => (
                <TabsTrigger key={state.locale} value={state.locale}>
                  {state.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {publishReviewSummary.localeStates.map((state) => (
              <TabsContent key={state.locale} value={state.locale}>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">
                      {state.required ? '필수 게시 언어' : '검수 필요 언어'}
                    </p>
                    <p className="mt-1 text-sm text-gray-600">
                      {state.ready
                        ? '게시 가능한 콘텐츠가 준비되었습니다.'
                        : '게시 전 검수 상태로 남습니다.'}
                    </p>
                  </div>
                  <span className="rounded-full bg-[#F3EFFF] px-3 py-1 text-sm font-semibold text-[#6C3CE0]">
                    {state.ready ? '준비됨' : '검수 필요'}
                  </span>
                </div>
              </TabsContent>
            ))}
          </Tabs>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-gray-200 bg-[#F5F5F7] p-4">
              <p className="text-sm font-semibold text-gray-700">장소/교통</p>
              <p className="mt-2 text-sm font-semibold text-gray-900">
                {publishReviewSummary.venue.name || '장소 미입력'}
              </p>
              <p className="mt-1 text-sm text-gray-600">
                {publishReviewSummary.transportSummary || '교통 안내 미입력'}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-[#F5F5F7] p-4">
              <p className="text-sm font-semibold text-gray-700">판매 설정</p>
              <p className="mt-2 text-sm text-gray-900">
                결제 수단 {publishReviewSummary.saleSummary.paymentMethods.join(', ') || '미입력'}
              </p>
              <p className="mt-1 text-sm text-gray-600">
                1인 {publishReviewSummary.saleSummary.maxTicketsPerUser}매 / {publishReviewSummary.saleSummary.seatMapCount}개 층 / {publishReviewSummary.saleSummary.totalSeats.toLocaleString('ko-KR')}석
              </p>
            </div>
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
        {canPublish && (
          <Button
            type="button"
            disabled={isSubmitting || publishMutation.isPending}
            onClick={() => setPublishDialogOpen(true)}
          >
            이벤트 게시하기
          </Button>
        )}
      </div>
      </form>
      <EventPublishConfirmationDialog
        open={publishDialogOpen}
        onOpenChange={setPublishDialogOpen}
        summary={publishReviewSummary}
        onConfirm={handlePublishConfirm}
        isPublishing={publishMutation.isPending}
      />
    </>
  );
}
