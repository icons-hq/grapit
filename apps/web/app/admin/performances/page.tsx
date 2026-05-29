'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { useAdminPerformances, useDeletePerformance } from '@/hooks/use-admin';
import { StatusFilter } from '@/components/admin/status-filter';
import { StatusBadge } from '@/components/performance/status-badge';
import { PaginationNav } from '@/components/performance/pagination-nav';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { GENRE_LABELS } from '@grabit/shared';
import type { Genre, PerformanceStatus } from '@grabit/shared';
import { toast } from 'sonner';

export default function AdminPerformancesPage() {
  const router = useRouter();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);

  // Debounce search input by 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading, isError } = useAdminPerformances({
    status: status || undefined,
    search: debouncedSearch || undefined,
    page,
  });

  const deleteMutation = useDeletePerformance();

  function handleDelete(id: string) {
    deleteMutation.mutate(id, {
      onSuccess: () => {
        toast.success('공연이 삭제되었습니다.');
      },
      onError: (error) => {
        toast.error('공연을 삭제할 수 없습니다.', {
          description: error instanceof Error ? error.message : undefined,
        });
      },
    });
  }

  function formatDateRange(
    start: string,
    end: string,
    performanceStatus: PerformanceStatus,
  ): string {
    if (performanceStatus === 'upcoming') {
      return '오픈예정';
    }

    const startDate = new Date(start).toLocaleDateString('ko-KR');
    const endDate = new Date(end).toLocaleDateString('ko-KR');
    return `${startDate} ~ ${endDate}`;
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-display font-semibold leading-[1.2]">공연 관리</h1>
        <Link href="/admin/performances/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            공연 등록
          </Button>
        </Link>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <StatusFilter value={status} onChange={(v) => { setStatus(v); setPage(1); }} />
        <Input
          type="search"
          placeholder="공연명으로 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:ml-auto sm:w-64"
          aria-label="공연 검색"
        />
      </div>

      <div className="rounded-lg bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col" className="w-16">포스터</TableHead>
              <TableHead scope="col">공연명</TableHead>
              <TableHead scope="col" className="hidden md:table-cell">장르</TableHead>
              <TableHead scope="col" className="hidden lg:table-cell">기간</TableHead>
              <TableHead scope="col">상태</TableHead>
              <TableHead scope="col" className="w-16">액션</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <>
                {Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={`skeleton-${i}`} className="h-[52px]">
                    <TableCell><Skeleton className="h-12 w-12 rounded" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-8" /></TableCell>
                  </TableRow>
                ))}
              </>
            )}

            {isError && (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-gray-500">
                  <p>데이터를 불러오지 못했습니다. 새로고침하거나 잠시 후 다시 시도해주세요.</p>
                  <button
                    onClick={() => window.location.reload()}
                    className="mt-3 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    새로고침
                  </button>
                </TableCell>
              </TableRow>
            )}

            {!isLoading && !isError && data?.data.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-gray-500">
                  등록된 공연이 없습니다. 첫 공연을 등록해보세요.
                </TableCell>
              </TableRow>
            )}

            {data?.data.map((perf) => (
              <TableRow
                key={perf.id}
                className="h-[52px] cursor-pointer hover:bg-gray-50"
                onClick={() => router.push(`/admin/performances/${perf.id}/edit`)}
                aria-label={`${perf.title} 수정 페이지로 이동`}
              >
                <TableCell>
                  {perf.posterUrl ? (
                    <img
                      src={perf.posterUrl}
                      alt={`${perf.title} 포스터`}
                      className="h-12 w-12 rounded object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded bg-gray-200 text-xs text-gray-400">
                      N/A
                    </div>
                  )}
                </TableCell>
                <TableCell className="font-semibold">{perf.title}</TableCell>
                <TableCell className="hidden md:table-cell">
                  {GENRE_LABELS[perf.genre as Genre]}
                </TableCell>
                <TableCell className="hidden lg:table-cell text-sm text-gray-600">
                  {formatDateRange(perf.startDate, perf.endDate, perf.status)}
                </TableCell>
                <TableCell>
                  <StatusBadge status={perf.status} />
                </TableCell>
                <TableCell>
                  <AlertDialog>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-gray-400 hover:text-red-600"
                              onClick={(e) => e.stopPropagation()}
                              aria-label={`${perf.title} 삭제`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                        </TooltipTrigger>
                        <TooltipContent>삭제</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                      <AlertDialogHeader>
                        <AlertDialogTitle>공연을 삭제하시겠습니까?</AlertDialogTitle>
                        <AlertDialogDescription>
                          이 공연의 모든 정보(회차, 캐스팅, 좌석맵)가 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>취소</AlertDialogCancel>
                        <AlertDialogAction
                          variant="destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(perf.id);
                          }}
                        >
                          삭제
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {data && data.totalPages > 1 && (
        <div className="mt-6 flex justify-center">
          <PaginationNav
            currentPage={data.page}
            totalPages={data.totalPages}
            onPageChange={setPage}
          />
        </div>
      )}
    </div>
  );
}
