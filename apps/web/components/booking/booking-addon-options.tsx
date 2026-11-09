'use client';

import { useLocale } from 'next-intl';
import type { BookingAddonSnapshot, FloorAwareSeatSelection } from '@grabit/shared';
import type { PendingAddonSelection } from '@/hooks/use-booking-addons';
import { cn } from '@/lib';

const NO_PENDING_SELECTIONS: PendingAddonSelection[] = [];

export function BookingAddonOptions({ snapshot, seats, pending, pendingSelections = NO_PENDING_SELECTIONS, onChange }: {
  snapshot: BookingAddonSnapshot | undefined;
  seats: FloorAwareSeatSelection[];
  /** Seat changes/checkout verification block all inputs; addon writes only block their own unit. */
  pending: boolean;
  pendingSelections?: PendingAddonSelection[];
  onChange: (input: PendingAddonSelection) => void;
}) {
  const locale = useLocale();
  const ko = locale === 'ko';
  const visibleAddons = snapshot?.addons.filter((addon) => addon.active
    || snapshot.selections.some((selection) => selection.addonId === addon.id && seats.some((seat) => seat.seatKey === selection.seatKey))) ?? [];
  if (!snapshot || !visibleAddons.length) return null;
  return <section className="rounded-xl border border-border bg-background p-4" aria-label={ko ? '유료 애드온 선택' : 'Paid add-ons'}>
    <h2 className="font-semibold">{ko ? '유료 애드온 선택' : 'Paid add-ons'}</h2>
    <p className="mt-1 text-xs leading-5 text-muted-foreground">{ko
      ? '좌석을 선택한 뒤 원하는 옵션을 추가하세요. 선점이 완료된 수량만 결제금액에 합산됩니다.'
      : 'Choose a seat, then add optional benefits. Only confirmed holds are added to your payment.'}</p>
    {seats.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">{ko ? '먼저 좌석을 선택해주세요.' : 'Select a seat first.'}</p> : null}
    {visibleAddons.map((addon) => {
      const copy = addon.displayCopy[locale as keyof typeof addon.displayCopy] ?? addon.displayCopy.en;
      const eligible = seats.filter((s) => addon.eligibleTierNames.includes(s.tierName));
      const maxPerTicket = addon.maxPerTicket ?? 1;
      return <div key={addon.id} className="mt-3 rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-start justify-between gap-2"><strong className="text-sm">{copy.name}</strong><span className="text-sm font-semibold tabular-nums">+ KRW {addon.price.toLocaleString('en-US')}</span></div>
        <p className="mt-1 text-xs text-muted-foreground">{addon.eligibleTierNames.join(' / ')} · {ko ? `잔여 ${addon.available} / ${addon.capacity}개` : `${addon.available} of ${addon.capacity} available`}</p>
        <p className="mt-1 text-xs font-medium text-foreground">{ko
          ? `티켓 1매당 최대 ${maxPerTicket}개${eligible.length ? ` · 선택 좌석 기준 최대 ${eligible.length * maxPerTicket}개` : ''}`
          : `Up to ${maxPerTicket} per ticket${eligible.length ? ` · Up to ${eligible.length * maxPerTicket} for your seats` : ''}`}</p>
        {!addon.active && <p className="mt-1 text-xs font-medium text-destructive">{ko ? '판매가 중단된 옵션입니다. 선택을 해제한 뒤 계속해주세요.' : 'Sales paused. Remove this option to continue.'}</p>}
        <div aria-live="polite" className="mt-2 flex flex-col gap-1">
          {eligible.flatMap((seat) => Array.from({ length: maxPerTicket }, (_, index) => {
            const unitIndex = index + 1;
            const held = snapshot.selections.some((s) => s.addonId === addon.id && s.seatKey === seat.seatKey && (s.unitIndex ?? 1) === unitIndex);
            const change = pendingSelections.find((s) => s.addonId === addon.id && s.seatKey === seat.seatKey && (s.unitIndex ?? 1) === unitIndex);
            const checked = change?.selected ?? held;
            const stateLabel = change
              ? (change.selected ? (ko ? '선점 중…' : 'Reserving…') : (ko ? '해제 중…' : 'Releasing…'))
              : (held ? (ko ? '선점 완료' : 'Held for you') : (ko ? '추가 선택' : 'Add option'));
            const seatLabel = `${seat.floorLabel} ${seat.row}-${seat.number}`;
            return <label key={`${seat.seatKey}:${unitIndex}`} className={cn('flex min-h-11 items-center gap-3 rounded-md px-2 text-sm', change && 'bg-primary/5')}>
              <input type="checkbox" className="size-4 shrink-0 accent-primary" checked={checked}
                aria-label={`${copy.name} · ${seatLabel}${maxPerTicket > 1 ? ` · ${unitIndex}/${maxPerTicket}` : ''}`}
                aria-busy={Boolean(change)}
                disabled={pending || Boolean(change) || (!held && (!addon.active || addon.available === 0))}
                onChange={(e) => onChange({ addonId: addon.id, seatKey: seat.seatKey, unitIndex, selected: e.target.checked })} />
              <span className="min-w-0 flex-1">{seatLabel}{maxPerTicket > 1 ? ` · ${unitIndex}/${maxPerTicket}` : ''}</span>
              <span className={cn('shrink-0 text-xs', change ? 'font-medium text-primary' : 'text-muted-foreground')}>{stateLabel}</span>
            </label>;
          }))}
          {seats.length > 0 && eligible.length === 0 ? <p className="text-xs text-muted-foreground">{ko ? '선택한 좌석 등급에서는 구매할 수 없습니다.' : 'Not available for your selected ticket tier.'}</p> : null}
        </div>
      </div>;
    })}
    <p className="mt-3 text-xs text-muted-foreground">{ko ? '선점 중에는 다음 단계로 이동할 수 없습니다. 좌석 취소 시 추가 옵션도 함께 취소됩니다.' : 'Wait for pending selections before continuing. Options are cancelled together with their seat.'}</p>
  </section>;
}
