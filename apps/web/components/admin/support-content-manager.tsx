'use client';

import { useMemo, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  Languages,
  Pencil,
  Plus,
  Send,
} from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
  type SupportContentReviewState,
  type SupportContentTranslationUse,
  type SupportContentType,
  type SupportFaqCategory,
  type SupportNoticeCategory,
  type SupportNoticePriority,
  type UpdateSupportFaqInput,
  type UpdateSupportNoticeInput,
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

const PRIORITY_OPTIONS: Array<{ value: SupportNoticePriority; label: string }> = [
  { value: 'urgent', label: '긴급' },
  { value: 'high', label: '높음' },
  { value: 'normal', label: '보통' },
  { value: 'low', label: '낮음' },
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

/** Must match LOCALE_FALLBACK_NOTICE_CATEGORIES in the API. */
const LOCALE_FALLBACK_CATEGORIES = new Set<SupportNoticeCategory>([
  'urgent',
  'maintenance',
  'payment',
]);

type SupportContentItem =
  | ({ type: 'faq' } & AdminSupportFaq)
  | ({ type: 'notice' } & AdminSupportNotice);

interface FormState {
  locale: SupportContentLocale;
  category: SupportFaqCategory | SupportNoticeCategory;
  title: string;
  body: string;
  translationUse: SupportContentTranslationUse;
  priority: SupportNoticePriority;
  /** datetime-local value in the operator's browser time zone. */
  scheduledAt: string;
  endsAt: string;
}

/** The row being edited, pinned when editing starts so refetches cannot retarget the save. */
interface EditTarget {
  type: SupportContentType;
  id: string;
  updatedAt: string;
  reviewState: SupportContentReviewState;
  original: FormState;
}

interface SaveError {
  message: string;
  conflict: boolean;
}

const initialFaqForm: FormState = {
  locale: 'ko',
  category: 'booking',
  title: '',
  body: '',
  translationUse: 'manual',
  priority: 'normal',
  scheduledAt: '',
  endsAt: '',
};

const initialNoticeForm: FormState = {
  locale: 'ko',
  category: 'general',
  title: '',
  body: '',
  translationUse: 'manual',
  priority: 'normal',
  scheduledAt: '',
  endsAt: '',
};

export function SupportContentManager() {
  const [activeType, setActiveType] = useState<SupportContentType>('faq');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [translationSource, setTranslationSource] =
    useState<AdminSupportNotice | null>(null);
  const [form, setForm] = useState<FormState>(initialFaqForm);
  const [saveError, setSaveError] = useState<SaveError | null>(null);
  const [confirmUnpublishOpen, setConfirmUnpublishOpen] = useState(false);
  const [confirmReloadOpen, setConfirmReloadOpen] = useState(false);
  const isEditing = editTarget !== null;

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
  const isSaving =
    createFaq.isPending ||
    updateFaq.isPending ||
    createNotice.isPending ||
    updateNotice.isPending;

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
  // The selection survives refetches because it is keyed by id; the first row
  // is only a display fallback (e.g. after a tab switch). Saves never use it:
  // they target the row pinned in editTarget.
  const selectedItem =
    activeItems.find((item) => item.id === selectedId) ?? activeItems[0] ?? null;

  const formType: SupportContentType = editTarget?.type ?? activeType;
  const translationLocales = translationSource
    ? new Set(
        groupMembers(translationSource, items.notice).map((notice) => notice.locale),
      )
    : null;

  function closeForm() {
    setIsCreating(false);
    setEditTarget(null);
    setTranslationSource(null);
    setSaveError(null);
    setConfirmUnpublishOpen(false);
    setConfirmReloadOpen(false);
  }

  function startCreate(type: SupportContentType) {
    closeForm();
    setActiveType(type);
    setIsCreating(true);
    setForm(type === 'faq' ? initialFaqForm : initialNoticeForm);
  }

  function startCreateTranslation(source: AdminSupportNotice) {
    const existingLocales = new Set(
      groupMembers(source, items.notice).map((notice) => notice.locale),
    );
    const locale =
      LOCALE_OPTIONS.find((option) => !existingLocales.has(option.value))
        ?.value ?? source.locale;

    closeForm();
    setActiveType('notice');
    setIsCreating(true);
    setTranslationSource(source);
    setForm({
      ...initialNoticeForm,
      locale,
      category: source.category,
      priority: source.priority,
      scheduledAt: toDatetimeLocal(source.scheduledAt),
      endsAt: toDatetimeLocal(source.endsAt),
    });
  }

  function startEdit(item: SupportContentItem) {
    const original = formFromItem(item);
    closeForm();
    setSelectedId(item.id);
    setEditTarget({
      type: item.type,
      id: item.id,
      updatedAt: item.updatedAt,
      reviewState: item.reviewState,
      original,
    });
    setForm(original);
  }

  async function reopenLatest() {
    if (!editTarget) return;
    const result = await supportContent.refetch();
    const latest = editTarget.type === 'faq'
      ? result.data?.faqs.find((row) => row.id === editTarget.id)
      : result.data?.notices.find((row) => row.id === editTarget.id);
    if (!latest) return;
    startEdit({ ...latest, type: editTarget.type } as SupportContentItem);
  }

  async function handleSave(options: { confirmedUnpublish?: boolean } = {}) {
    if (!form.title.trim() || !form.body.trim()) return;
    setSaveError(null);

    try {
      if (editTarget) {
        if (!options.confirmedUnpublish && editWillUnpublish(editTarget, form)) {
          setConfirmUnpublishOpen(true);
          return;
        }
        setConfirmUnpublishOpen(false);

        if (editTarget.type === 'faq') {
          const input = buildFaqUpdate(editTarget, form);
          if (input) {
            await updateFaq.mutateAsync({ id: editTarget.id, input });
          }
        } else {
          const input = buildNoticeUpdate(editTarget, form);
          if (input) {
            await updateNotice.mutateAsync({ id: editTarget.id, input });
          }
        }
        setSelectedId(editTarget.id);
      } else if (activeType === 'faq') {
        await createFaq.mutateAsync({
          category: form.category as SupportFaqCategory,
          locale: form.locale,
          question: form.title.trim(),
          answer: form.body.trim(),
          translationUse: form.translationUse,
        });
      } else {
        const scheduledAt = toIsoDatetime(form.scheduledAt);
        const endsAt = toIsoDatetime(form.endsAt);
        await createNotice.mutateAsync({
          category: form.category as SupportNoticeCategory,
          locale: form.locale,
          title: form.title.trim(),
          body: form.body.trim(),
          priority: form.priority,
          translationUse: form.translationUse,
          ...(scheduledAt ? { scheduledAt } : {}),
          ...(endsAt ? { endsAt } : {}),
          ...(translationSource
            ? { translationOfNoticeId: translationSource.id }
            : {}),
        });
      }
    } catch (error) {
      setConfirmUnpublishOpen(false);
      setSaveError({
        message:
          error instanceof Error && error.message
            ? error.message
            : '저장하지 못했습니다. 잠시 후 다시 시도해주세요.',
        conflict: isConflictError(error),
      });
      return;
    }

    closeForm();
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
    formType === 'faq' ? FAQ_CATEGORY_OPTIONS : NOTICE_CATEGORY_OPTIONS;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-display font-semibold leading-[1.2]">
            공지·자주 묻는 질문
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            고객에게 보여줄 공지와 자주 묻는 질문을 작성하고 게시합니다.
          </p>
        </div>
        <a
          href="/admin/operations"
          className="inline-flex h-10 items-center justify-center rounded-md border border-input px-3 text-sm font-semibold text-gray-900 hover:bg-gray-50"
        >
          고객 문의에서 보기
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
                closeForm();
                setActiveType(type);
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
          공지·자주 묻는 질문를 불러오지 못했습니다.
        </div>
      )}

      <div className={cn("grid gap-4", (selectedItem || isCreating || isEditing) && "xl:grid-cols-[minmax(0,1fr)_420px]")}>
        <section className="overflow-hidden rounded-lg bg-white shadow-sm">
          <div className="grid grid-cols-[minmax(0,1fr)_72px_64px] sm:grid-cols-[minmax(0,1fr)_90px_100px_90px] gap-3 bg-[#F5F5F7] px-4 py-3 text-sm font-semibold text-gray-700">
            <span>콘텐츠</span>
            <span className="hidden sm:block">언어</span>
            <span>상태</span>
            <span>관리</span>
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
                  'grid grid-cols-[minmax(0,1fr)_72px_64px] sm:grid-cols-[minmax(0,1fr)_90px_100px_90px] gap-3 border-t px-4 py-3 text-sm',
                  selectedItem?.id === item.id && 'bg-[#F3EFFF]',
                )}
              >
                <button
                  type="button"
                  className="min-w-0 text-left font-semibold text-gray-900 hover:text-primary"
                  onClick={() => {
                    closeForm();
                    setSelectedId(item.id);
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
                <span className="hidden sm:block">{localeLabel(item.locale)}</span>
                <span>
                  <ReviewStateBadge state={item.reviewState} />
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`${item.type === 'faq' ? item.question : item.title} 수정`}
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
                {isEditing
                  ? '콘텐츠 수정'
                  : translationSource
                    ? '번역본 등록'
                    : activeType === 'faq'
                      ? 'FAQ 등록'
                      : '공지 등록'}
              </h2>
              {translationSource && (
                <p className="mt-2 text-sm text-gray-600">
                  {localeLabel(translationSource.locale)} 공지 「{translationSource.title}」의
                  번역본으로 연결합니다.
                </p>
              )}
              {isCreating &&
                formType === 'notice' &&
                !translationSource &&
                form.locale !== 'ko' &&
                LOCALE_FALLBACK_CATEGORIES.has(form.category as SupportNoticeCategory) && (
                  <p role="note" className="mt-2 rounded-lg bg-[#FFFBEB] p-3 text-sm text-[#8B6306]">
                    기존 공지의 번역이면 원문 공지에서 번역본 등록을 사용하세요. 따로
                    등록하면 원문이 함께 노출됩니다.
                  </p>
                )}
              {editTarget?.reviewState === 'published' && (
                <p className="mt-2 text-sm text-gray-600">
                  게시 중인 콘텐츠입니다. 저장하면 공개 화면에 반영됩니다(최대 1분 지연).
                </p>
              )}
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
                        <option
                          key={option.value}
                          value={option.value}
                          disabled={translationLocales?.has(option.value) ?? false}
                        >
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="support-content-category">분류</Label>
                    <select
                      id="support-content-category"
                      value={form.category}
                      className="flex h-11 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      onChange={(event) => {
                        const category = event.target.value as FormState['category'];
                        setForm((current) => ({
                          ...current,
                          category,
                          priority:
                            formType === 'notice' && category === 'urgent'
                              ? 'urgent'
                              : current.priority,
                        }));
                      }}
                    >
                      {categoryOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {formType === 'notice' && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="support-content-priority">중요도</Label>
                      <select
                        id="support-content-priority"
                        value={form.priority}
                        className="flex h-11 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            priority: event.target.value as SupportNoticePriority,
                          }))
                        }
                      >
                        {PRIORITY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <p className="self-end text-xs text-gray-600 sm:pb-1">
                      노출 시각을 비워 두면 게시 즉시 노출되고 보관할 때까지 유지됩니다.
                    </p>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="support-content-scheduled-at">노출 시작</Label>
                      <Input
                        id="support-content-scheduled-at"
                        type="datetime-local"
                        value={form.scheduledAt}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            scheduledAt: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="support-content-ends-at">노출 종료</Label>
                      <Input
                        id="support-content-ends-at"
                        type="datetime-local"
                        value={form.endsAt}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            endsAt: event.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>
                )}
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
                {saveError && (
                  <div
                    role="alert"
                    className="space-y-2 rounded-lg bg-[#FEF2F2] p-3 text-sm text-[#C62828]"
                  >
                    <p className="font-semibold">{saveError.message}</p>
                    {saveError.conflict && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setConfirmReloadOpen(true)}
                      >
                        최신 내용 다시 불러오기
                      </Button>
                    )}
                  </div>
                )}
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={closeForm}
                  >
                    취소
                  </Button>
                  <Button
                    type="button"
                    disabled={isSaving || !form.title.trim() || !form.body.trim()}
                    onClick={() => void handleSave()}
                  >
                    저장
                  </Button>
                </div>
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
                    {localeLabel(selectedItem.locale)} · {categoryLabel(selectedItem)}
                    {selectedItem.type === 'notice' &&
                      ` · 중요도 ${priorityLabel(selectedItem.priority)}`}
                  </p>
                </div>
                <ReviewStateBadge state={selectedItem.reviewState} />
              </div>

              {selectedItem.translationUseLabel && (
                <Badge className="mt-3 border-transparent bg-[#FFFBEB] text-[#8B6306]">
                  {selectedItem.translationUseLabel}
                </Badge>
              )}

              {selectedItem.type === 'notice' &&
                (selectedItem.scheduledAt || selectedItem.endsAt) && (
                  <p className="mt-3 text-sm text-gray-600">
                    노출 기간 {formatLocalDateTime(selectedItem.scheduledAt) ?? '게시 즉시'}
                    {' ~ '}
                    {formatLocalDateTime(selectedItem.endsAt) ?? '보관 전까지'}
                  </p>
                )}

              <div className="mt-4 whitespace-pre-wrap rounded-lg border bg-[#F5F5F7] p-3 text-sm text-gray-900">
                {selectedItem.type === 'faq'
                  ? selectedItem.answer
                  : selectedItem.body}
              </div>

              {selectedItem.type === 'notice' && (
                <NoticeTranslations
                  notice={selectedItem}
                  notices={items.notice}
                  onCreateTranslation={startCreateTranslation}
                />
              )}

              <div className="mt-4 grid gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={!isReviewable(selectedItem.reviewState)}
                  onClick={() => void handleReview(selectedItem)}
                >
                  {selectedItem.reviewState === 'archived' ? (
                    <ArchiveRestore className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  )}
                  {selectedItem.reviewState === 'archived' ? '보관 해제' : '검수 완료'}
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
                  disabled={selectedItem.reviewState === 'archived'}
                  onClick={() => void handleArchive(selectedItem)}
                >
                  <Archive className="h-4 w-4" aria-hidden="true" />
                  보관
                </Button>
                {selectedItem.reviewState === 'archived' && (
                  <p className="text-sm text-gray-600">
                    보관 해제하면 게시 전 상태로 돌아갑니다. 공개하려면 이어서 게시하세요.
                    자동 번역 검수본은 다시 검수해야 합니다.
                  </p>
                )}
              </div>
            </section>
          )}
        </aside>
      </div>
        </>
      )}

      <AlertDialog
        open={confirmUnpublishOpen}
        onOpenChange={setConfirmUnpublishOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>저장하면 게시가 내려갑니다</AlertDialogTitle>
            <AlertDialogDescription>
              자동 번역 검수본을 수정하면 다시 검수해야 합니다. 저장하는 즉시
              공개 화면에서 내려가고, 검수 완료 후 다시 게시해야 노출됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>계속 수정</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void handleSave({ confirmedUnpublish: true })}
            >
              저장하고 게시 내리기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmReloadOpen} onOpenChange={setConfirmReloadOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>최신 내용을 다시 불러올까요?</AlertDialogTitle>
            <AlertDialogDescription>
              작성 중인 내용은 버려집니다. 필요하면 먼저 복사해 두세요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>계속 수정</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirmReloadOpen(false);
                void reopenLatest();
              }}
            >
              작성 내용 버리고 불러오기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function NoticeTranslations({
  notice,
  notices,
  onCreateTranslation,
}: {
  notice: AdminSupportNotice;
  notices: AdminSupportNotice[];
  onCreateTranslation: (source: AdminSupportNotice) => void;
}) {
  const members = groupMembers(notice, notices);
  const missing = LOCALE_OPTIONS.filter(
    (option) => !members.some((member) => member.locale === option.value),
  );
  const fallbackCategory = LOCALE_FALLBACK_CATEGORIES.has(notice.category);

  return (
    <div className="mt-4 space-y-2 rounded-lg border p-3 text-sm">
      <p className="font-semibold text-gray-900">언어별 공지</p>
      <ul className="space-y-1">
        {LOCALE_OPTIONS.map((option) => {
          const member = members.find((row) => row.locale === option.value);
          return (
            <li key={option.value} className="flex justify-between gap-3">
              <span>{option.label}</span>
              <span className="text-gray-600">
                {member ? REVIEW_STATE_LABELS[member.reviewState] : '없음'}
              </span>
            </li>
          );
        })}
      </ul>
      {fallbackCategory && notice.translationGroupId && (
        <p className="text-gray-600">
          게시된 번역본이 없는 언어에는 영어 공지가, 영어도 없으면 한국어 공지가
          대신 노출됩니다.
        </p>
      )}
      {fallbackCategory && !notice.translationGroupId && (
        <p className="text-gray-600">
          번역 연결 전에 등록된 공지라 다른 언어 화면에 대신 노출되지 않습니다.
          번역본을 등록하면 연결됩니다.
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={missing.length === 0 || notice.reviewState === 'archived'}
        onClick={() => onCreateTranslation(notice)}
      >
        <Languages className="h-4 w-4" aria-hidden="true" />
        번역본 등록
      </Button>
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

function formFromItem(item: SupportContentItem): FormState {
  return {
    locale: item.locale,
    category: item.category,
    title: item.type === 'faq' ? item.question : item.title,
    body: item.type === 'faq' ? item.answer : item.body,
    translationUse: item.translationUse === 'assisted' ? 'assisted' : 'manual',
    priority: item.type === 'notice' ? item.priority : 'normal',
    scheduledAt: item.type === 'notice' ? toDatetimeLocal(item.scheduledAt) : '',
    endsAt: item.type === 'notice' ? toDatetimeLocal(item.endsAt) : '',
  };
}

function contentChanged(original: FormState, form: FormState): boolean {
  return (
    form.title.trim() !== original.title.trim() ||
    form.body.trim() !== original.body.trim() ||
    form.translationUse !== original.translationUse
  );
}

/** Mirrors the API rule: only assisted translations need re-review after an edit. */
function editWillUnpublish(target: EditTarget, form: FormState): boolean {
  return (
    target.reviewState === 'published' &&
    form.locale !== 'ko' &&
    form.locale !== 'en' &&
    form.translationUse === 'assisted' &&
    contentChanged(target.original, form)
  );
}

function buildFaqUpdate(
  target: EditTarget,
  form: FormState,
): UpdateSupportFaqInput | null {
  const input: UpdateSupportFaqInput = {};
  if (form.category !== target.original.category) {
    input.category = form.category as SupportFaqCategory;
  }
  if (form.title.trim() !== target.original.title.trim()) {
    input.question = form.title.trim();
  }
  if (form.body.trim() !== target.original.body.trim()) {
    input.answer = form.body.trim();
  }
  if (form.translationUse !== target.original.translationUse) {
    input.translationUse = form.translationUse;
  }
  if (Object.keys(input).length === 0) return null;
  return { ...input, expectedUpdatedAt: target.updatedAt };
}

function buildNoticeUpdate(
  target: EditTarget,
  form: FormState,
): UpdateSupportNoticeInput | null {
  const input: UpdateSupportNoticeInput = {};
  if (form.category !== target.original.category) {
    input.category = form.category as SupportNoticeCategory;
  }
  if (form.title.trim() !== target.original.title.trim()) {
    input.title = form.title.trim();
  }
  if (form.body.trim() !== target.original.body.trim()) {
    input.body = form.body.trim();
  }
  if (form.translationUse !== target.original.translationUse) {
    input.translationUse = form.translationUse;
  }
  if (form.priority !== target.original.priority) {
    input.priority = form.priority;
  }
  if (form.scheduledAt !== target.original.scheduledAt) {
    input.scheduledAt = toIsoDatetime(form.scheduledAt);
  }
  if (form.endsAt !== target.original.endsAt) {
    input.endsAt = toIsoDatetime(form.endsAt);
  }
  if (Object.keys(input).length === 0) return null;
  return { ...input, expectedUpdatedAt: target.updatedAt };
}

function isConflictError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { statusCode?: unknown }).statusCode === 409
  );
}

/** Mirrors the API: review approves draft/review rows and restores archived ones. */
function isReviewable(state: SupportContentReviewState): boolean {
  return state === 'draft' || state === 'review' || state === 'archived';
}

function groupKey(notice: AdminSupportNotice): string {
  return notice.translationGroupId ?? notice.id;
}

function groupMembers(
  notice: AdminSupportNotice,
  notices: AdminSupportNotice[],
): AdminSupportNotice[] {
  const key = groupKey(notice);
  return notices.filter(
    (row) =>
      row.reviewState !== 'archived' &&
      (row.id === notice.id || groupKey(row) === key),
  );
}

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
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function formatLocalDateTime(value: string | null): string | null {
  const local = toDatetimeLocal(value);
  return local ? local.replace('T', ' ') : null;
}

function localeLabel(locale: SupportContentLocale): string {
  return LOCALE_OPTIONS.find((option) => option.value === locale)?.label ?? locale;
}

function categoryLabel(item: SupportContentItem): string {
  const options: Array<{ value: string; label: string }> =
    item.type === 'faq' ? FAQ_CATEGORY_OPTIONS : NOTICE_CATEGORY_OPTIONS;
  return options.find((option) => option.value === item.category)?.label ?? item.category;
}

function priorityLabel(priority: SupportNoticePriority): string {
  return PRIORITY_OPTIONS.find((option) => option.value === priority)?.label ?? priority;
}
