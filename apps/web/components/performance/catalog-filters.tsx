'use client';
import { useId, useState } from 'react';
import { useLocale } from 'next-intl';
import { SlidersHorizontal } from 'lucide-react';
import { GENRES, PERFORMANCE_REGIONS, type PerformanceQuery } from '@grabit/shared';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { getVisibleCopy } from '@/lib/i18n/visible-copy';
import { getTicketCopy } from '@/lib/i18n/ticket-copy';

export type FilterUpdates = Record<string, string>;
export function CatalogFilters({ value, onChange, onReset, fixedGenre, hideStatus = false }: {
  value: Partial<PerformanceQuery>; onChange: (updates: FilterUpdates) => void; onReset: () => void; fixedGenre?: boolean; hideStatus?: boolean;
}) {
  const locale = useLocale();
  const copy = getTicketCopy(locale);
  const genres = getVisibleCopy(locale).genres;
  const id = useId();
  return <aside className="ticket-filter-panel">
    <div className="ticket-filter-heading"><h2>{copy.filters}</h2><button type="button" onClick={onReset}>{copy.reset}</button></div>
    {!hideStatus && <fieldset className="ticket-filter-field"><legend>{copy.status}</legend><div className="ticket-filter-options">
      {(['all', 'selling', 'upcoming', 'ended'] as const).map((status) => <button type="button" key={status} aria-pressed={(value.status ?? 'all') === status} onClick={() => onChange({ status, ended: status === 'all' ? 'true' : '' })}>
        {status === 'upcoming' ? copy.upcoming : copy[status]}
      </button>)}
    </div></fieldset>}
    {!fixedGenre && <fieldset className="ticket-filter-field"><legend>{copy.genre}</legend><div className="ticket-filter-options">
      <button type="button" aria-pressed={!value.genre} onClick={() => onChange({ genre: '' })}>{copy.all}</button>
      {GENRES.map((genre) => <button type="button" key={genre} aria-pressed={value.genre === genre} onClick={() => onChange({ genre })}>{genres[genre]}</button>)}
    </div></fieldset>}
    <div className="ticket-filter-field"><label htmlFor={id + '-region'}>{copy.region}</label><select id={id + '-region'} value={value.region ?? ''} onChange={(event) => onChange({ region: event.target.value })}>
      <option value="">{copy.all}</option>{PERFORMANCE_REGIONS.map((region) => <option key={region} value={region}>{region}</option>)}
    </select></div>
    <fieldset className="ticket-filter-field"><legend>{copy.date}</legend><div className="ticket-filter-dates">
      <label>{copy.dateFrom}<input type="date" value={value.dateFrom ?? ''} max={value.dateTo} onChange={(event) => onChange({ dateFrom: event.target.value })} /></label>
      <label>{copy.dateTo}<input type="date" value={value.dateTo ?? ''} min={value.dateFrom} onChange={(event) => onChange({ dateTo: event.target.value })} /></label>
    </div></fieldset>
  </aside>;
}

export function MobileCatalogFilters(props: Parameters<typeof CatalogFilters>[0]) {
  const copy = getTicketCopy(useLocale());
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(props.value);
  function apply() {
    const updates: FilterUpdates = {};
    for (const key of ['genre', 'status', 'region', 'dateFrom', 'dateTo'] as const) updates[key] = draft[key] ?? '';
    updates.ended = draft.ended ? 'true' : '';
    props.onChange(updates); setOpen(false);
  }
  return <>
    <button type="button" className="ticket-mobile-filter-trigger" onClick={() => { setDraft(props.value); setOpen(true); }}><SlidersHorizontal size={14} />{copy.filters}</button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="ticket-dialog ticket-filter-dialog" aria-describedby={undefined}>
      <DialogTitle className="sr-only">{copy.filters}</DialogTitle>
      <CatalogFilters {...props} value={draft} onChange={(updates) => setDraft((old) => ({ ...old, ...updates, ended: updates.ended === undefined ? old.ended : updates.ended === 'true' } as Partial<PerformanceQuery>))}
        onReset={() => setDraft({ genre: props.fixedGenre ? props.value.genre : undefined, status: props.hideStatus ? props.value.status : 'all' })} />
      <Button onClick={apply}>{copy.apply}</Button>
    </DialogContent></Dialog>
  </>;
}
