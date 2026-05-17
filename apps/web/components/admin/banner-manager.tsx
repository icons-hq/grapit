'use client';

import { useState, useCallback } from 'react';
import { Upload, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { usePresignedUpload } from '@/hooks/use-admin';
import { uploadPresignedAsset } from '@/lib/admin-upload';
import type {
  BannerDeviceTarget,
  BannerPlacement,
  BannerStatus,
} from '@grabit/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface BannerFormData {
  imageUrl: string;
  linkUrl: string | null;
  placement: BannerPlacement;
  deviceTarget: BannerDeviceTarget;
  startsAt: string | null;
  endsAt: string | null;
  status: BannerStatus;
  sortOrder: number;
  isActive: boolean;
}

interface BannerFormProps {
  initialData?: Partial<BannerFormData>;
  onSubmit: (data: BannerFormData) => Promise<void>;
  onCancel: () => void;
  isSubmitting: boolean;
}

const PLACEMENT_OPTIONS: Array<{ value: BannerPlacement; label: string }> = [
  { value: 'home_hero', label: '홈 히어로' },
  { value: 'home_secondary', label: '홈 보조' },
  { value: 'performance_detail', label: '공연 상세' },
  { value: 'operations_notice', label: '운영 공지' },
];

const DEVICE_TARGET_OPTIONS: Array<{ value: BannerDeviceTarget; label: string }> = [
  { value: 'all', label: '전체' },
  { value: 'desktop', label: '데스크톱' },
  { value: 'mobile', label: '모바일' },
];

const STATUS_OPTIONS: Array<{ value: BannerStatus; label: string }> = [
  { value: 'draft', label: '임시저장' },
  { value: 'scheduled', label: '예약됨' },
  { value: 'active', label: '활성' },
  { value: 'paused', label: '일시중지' },
  { value: 'expired', label: '만료' },
];

function toDatetimeLocal(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function toIsoDatetime(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString();
}

export function BannerForm({
  initialData,
  onSubmit,
  onCancel,
  isSubmitting,
}: BannerFormProps) {
  const [imageUrl, setImageUrl] = useState(initialData?.imageUrl ?? '');
  const [linkUrl, setLinkUrl] = useState(initialData?.linkUrl ?? '');
  const [placement, setPlacement] = useState<BannerPlacement>(
    initialData?.placement ?? 'home_hero',
  );
  const [deviceTarget, setDeviceTarget] = useState<BannerDeviceTarget>(
    initialData?.deviceTarget ?? 'all',
  );
  const [startsAt, setStartsAt] = useState(
    toDatetimeLocal(initialData?.startsAt),
  );
  const [endsAt, setEndsAt] = useState(toDatetimeLocal(initialData?.endsAt));
  const [status, setStatus] = useState<BannerStatus>(
    initialData?.status ?? 'active',
  );
  const [sortOrder, setSortOrder] = useState(initialData?.sortOrder ?? 0);
  const presignedUpload = usePresignedUpload();
  const isMobileTarget = deviceTarget === 'mobile';
  const uploadRatioClass = isMobileTarget ? 'aspect-[1290/600]' : 'aspect-video';
  const uploadGuidance = isMobileTarget
    ? '모바일 1290 x 600px 권장'
    : '데스크톱 16:9 비율 권장';

  const handleImageUpload = useCallback(
    async (file: File) => {
      if (file.size > 5 * 1024 * 1024) {
        toast.error('이미지는 5MB 이하여야 합니다.');
        return;
      }
      const ext = file.name.split('.').pop() ?? 'jpg';
      try {
        const { uploadUrl, publicUrl, mode, cacheControl } =
          await presignedUpload.mutateAsync({
            folder: 'banners',
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
        setImageUrl(publicUrl);
        toast.success('배너 이미지가 업로드되었습니다.');
      } catch {
        toast.error('이미지 업로드에 실패했습니다.');
      }
    },
    [presignedUpload],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!imageUrl) {
      toast.error('배너 이미지를 업로드해주세요.');
      return;
    }
    await onSubmit({
      imageUrl,
      linkUrl: linkUrl.trim() || null,
      placement,
      deviceTarget,
      startsAt: toIsoDatetime(startsAt),
      endsAt: toIsoDatetime(endsAt),
      status,
      sortOrder,
      isActive: initialData?.isActive ?? true,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border bg-white p-4">
      {/* Image */}
      {imageUrl ? (
        <div className="relative">
          <img
            src={imageUrl}
            alt="배너 미리보기"
            className={`${uploadRatioClass} w-full rounded-lg object-cover`}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() =>
              document.getElementById('banner-image-input')?.click()
            }
          >
            이미지 변경
          </Button>
        </div>
      ) : (
        <div
          className={`flex ${uploadRatioClass} cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 transition-colors hover:border-primary hover:bg-primary/5`}
          onClick={() =>
            document.getElementById('banner-image-input')?.click()
          }
        >
          <Upload className="mb-2 h-8 w-8 text-gray-400" />
          <p className="text-sm text-gray-500">배너 이미지 업로드</p>
          <p className="mt-1 text-xs text-gray-400">{uploadGuidance}</p>
        </div>
      )}
      <input
        id="banner-image-input"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        aria-label="배너 이미지 파일"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleImageUpload(file);
        }}
      />

      {/* Link URL */}
      <div>
        <label htmlFor="banner-link" className="mb-1 block text-sm font-semibold">
          링크 URL (선택)
        </label>
        <Input
          id="banner-link"
          type="url"
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          placeholder="https://..."
        />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label htmlFor="banner-placement" className="mb-1 block text-sm font-semibold">
            배너 위치
          </label>
          <Select
            value={placement}
            onValueChange={(value) => setPlacement(value as BannerPlacement)}
          >
            <SelectTrigger
              id="banner-placement"
              className="h-11 w-full rounded-lg border-gray-200 bg-white text-base"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PLACEMENT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1 text-xs text-gray-500">
            {deviceTarget === 'mobile'
              ? '모바일 홈에서는 모바일 또는 전체 배너만 표시됩니다.'
              : deviceTarget === 'desktop'
                ? '데스크톱 홈에서는 데스크톱 또는 전체 배너만 표시됩니다.'
                : '전체 배너는 모바일과 데스크톱에 함께 표시됩니다.'}
          </p>
        </div>

        <div>
          <label htmlFor="banner-device-target" className="mb-1 block text-sm font-semibold">
            기기 대상
          </label>
          <Select
            value={deviceTarget}
            onValueChange={(value) =>
              setDeviceTarget(value as BannerDeviceTarget)
            }
          >
            <SelectTrigger
              id="banner-device-target"
              className="h-11 w-full rounded-lg border-gray-200 bg-white text-base"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DEVICE_TARGET_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label htmlFor="banner-status" className="mb-1 block text-sm font-semibold">
            배너 상태
          </label>
          <Select
            value={status}
            onValueChange={(value) => setStatus(value as BannerStatus)}
          >
            <SelectTrigger
              id="banner-status"
              className="h-11 w-full rounded-lg border-gray-200 bg-white text-base"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="banner-starts-at" className="mb-1 block text-sm font-semibold">
            배너 시작 시각
          </label>
          <Input
            id="banner-starts-at"
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        </div>

        <div>
          <label htmlFor="banner-ends-at" className="mb-1 block text-sm font-semibold">
            배너 종료 시각
          </label>
          <Input
            id="banner-ends-at"
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
          />
        </div>
      </div>

      {/* Sort Order */}
      <div>
        <label htmlFor="banner-sort" className="mb-1 block text-sm font-semibold">
          순서
        </label>
        <Input
          id="banner-sort"
          type="number"
          value={sortOrder}
          onChange={(e) => setSortOrder(Number(e.target.value))}
          min={0}
        />
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
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
