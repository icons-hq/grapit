import { getVisibleCopy } from '@/lib/i18n/visible-copy';
const SUPPORT_COUNTRIES = 'AR AU AT BE BR BG CA CL CO CZ DK SV FI FR DE IN ID IE IL IT JP LU MY MX NL NZ PH PL PT RO SG SK KR ES LK SE CH TW GB US'.split(' ');

export function AnalyticsProcessingDetails({ locale }: { locale: string }) {
  const labels = getVisibleCopy(locale).analyticsProcessing;
  const names = new Intl.DisplayNames([locale], { type: 'region' });
  return <section className="space-y-5 text-sm leading-7" data-analytics-consent>
    <h2 className="text-xl font-semibold">{labels.title}</h2>
    <p>{labels.version}</p>
    <h3 className="font-semibold">{labels.purposesTitle}</h3>
    <p>{labels.purposes}</p>
    <ul className="list-disc space-y-1 pl-5"><li>{labels.retentionActivity}</li>
      <li>{labels.retentionTotals}</li>
      <li>{labels.retentionBrowser}</li></ul>
    <h3 className="font-semibold">{labels.transferTitle}</h3>
    <div className="overflow-x-auto rounded border"><table className="w-full min-w-[520px] border-collapse text-left"><tbody className="divide-y">
      <tr><th className="w-36 p-3 align-top">{labels.recipients}</th><td className="p-3">Google Cloud Korea LLC · Google Asia Pacific Pte. Ltd. (70 Pasir Panjang Road, #03-71, Mapletree Business City II, Singapore 117371) · <a className="underline" href="https://cloud.google.com/terms/data-processing-addendum">Google Cloud Data Protection Team</a></td></tr>
      <tr><th className="p-3 align-top">{labels.countries}</th><td className="p-3">{labels.countriesBody}<p className="mt-2">{SUPPORT_COUNTRIES.map((code) => `${names.of(code)} (${code})`).join(', ')}</p></td></tr>
      <tr><th className="p-3 align-top">{labels.dataTitle}</th><td className="p-3">{labels.dataBody}</td></tr>
      <tr><th className="p-3 align-top">{labels.timing}</th><td className="p-3">{labels.timingBody}</td></tr>
      <tr><th className="p-3 align-top">{labels.retention}</th><td className="p-3">{labels.retentionBody}</td></tr>
      <tr><th className="p-3 align-top">{labels.withdrawal}</th><td className="p-3">{labels.withdrawalBody}</td></tr>
    </tbody></table></div>
    <p>{labels.accessLogs}</p>
    <p>{labels.contact}<a className="underline" href={getLocalizedPathname('/legal/privacy', locale as SupportedLocale)}>{labels.policy}</a>.</p>
    <p className="text-xs text-muted-foreground">{labels.references}<a className="underline" href="https://cloud.google.com/terms/google-entity">Google entities</a> · <a className="underline" href="https://cloud.google.com/terms/subprocessors">Google subprocessors</a> · <a className="underline" href="https://cloud.google.com/terms/data-processing-addendum">Google data processing/deletion terms</a>.</p>
  </section>;
}
import { getLocalizedPathname } from '@/lib/i18n/locale-path';
import type { SupportedLocale } from '@grabit/shared';
