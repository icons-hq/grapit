'use client';

import { useLocale } from 'next-intl';
import type { BookingAddonSnapshot, FloorAwareSeatSelection } from '@grabit/shared';

export function BookingAddonOptions({ snapshot, seats, pending, onChange }: {
  snapshot: BookingAddonSnapshot | undefined;
  seats: FloorAwareSeatSelection[];
  pending: boolean;
  onChange: (input: { addonId: string; seatKey: string; selected: boolean }) => void;
}) {
  const locale = useLocale();
  const ko = locale === 'ko';
  const visibleAddons = snapshot?.addons.filter((addon) => addon.active
    || snapshot.selections.some((selection) => selection.addonId === addon.id && seats.some((seat) => seat.seatKey === selection.seatKey))) ?? [];
  if (!snapshot || !visibleAddons.length) return null;
  return <section className="rounded-xl border border-border bg-white p-4" aria-label={ko ? '유료 애드온 선택' : 'Paid add-ons'}>
    <h2 className="font-semibold">{ko ? '유료 애드온 선택' : 'Paid add-ons'}</h2>
    <p className="mt-1 text-xs leading-5 text-muted-foreground">{ko
      ? '좌석을 선택한 뒤 원하는 옵션을 추가하세요. 선택한 수량은 좌석과 함께 선점되며, 티켓 결제금액에 합산됩니다.'
      : 'Choose a seat, then add optional benefits. Selected units are held with your seat and paid together with your ticket.'}</p>
    {seats.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">{ko ? '먼저 좌석을 선택해주세요.' : 'Select a seat first.'}</p> : null}
    {visibleAddons.map((addon) => {
      const copy = addon.displayCopy[locale as keyof typeof addon.displayCopy] ?? addon.displayCopy.en;
      const eligible = seats.filter((s) => addon.eligibleTierNames.includes(s.tierName));
      return <div key={addon.id} className="mt-3 rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-start justify-between gap-2"><strong className="text-sm">{copy.name}</strong><span className="text-sm font-semibold tabular-nums">+ KRW {addon.price.toLocaleString('en-US')}</span></div>
        <p className="mt-1 text-xs text-muted-foreground">{addon.eligibleTierNames.join(' / ')} · {ko ? `잔여 ${addon.available} / ${addon.capacity}개` : `${addon.available} of ${addon.capacity} available`}</p>
        {!addon.active && <p className="mt-1 text-xs font-medium text-amber-800">{ko ? '판매가 중단된 옵션입니다. 선택을 해제한 뒤 계속해주세요.' : 'Sales paused. Remove this option to continue.'}</p>}
        <div aria-live="polite" className="mt-2 space-y-1">
          {eligible.map((seat) => {
            const checked = snapshot.selections.some((s) => s.addonId === addon.id && s.seatKey === seat.seatKey);
            return <label key={seat.seatKey} className="flex min-h-10 items-center gap-3 text-sm">
              <input type="checkbox" className="size-4 accent-primary" checked={checked}
                disabled={pending || (!checked && (!addon.active || addon.available === 0))}
                onChange={(e) => onChange({ addonId: addon.id, seatKey: seat.seatKey, selected: e.target.checked })} />
              <span>{seat.floorLabel} {seat.row}-{seat.number} · {checked ? (ko ? '선점 완료' : 'Held for you') : (ko ? '추가 선택' : 'Add option')}</span>
            </label>;
          })}
          {seats.length > 0 && eligible.length === 0 ? <p className="text-xs text-muted-foreground">{ko ? '선택한 좌석 등급에서는 구매할 수 없습니다.' : 'Not available for your selected ticket tier.'}</p> : null}
        </div>
      </div>;
    })}
    <p className="mt-3 text-xs text-muted-foreground">{ko ? '티켓 1장당 각 옵션 1개. 좌석 취소 시 함께 취소됩니다.' : 'One of each option per ticket. Options are cancelled together with their seat.'}</p>
  </section>;
}
