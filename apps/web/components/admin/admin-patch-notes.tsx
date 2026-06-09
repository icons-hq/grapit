import Link from 'next/link';
import { CheckCircle2, ExternalLink, Megaphone } from 'lucide-react';

import type { AdminPatchNote } from '@/content/admin-patch-notes';

const CATEGORY_LABEL: Record<AdminPatchNote['category'], string> = {
  feature: '기능 추가',
  patch: '패치',
  ops: '운영 개선',
};

interface AdminPatchNotesPreviewProps {
  notes: readonly AdminPatchNote[];
  limit?: number;
}

export function AdminPatchNotesPreview({
  notes,
  limit = 3,
}: AdminPatchNotesPreviewProps) {
  const recentNotes = latestAdminPatchNotesFrom(notes, limit);

  return (
    <section
      aria-labelledby="admin-patch-notes-preview-heading"
      className="rounded-lg bg-white p-6 shadow-sm"
    >
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-2">
          <Megaphone className="mt-0.5 h-5 w-5 text-gray-600" aria-hidden="true" />
          <div>
            <h2
              id="admin-patch-notes-preview-heading"
              className="text-sm font-semibold text-gray-900"
            >
              최근 패치노트
            </h2>
            <p className="mt-1 text-xs text-gray-600">
              PR에 담긴 관리자 기능 개선과 검증 내역입니다.
            </p>
          </div>
        </div>
        <Link
          href="/admin/patch-notes"
          className="text-sm font-semibold text-primary hover:underline"
        >
          패치노트 전체 보기
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {recentNotes.map((note) => (
          <PatchNoteCard key={note.id} note={note} compact />
        ))}
      </div>
    </section>
  );
}

interface AdminPatchNotesListProps {
  notes: readonly AdminPatchNote[];
}

export function AdminPatchNotesList({ notes }: AdminPatchNotesListProps) {
  return (
    <div className="space-y-4">
      {notes.map((note) => (
        <PatchNoteCard key={note.id} note={note} />
      ))}
    </div>
  );
}

interface PatchNoteCardProps {
  note: AdminPatchNote;
  compact?: boolean;
}

function PatchNoteCard({ note, compact = false }: PatchNoteCardProps) {
  const highlights = compact ? note.highlights.slice(0, 3) : note.highlights;
  const evidence = compact ? note.evidence.slice(0, 1) : note.evidence;

  return (
    <article
      aria-label={`PR #${note.prNumber} ${note.title}`}
      className="rounded-lg border bg-white p-4"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700">
          PR #{note.prNumber}
        </span>
        <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
          {CATEGORY_LABEL[note.category]}
        </span>
        <span className="text-xs text-gray-500">{formatPatchNoteDate(note.date)}</span>
      </div>

      <h3 className="text-sm font-semibold text-gray-900">{note.title}</h3>
      <p className="mt-2 text-sm leading-6 text-gray-600">{note.summary}</p>

      <ul className="mt-4 space-y-2">
        {highlights.map((highlight) => (
          <li key={highlight} className="flex gap-2 text-sm text-gray-700">
            <CheckCircle2
              className="mt-0.5 h-4 w-4 shrink-0 text-primary"
              aria-hidden="true"
            />
            <span>{highlight}</span>
          </li>
        ))}
      </ul>

      <div className="mt-4 border-t pt-3">
        <p className="mb-2 text-xs font-semibold text-gray-500">검증</p>
        <div className="flex flex-wrap gap-2">
          {evidence.map((item) => (
            <span
              key={item}
              className="rounded-full bg-gray-50 px-2 py-1 text-xs text-gray-600"
            >
              {item}
            </span>
          ))}
        </div>
      </div>

      {!compact && (
        <Link
          href={note.githubUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
        >
          GitHub PR 열기
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </Link>
      )}
    </article>
  );
}

function latestAdminPatchNotesFrom(
  notes: readonly AdminPatchNote[],
  limit: number,
): AdminPatchNote[] {
  return [...notes]
    .sort((a, b) => {
      const byDate = b.date.localeCompare(a.date);

      if (byDate !== 0) {
        return byDate;
      }

      return b.prNumber - a.prNumber;
    })
    .slice(0, limit);
}

function formatPatchNoteDate(date: string): string {
  return date.replaceAll('-', '.');
}
