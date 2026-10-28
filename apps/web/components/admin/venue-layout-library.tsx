'use client';

import { useRef, useState } from 'react';
import type { PerformanceSeatMapInput } from '@grabit/shared';
import { toast } from 'sonner';
import { Library, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { loadVenueLayout, useSaveVenueLayout, useVenueLayouts } from '@/hooks/use-venue-layouts';

export function VenueLayoutLibrary({ venueName, seatMaps, onApply, disabled = false }: {
  venueName: string;
  seatMaps: PerformanceSeatMapInput[];
  onApply: (floors: PerformanceSeatMapInput[]) => void;
  disabled?: boolean;
}) {
  const layouts = useVenueLayouts(venueName);
  const save = useSaveVenueLayout();
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const sourceId = seatMaps[0]?.venueLayoutId;
  const linked = layouts.data?.find((layout) => layout.id === sourceId);
  const busy = loading || save.isPending;
  const currentVenue = useRef(venueName);
  currentVenue.current = venueName;

  async function apply() {
    if (!selected) return;
    setLoading(true);
    try {
      const layout = await loadVenueLayout(selected);
      // A stale response from another venue must not overwrite the current form.
      if (layout.venueName !== currentVenue.current.trim()) throw new Error('공연장을 다시 확인해주세요.');
      onApply(layout.seatMaps);
      setName(layout.layoutName);
      toast.success(`${layout.layoutName} v${layout.version}을 불러왔습니다. 공연 가격을 확인해주세요.`);
    } catch (error) { toast.error(error instanceof Error ? error.message : '좌석 템플릿을 불러오지 못했습니다.'); }
    finally { setLoading(false); }
  }

  async function saveVersion() {
    try {
      const layout = await save.mutateAsync({ venueName, layoutName: name, seatMaps });
      if (layout.venueName !== currentVenue.current.trim()) return;
      onApply(layout.seatMaps);
      setSelected(layout.id);
      toast.success(`${layout.layoutName} v${layout.version}을 저장했습니다.`);
    } catch (error) { toast.error(error instanceof Error ? error.message : '좌석 템플릿을 저장하지 못했습니다.'); }
  }

  return <section aria-label="공연장 좌석 템플릿" className="space-y-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
    <div className="flex items-start gap-3"><Library className="mt-0.5 size-5 shrink-0 text-primary" />
      <div><h3 className="font-semibold">공연장 좌석 템플릿</h3>
        <p className="mt-1 text-sm text-gray-600">{venueName || '기본 정보에서 공연장을 먼저 입력하세요.'} · 층·구역·좌석도를 불러오고 가격은 공연마다 정합니다.</p>
        <p className="mt-1 text-xs text-gray-500">같은 이름으로 저장하면 새 버전이 생깁니다. 이전 공연의 좌석도는 바뀌지 않습니다.</p>
      </div>
    </div>
    {layouts.isError ? <p role="alert" className="text-sm text-red-600">템플릿 목록을 불러오지 못했습니다.</p> : null}
    <div className="flex flex-col gap-2 sm:flex-row">
      <select aria-label="저장된 공연장 좌석 템플릿" value={selected} onChange={(event) => setSelected(event.target.value)}
        disabled={disabled || busy || !venueName} className="min-h-11 min-w-0 flex-1 rounded-lg border bg-white px-3 text-sm">
        <option value="">{layouts.isLoading ? '불러오는 중…' : layouts.data?.length ? '사용할 버전 선택' : '저장된 템플릿 없음'}</option>
        {layouts.data?.map((layout) => <option key={layout.id} value={layout.id}>
          {layout.layoutName} · v{layout.version} · {layout.floorCount}개 층 · {layout.totalSeats.toLocaleString('ko-KR')}석
        </option>)}
      </select>
      <Button type="button" variant="outline" disabled={disabled || busy || !selected} onClick={apply}>
        {loading ? <Loader2 className="size-4 animate-spin" /> : null}템플릿 불러오기</Button>
    </div>
    {linked ? <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white p-3 text-sm">
      <span>사용 중: <strong>{linked.layoutName} v{linked.version}</strong></span>
      <Button type="button" size="sm" variant="ghost" disabled={disabled || busy}
        onClick={() => onApply(seatMaps.map((floor) => ({ ...floor, venueLayoutId: null })))}>이 공연에서만 편집</Button>
    </div> : null}
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <div className="flex-1 space-y-1"><Label htmlFor="venue-layout-name">템플릿 이름</Label>
        <Input id="venue-layout-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={100}
          placeholder="예: 대극장 · 정면 무대" disabled={disabled || busy} /></div>
      <Button type="button" variant="secondary" disabled={disabled || busy || !venueName.trim() || !name.trim() || !seatMaps.length}
        onClick={saveVersion}>{save.isPending ? <Loader2 className="size-4 animate-spin" /> : null}현재 좌석도를 새 버전으로 저장</Button>
    </div>
  </section>;
}
