'use client';

import { FormEvent, useState } from 'react';
import { Languages } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { CreateTranslationSourceInput, TranslationSource } from '@/hooks/use-admin';
import type { PerformanceWithDetails } from '@grabit/shared';

interface TranslationSourceFormProps {
  performance?: PerformanceWithDetails;
  onCreateSource: (
    input: CreateTranslationSourceInput,
  ) => Promise<TranslationSource | { id: string }>;
  onGenerateDrafts: (sourceId: string) => Promise<unknown>;
  isCreating: boolean;
  isGenerating: boolean;
}

export function TranslationSourceForm({
  onCreateSource,
  onGenerateDrafts,
  isCreating,
  isGenerating,
  performance,
}: TranslationSourceFormProps) {
  const [entityType, setEntityType] = useState('performance');
  const [entityId, setEntityId] = useState('');
  const [field, setField] = useState('description');
  const [sourceTitle, setSourceTitle] = useState('');
  const [sourceBody, setSourceBody] = useState('');
  const [sourceId, setSourceId] = useState<string | null>(null);
  const performanceText = performance && ['title', 'description', 'salesInfo'].includes(field)
    ? performance[field as 'title' | 'description' | 'salesInfo'] ?? '' : '';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const sourceText = performance ? performanceText : `${sourceTitle.trim()}\n\n${sourceBody.trim()}`.trim();
    try {
      const source = await onCreateSource({
        entityType: performance ? 'performance' : entityType,
        entityId: performance?.id ?? entityId.trim(),
        field,
        sourceText,
      });
      setSourceId(source.id);
    } catch {
      setSourceId(null);
    }
  }

  async function handleGenerateDrafts() {
    if (!sourceId) return;
    try {
      await onGenerateDrafts(sourceId);
    } catch {
      // Parent mutation handlers own user-facing error feedback.
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-lg bg-white p-4 shadow-sm"
    >
      <div className="flex items-center gap-2">
        <Languages className="h-5 w-5 text-primary" />
        <h2 className="text-heading font-semibold leading-[1.2]">
          한국어 원문 등록
        </h2>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {performance ? <p className="text-sm leading-6 text-gray-700 md:col-span-2">{performance.title}<br />저장된 한국어 원문을 사용합니다. 원문 수정은 공연 준비 화면에서 진행하세요.</p> : <><div className="space-y-2">
          <Label htmlFor="translation-entity-type">콘텐츠 유형</Label>
          <select
            id="translation-entity-type"
            value={entityType}
            onChange={(event) => setEntityType(event.target.value)}
            className="flex h-11 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="performance">performance</option>
            <option value="banner">banner</option>
            <option value="notice">notice</option>
            <option value="legal">legal</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="translation-entity-id">콘텐츠 ID</Label>
          <Input
            id="translation-entity-id"
            value={entityId}
            onChange={(event) => setEntityId(event.target.value)}
            required
          />
        </div>
        </>}
        <div className="space-y-2">
          <Label htmlFor="translation-field">필드</Label>
          <select
            id="translation-field"
            value={field}
            onChange={(event) => { setField(event.target.value); setSourceId(null); }}
            className="flex h-11 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="title">공연명</option>
            <option value="description">상세 안내</option>
            <option value="salesInfo">판매 안내</option>
          </select>
        </div>
      </div>

      {!performance && <div className="space-y-2">
        <Label htmlFor="translation-source-title">원문 제목</Label>
        <Input
          id="translation-source-title"
          value={sourceTitle}
          onChange={(event) => setSourceTitle(event.target.value)}
          required
        />
      </div>}

      <div className="space-y-2">
        <Label htmlFor="translation-source-body">한국어 원문</Label>
        <Textarea
          id="translation-source-body"
          value={performance ? performanceText : sourceBody}
          readOnly={Boolean(performance)}
          onChange={(event) => setSourceBody(event.target.value)}
          rows={5}
          required
        />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" disabled={isCreating || Boolean(performance && !performanceText.trim())}>
          원문 저장
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!sourceId || isGenerating}
          onClick={() => void handleGenerateDrafts()}
        >
          en/th/zh-CN 초안 생성
        </Button>
      </div>
    </form>
  );
}
