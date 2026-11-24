'use client';

import { useLocale } from 'next-intl';
import { formatFloorLabel, type BookingAddonSnapshot, type FloorAwareSeatSelection } from '@grabit/shared';
import type { PendingAddonSelection } from '@/hooks/use-booking-addons';
import { cn } from '@/lib/cn';
import { formatCopy } from '@/lib/i18n/client-copy';
import { getVisibleCopy, resolveVisibleCopyLocale } from '@/lib/i18n/visible-copy';

const NO_PENDING_SELECTIONS: PendingAddonSelection[] = [];

export function BookingAddonOptions({ snapshot, seats, pending, pendingSelections = NO_PENDING_SELECTIONS, onChange }: {
  snapshot: BookingAddonSnapshot | undefined;
  seats: FloorAwareSeatSelection[];
  /** Seat changes/checkout verification block all inputs; addon writes only block their own unit. */
  pending: boolean;
  pendingSelections?: PendingAddonSelection[];
  onChange: (input: PendingAddonSelection) => void;
}) {
  const locale = resolveVisibleCopyLocale(useLocale());
  const labels = getVisibleCopy(locale).bookingAddons;
  const visibleAddons = snapshot?.addons.filter((addon) => addon.active
    || snapshot.selections.some((selection) => selection.addonId === addon.id && seats.some((seat) => seat.seatKey === selection.seatKey))) ?? [];
  if (!snapshot || !visibleAddons.length) return null;
  return <section className="rounded-xl border border-border bg-background p-4" aria-label={labels.title}>
    <h2 className="font-semibold">{labels.title}</h2>
    <p className="mt-1 text-xs leading-5 text-muted-foreground">{labels.intro}</p>
    {seats.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">{labels.selectSeat}</p> : null}
    {visibleAddons.map((addon) => {
      const copy = addon.displayCopy[locale];
      const eligible = seats.filter((s) => addon.eligibleTierNames.includes(s.tierName));
      const maxPerTicket = addon.maxPerTicket ?? 1;
      return <div key={addon.id} className="mt-3 rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-start justify-between gap-2"><strong className="text-sm">{copy.name}</strong><span className="text-sm font-semibold tabular-nums">+ KRW {addon.price.toLocaleString(locale)}</span></div>
        <p className="mt-1 text-xs text-muted-foreground">{addon.eligibleTierNames.join(' / ')} · {formatCopy(labels.availability, { available: addon.available, capacity: addon.capacity })}</p>
        <p className="mt-1 text-xs font-medium text-foreground">{formatCopy(labels.perTicket, { count: maxPerTicket })}
          {eligible.length > 0 && <> · {formatCopy(labels.forSeats, { count: eligible.length * maxPerTicket })}</>}</p>
        {!addon.active && <p className="mt-1 text-xs font-medium text-destructive">{labels.paused}</p>}
        <div aria-live="polite" className="mt-2 flex flex-col gap-1">
          {eligible.flatMap((seat) => Array.from({ length: maxPerTicket }, (_, index) => {
            const unitIndex = index + 1;
            const held = snapshot.selections.some((s) => s.addonId === addon.id && s.seatKey === seat.seatKey && (s.unitIndex ?? 1) === unitIndex);
            const change = pendingSelections.find((s) => s.addonId === addon.id && s.seatKey === seat.seatKey && (s.unitIndex ?? 1) === unitIndex);
            const checked = change?.selected ?? held;
            const stateLabel = change
              ? (change.selected ? labels.holding : labels.releasing)
              : (held ? labels.held : labels.add);
            const seatLabel = `${formatFloorLabel(seat.floorLabel, locale)} ${seat.row}-${seat.number}`;
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
          {seats.length > 0 && eligible.length === 0 ? <p className="text-xs text-muted-foreground">{labels.unavailableTier}</p> : null}
        </div>
      </div>;
    })}
    <p className="mt-3 text-xs text-muted-foreground">{labels.wait}</p>
  </section>;
}
