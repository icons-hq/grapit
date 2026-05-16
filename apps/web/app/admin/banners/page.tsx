'use client';

import { useState } from 'react';
import { Plus, Pencil, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import {
  useAdminBanners,
  useCreateBanner,
  useUpdateBanner,
  useDeleteBanner,
  useReorderBanners,
} from '@/hooks/use-admin';
import { BannerForm } from '@/components/admin/banner-manager';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
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
import type { Banner } from '@grabit/shared';

export default function AdminBannersPage() {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingBannerId, setEditingBannerId] = useState<string | null>(null);

  const { data: banners, isLoading, isError } = useAdminBanners();
  const createBanner = useCreateBanner();
  const deleteBanner = useDeleteBanner();
  const reorderBanners = useReorderBanners();

  function handleDelete(id: string) {
    deleteBanner.mutate(id, {
      onSuccess: () => toast.success('배너가 삭제되었습니다.'),
      onError: () => toast.error('배너 삭제에 실패했습니다.'),
    });
  }

  function handleMoveUp(index: number) {
    if (!banners || index === 0) return;
    const ids = banners.map((b) => b.id);
    [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
    reorderBanners.mutate(ids);
  }

  function handleMoveDown(index: number) {
    if (!banners || index >= banners.length - 1) return;
    const ids = banners.map((b) => b.id);
    [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
    reorderBanners.mutate(ids);
  }

  const sortedBanners = banners
    ? [...banners].sort((a, b) => a.sortOrder - b.sortOrder)
    : [];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-display font-semibold leading-[1.2]">배너 관리</h1>
        {!showCreateForm && (
          <Button onClick={() => setShowCreateForm(true)}>
            <Plus className="mr-2 h-4 w-4" />
            배너 등록
          </Button>
        )}
      </div>

      {/* Create form */}
      {showCreateForm && (
        <div className="mb-6">
          <BannerForm
            onSubmit={async (data) => {
              await createBanner.mutateAsync(data);
              setShowCreateForm(false);
              toast.success('배너가 등록되었습니다.');
            }}
            onCancel={() => setShowCreateForm(false)}
            isSubmitting={createBanner.isPending}
          />
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="aspect-video rounded-lg" />
          ))}
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="py-12 text-center text-gray-500">
          <p>데이터를 불러오지 못했습니다. 새로고침하거나 잠시 후 다시 시도해주세요.</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-3 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
          >
            새로고침
          </button>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !isError && sortedBanners.length === 0 && !showCreateForm && (
        <div className="py-12 text-center text-gray-500">
          등록된 배너가 없습니다. 홈 캐러셀에 표시할 배너를 등록해보세요.
        </div>
      )}

      {/* Banner list */}
      {!isLoading && sortedBanners.length > 0 && (
        <div className="space-y-4">
          {sortedBanners.map((banner, index) => (
            <BannerCard
              key={banner.id}
              banner={banner}
              index={index}
              totalCount={sortedBanners.length}
              isEditing={editingBannerId === banner.id}
              onEdit={() => setEditingBannerId(banner.id)}
              onCancelEdit={() => setEditingBannerId(null)}
              onDelete={() => handleDelete(banner.id)}
              onMoveUp={() => handleMoveUp(index)}
              onMoveDown={() => handleMoveDown(index)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BannerCard({
  banner,
  index,
  totalCount,
  isEditing,
  onEdit,
  onCancelEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  banner: Banner;
  index: number;
  totalCount: number;
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const updateBanner = useUpdateBanner(banner.id);

  if (isEditing) {
    return (
      <BannerForm
        initialData={{
          imageUrl: banner.imageUrl,
          linkUrl: banner.linkUrl ?? '',
          placement: banner.placement,
          deviceTarget: banner.deviceTarget,
          startsAt: banner.startsAt,
          endsAt: banner.endsAt,
          status: banner.status,
          sortOrder: banner.sortOrder,
          isActive: banner.isActive,
        }}
        onSubmit={async (data) => {
          await updateBanner.mutateAsync(data);
          onCancelEdit();
          toast.success('배너가 수정되었습니다.');
        }}
        onCancel={onCancelEdit}
        isSubmitting={updateBanner.isPending}
      />
    );
  }

  return (
    <div className="flex items-center gap-4 rounded-lg bg-white p-4 shadow-sm">
      {/* Reorder buttons */}
      <div className="flex flex-col gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onMoveUp}
          disabled={index === 0}
          aria-label="위로 이동"
        >
          <ChevronUp className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onMoveDown}
          disabled={index >= totalCount - 1}
          aria-label="아래로 이동"
        >
          <ChevronDown className="h-4 w-4" />
        </Button>
      </div>

      {/* Thumbnail */}
      <img
        src={banner.imageUrl}
        alt={`배너 ${banner.sortOrder + 1}`}
        className="aspect-video h-20 rounded object-cover"
      />

      {/* Info */}
      <div className="flex-1">
        <p className="text-sm font-semibold">
          순서: {banner.sortOrder + 1}
        </p>
        {banner.linkUrl && (
          <p className="truncate text-xs text-gray-500">{banner.linkUrl}</p>
        )}
        <p className="text-xs text-gray-400">
          {banner.placement} · {banner.deviceTarget} · {banner.status} ·{' '}
          {banner.isActive ? '활성' : '비활성'}
        </p>
      </div>

      {/* Actions */}
      <div className="flex gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={onEdit}
          aria-label="배너 수정"
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-gray-400 hover:text-red-600"
              aria-label="배너 삭제"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>배너를 삭제하시겠습니까?</AlertDialogTitle>
              <AlertDialogDescription>
                홈 캐러셀에서 해당 배너가 제거됩니다.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>취소</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={onDelete}>
                삭제
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
