import type { VisibleCopy } from '@/lib/i18n/visible-copy';

export function TicketEntryGuide({ copy, screenReaderOnly = false }: { copy: VisibleCopy['entryGuide']; screenReaderOnly?: boolean }) {
  const sections = [
    { title: copy.entry, items: [copy.mobile, copy.trading, copy.personal, copy.transfer] },
    { title: copy.restricted, items: [copy.danger, copy.food, copy.obstruction] },
    { title: copy.recording, items: [copy.photos, copy.copyright] },
    { title: copy.safety, items: [copy.conduct, copy.emergency, copy.view, copy.valuables] },
  ];
  return (
    <section className={screenReaderOnly ? 'sr-only' : 'space-y-5 rounded-xl border bg-white p-5 text-sm leading-7 sm:p-8'}>
      <h3 className="text-lg font-bold">{copy.title}</h3>
      <p>{copy.intro}</p>
      {sections.map(({ title, items }) => (
        <div key={title}>
          <h4 className="font-semibold">{title}</h4>
          <ul className="list-disc space-y-1 ps-5">
            {items.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      ))}
    </section>
  );
}
