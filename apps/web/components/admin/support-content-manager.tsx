'use client';

import { useEffect, useMemo, useState } from 'react';
import { Archive, CheckCircle2, Pencil, Plus, Send } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/cn';
import {
  useAdminSupportContent,
  useArchiveSupportFaq,
  useArchiveSupportNotice,
  useCreateSupportFaq,
  useCreateSupportNotice,
  usePublishSupportFaq,
  usePublishSupportNotice,
  useReviewSupportFaq,
  useReviewSupportNotice,
  useUpdateSupportFaq,
  useUpdateSupportNotice,
  type AdminSupportFaq,
  type AdminSupportNotice,
  type SupportContentLocale,
  type SupportContentTranslationUse,
  type SupportContentType,
  type SupportFaqCategory,
  type SupportNoticeCategory,
} from '@/hooks/use-admin-support-content';

const FAQ_CATEGORY_OPTIONS: Array<{ value: SupportFaqCategory; label: string }> = [
  { value: 'general', label: '일반' },
  { value: 'event_info', label: '공연 정보' },
  { value: 'booking', label: '예매' },
  { value: 'payment_error', label: '결제 오류' },
  { value: 'refund_unprocessed', label: '환불 미처리' },
  { value: 'refund_dispute', label: '환불 분쟁' },
  { value: 'signup_failure', label: '가입 실패' },
  { value: 'account', label: '계정' },
  { value: 'ticket_delivery', label: '티켓 수령' },
  { value: 'seat_accessibility', label: '좌석 접근성' },
  { value: 'abuse_fraud', label: '부정 이용' },
  { value: 'other', label: '기타' },
];

const NOTICE_CATEGORY_OPTIONS: Array<{
  value: SupportNoticeCategory;
  label: string;
}> = [
  { value: 'general', label: '일반' },
  { value: 'urgent', label: '긴급' },
  { value: 'maintenance', label: '점검' },
  { value: 'payment', label: '결제' },
  { value: 'refund', label: '환불' },
  { value: 'signup', label: '가입' },
  { value: 'event', label: '공연' },
];

const LOCALE_OPTIONS: Array<{ value: SupportContentLocale; label: string }> = [
  { value: 'ko', label: '한국어' },
  { value: 'en', label: 'English' },
  { value: 'th', label: 'ไทย' },
  { value: 'zh-CN', label: '简体中文' },
];

const REVIEW_STATE_LABELS = {
  draft: '초안',
  review: '검수 필요',
  approved: '게시 가능',
  published: '게시됨',
  archived: '보관됨',
};

type SupportContentItem =
  | ({ type: 'faq' } & AdminSupportFaq)
  | ({ type: 'notice' } & AdminSupportNotice);

interface FormState {
  locale: SupportContentLocale;
  category: SupportFaqCategory | SupportNoticeCategory;
  title: string;
  body: string;
  translationUse: SupportContentTranslationUse;
}

const initialFaqForm: FormState = {
  locale: 'ko',
  category: 'booking',
  title: '',
  body: '',
  translationUse: 'manual',
};

const initialNoticeForm: FormState = {
  locale: 'ko',
  category: 'general',
  title: '',
  body: '',
  translationUse: 'manual',
};

export function SupportContentManager() {
  const [activeType, setActiveType] = useState<SupportContentType>('faq');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<FormState>(initialFaqForm);

  const supportContent = useAdminSupportContent({ includeArchived: true });
  const createFaq = useCreateSupportFaq();
  const updateFaq = useUpdateSupportFaq();
  const reviewFaq = useReviewSupportFaq();
  const publishFaq = usePublishSupportFaq();
  const archiveFaq = useArchiveSupportFaq();
  const createNotice = useCreateSupportNotice();
  const updateNotice = useUpdateSupportNotice();
  const reviewNotice = useReviewSupportNotice();
  const publishNotice = usePublishSupportNotice();
  const archiveNotice = useArchiveSupportNotice();

  const items = useMemo(() => {
    const data = supportContent.data;
    const faqs = (data?.faqs ?? []).map((row) => ({
      ...row,
      type: 'faq' as const,
    }));
    const notices = (data?.notices ?? []).map((row) => ({
      ...row,
      type: 'notice' as const,
    }));
    return { faq: faqs, notice: notices };
  }, [supportContent.data]);

  const activeItems = items[activeType];
  const selectedItem =
    activeItems.find((item) => item.id === selectedId) ?? activeItems[0] ?? null;

  useEffect(() => {
    setSelectedId(activeItems[0]?.id ?? null);
  }, [activeType, activeItems]);

  function startCreate(type: SupportContentType) {
    setActiveType(type);
    setIsCreating(true);
    setIsEditing(false);
    setForm(type === 'faq' ? initialFaqForm : initialNoticeForm);
  }

  function startEdit(item: SupportContentItem) {
    setSelectedId(item.id);
    setIsCreating(false);
    setIsEditing(true);
    setForm({
      locale: item.locale,
      category: item.category,
      title: item.type === 'faq' ? item.question : item.title,
      body: item.type === 'faq' ? item.answer : item.body,
      translationUse: item.translationUse === 'assisted' ? 'assisted' : 'manual',
    });
  }

  async function handleSave() {
    if (!form.title.trim() || !form.body.trim()) return;

    if (isEditing && selectedItem) {
      if (selectedItem.type === 'faq') {
        await updateFaq.mutateAsync({
          id: selectedItem.id,
          input: {
            category: form.category as SupportFaqCategory,
            question: form.title.trim(),
            answer: form.body.trim(),
            translationUse: form.translationUse,
          },
        });
      } else {
        await updateNotice.mutateAsync({
          id: selectedItem.id,
          input: {
            category: form.category as SupportNoticeCategory,
            title: form.title.trim(),
            body: form.body.trim(),
            translationUse: form.translationUse,
          },
        });
      }
    } else if (activeType === 'faq') {
      await createFaq.mutateAsync({
        category: form.category as SupportFaqCategory,
        locale: form.locale,
        question: form.title.trim(),
        answer: form.body.trim(),
        translationUse: form.translationUse,
      });
    } else {
      await createNotice.mutateAsync({
        category: form.category as SupportNoticeCategory,
        locale: form.locale,
        title: form.title.trim(),
        body: form.body.trim(),
        translationUse: form.translationUse,
      });
    }

    setIsCreating(false);
    setIsEditing(false);
    setForm(activeType === 'faq' ? initialFaqForm : initialNoticeForm);
  }

  async function handleReview(item: SupportContentItem) {
    if (item.type === 'faq') {
      await reviewFaq.mutateAsync(item.id);
      return;
    }
    await reviewNotice.mutateAsync(item.id);
  }

  async function handlePublish(item: SupportContentItem) {
    if (item.type === 'faq') {
      await publishFaq.mutateAsync(item.id);
      return;
    }
    await publishNotice.mutateAsync(item.id);
  }

  async function handleArchive(item: SupportContentItem) {
    if (item.type === 'faq') {
      await archiveFaq.mutateAsync(item.id);
      return;
    }
    await archiveNotice.mutateAsync(item.id);
  }

  const categoryOptions =
    activeType === 'faq' ? FAQ_CATEGORY_OPTIONS : NOTICE_CATEGORY_OPTIONS;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-display font-semibold leading-[1.2]">
            고객지원 콘텐츠
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            FAQ와 공지를 작성하고 검수 상태에 맞춰 게시합니다.
          </p>
        </div>
        <a
          href="/admin/operations?source=notice_followup"
          className="inline-flex h-10 items-center justify-center rounded-md border border-input px-3 text-sm font-semibold text-gray-900 hover:bg-gray-50"
        >
          운영 인박스에서 보기
        </a>
      </div>

      {supportContent.isLoading && (
        <div className="rounded-lg bg-white p-6 text-sm text-gray-600 shadow-sm">
          불러오는 중
        </div>
      )}

      {!supportContent.isLoading && (
        <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="지원 콘텐츠 유형"
          className="inline-flex rounded-lg border bg-white p-1 shadow-sm"
        >
          {(['faq', 'notice'] as const).map((type) => (
            <button
              key={type}
              type="button"
              role="tab"
              aria-selected={activeType === type}
              className={cn(
                'h-9 rounded-md px-4 text-sm font-semibold',
                activeType === type
                  ? 'bg-primary text-white'
                  : 'text-gray-700 hover:bg-gray-50',
              )}
              onClick={() => {
                setActiveType(type);
                setIsCreating(false);
                setIsEditing(false);
              }}
            >
              {type === 'faq' ? 'FAQ' : '공지'}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <Button type="button" onClick={() => startCreate('faq')}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            FAQ 등록
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => startCreate('notice')}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            공지 등록
          </Button>
        </div>
      </div>

      {supportContent.isError && (
        <div
          role="alert"
          className="rounded-lg bg-[#FEF2F2] p-4 text-sm font-semibold text-[#C62828]"
        >
          고객지원 콘텐츠를 불러오지 못했습니다.
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="overflow-hidden rounded-lg bg-white shadow-sm">
          <div className="grid grid-cols-[minmax(0,1fr)_120px_130px_110px] gap-3 bg-[#F5F5F7] px-4 py-3 text-sm font-semibold text-gray-700">
            <span>콘텐츠</span>
            <span>언어</span>
            <span>상태</span>
            <span>액션</span>
          </div>
          {supportContent.isLoading && (
            <p className="px-4 py-8 text-sm text-gray-600">불러오는 중</p>
          )}
          {!supportContent.isLoading && activeItems.length === 0 && (
            <p className="px-4 py-8 text-sm text-gray-600">
              등록된 콘텐츠가 없습니다.
            </p>
          )}
          {!supportContent.isLoading &&
            activeItems.map((item) => (
              <div
                key={item.id}
                className={cn(
                  'grid grid-cols-[minmax(0,1fr)_120px_130px_110px] gap-3 border-t px-4 py-3 text-sm',
                  selectedItem?.id === item.id && 'bg-[#F3EFFF]',
                )}
              >
                <button
                  type="button"
                  className="min-w-0 text-left font-semibold text-gray-900 hover:text-primary"
                  onClick={() => {
                    setSelectedId(item.id);
                    setIsCreating(false);
                    setIsEditing(false);
                  }}
                  aria-label={item.type === 'faq' ? item.question : item.title}
                >
                  <span className="line-clamp-2">
                    {item.type === 'faq' ? item.question : item.title}
                  </span>
                  {item.translationUseLabel && (
                    <span className="mt-1 inline-flex text-xs font-semibold text-[#8B6306]">
                      {item.translationUseLabel}
                    </span>
                  )}
                </button>
                <span>{localeLabel(item.locale)}</span>
                <span>
                  <ReviewStateBadge state={item.reviewState} />
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => startEdit(item)}
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                  수정
                </Button>
              </div>
            ))}
        </section>

        <aside className="space-y-4">
          {(isCreating || isEditing) && (
            <section className="rounded-lg bg-white p-4 shadow-sm">
              <h2 className="text-heading font-semibold leading-[1.2]">
                {isEditing ? '콘텐츠 수정' : activeType === 'faq' ? 'FAQ 등록' : '공지 등록'}
              </h2>
              <div className="mt-4 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="support-content-locale">언어</Label>
                    <select
                      id="support-content-locale"
                      value={form.locale}
                      disabled={isEditing}
                      className="flex h-11 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:bg-[#F5F5F7]"
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          locale: event.target.value as SupportContentLocale,
                          translationUse:
                            event.target.value === 'ko' ||
                            event.target.value === 'en'
                              ? 'manual'
                              : current.translationUse,
                        }))
                      }
                    >
                      {LOCALE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="support-content-category">카테고리</Label>
                    <select
                      id="support-content-category"
                      value={form.category}
                      className="flex h-11 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          category: event.target.value as FormState['category'],
                        }))
                      }
                    >
                      {categoryOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="support-content-title">제목</Label>
                  <Input
                    id="support-content-title"
                    value={form.title}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        title: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="support-content-body">내용</Label>
                  <Textarea
                    id="support-content-body"
                    value={form.body}
                    rows={7}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        body: event.target.value,
                      }))
                    }
                  />
                </div>
                <label className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                  <input
                    type="checkbox"
                    checked={form.translationUse === 'assisted'}
                    disabled={form.locale === 'ko' || form.locale === 'en'}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        translationUse: event.target.checked
                          ? 'assisted'
                          : 'manual',
                      }))
                    }
                  />
                  자동 번역 검수본
                </label>
                <Button
                  type="button"
                  className="w-full"
                  disabled={!form.title.trim() || !form.body.trim()}
                  onClick={() => void handleSave()}
                >
                  저장
                </Button>
              </div>
            </section>
          )}

          {selectedItem && !isCreating && !isEditing && (
            <section className="rounded-lg bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-heading font-semibold leading-[1.2]">
                    선택 항목
                  </h2>
                  <p className="mt-1 text-sm text-gray-600">
                    {localeLabel(selectedItem.locale)} · {selectedItem.category}
                  </p>
                </div>
                <ReviewStateBadge state={selectedItem.reviewState} />
              </div>

              {selectedItem.translationUseLabel && (
                <Badge className="mt-3 border-transparent bg-[#FFFBEB] text-[#8B6306]">
                  {selectedItem.translationUseLabel}
                </Badge>
              )}

              <div className="mt-4 whitespace-pre-wrap rounded-lg border bg-[#F5F5F7] p-3 text-sm text-gray-900">
                {selectedItem.type === 'faq'
                  ? selectedItem.answer
                  : selectedItem.body}
              </div>

              <div className="mt-4 grid gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleReview(selectedItem)}
                >
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  검수 완료
                </Button>
                <Button
                  type="button"
                  disabled={!selectedItem.canPublish}
                  onClick={() => void handlePublish(selectedItem)}
                >
                  <Send className="h-4 w-4" aria-hidden="true" />
                  게시
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleArchive(selectedItem)}
                >
                  <Archive className="h-4 w-4" aria-hidden="true" />
                  보관
                </Button>
              </div>
            </section>
          )}
        </aside>
      </div>
        </>
      )}
    </div>
  );
}

function ReviewStateBadge({ state }: { state: keyof typeof REVIEW_STATE_LABELS }) {
  const className = state === 'published'
    ? 'bg-[#F0FDF4] text-[#15803D] border-transparent'
    : state === 'archived'
      ? 'bg-[#F5F5F7] text-gray-700 border-transparent'
      : state === 'review'
        ? 'bg-[#FFFBEB] text-[#8B6306] border-transparent'
        : 'bg-[#EEF2FF] text-[#3730A3] border-transparent';

  return <Badge className={className}>{REVIEW_STATE_LABELS[state]}</Badge>;
}

function localeLabel(locale: SupportContentLocale): string {
  return LOCALE_OPTIONS.find((option) => option.value === locale)?.label ?? locale;
}
