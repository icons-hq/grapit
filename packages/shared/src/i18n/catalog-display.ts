import { DEFAULT_LOCALE, isSupportedLocale } from '../constants/locales';
import type { SupportedLocale } from '../types/i18n.types';

type ForeignLocale = Exclude<SupportedLocale, 'ko'>;
type Translation = Record<ForeignLocale, string>;

// Labels belong to the published source text. A subsequent editorial change
// must never inherit an old direction, address, or restriction.
const publishedText: Readonly<Record<string, Translation>> = {
  '팬미팅': { en: 'Fan meeting', th: 'แฟนมีตติ้ง', 'zh-CN': '粉丝见面会' },
  '큐브컨벤션센터 (CUBE CONVENTION CENTER)': { en: 'CUBE CONVENTION CENTER', th: 'ศูนย์ประชุม CUBE CONVENTION CENTER', 'zh-CN': 'CUBE 会议中心' },
  '서울특별시 마포구 상암산로 34 디지털큐브 3층': { en: '3F, Digital Cube, 34 Sangamsan-ro, Mapo-gu, Seoul', th: 'ชั้น 3 อาคาร Digital Cube เลขที่ 34 ถนน Sangamsan-ro เขตมาโพ กรุงโซล', 'zh-CN': '首尔特别市麻浦区 Sangamsan-ro 34号 Digital Cube 大厦3层' },
  '공연장 입장 및 사운드체크 일정은 추후 안내됩니다.': { en: 'Entry and soundcheck times will be announced later.', th: 'จะแจ้งเวลาเข้างานและซาวด์เช็กภายหลัง', 'zh-CN': '入场及彩排时间将另行公布。' },
  '지하철 6호선·공항철도·경의중앙선 디지털미디어시티역에서 도보 약 10~12분. 공연장 공식 위치 안내: https://cube-convention.com/about/about.php': { en: 'About a 10–12 minute walk from Digital Media City Station (Line 6, Airport Railroad or Gyeongui–Jungang Line). Venue directions: https://cube-convention.com/about/about.php', th: 'เดินประมาณ 10–12 นาทีจากสถานี Digital Media City (รถไฟใต้ดินสาย 6 รถไฟสนามบิน หรือสาย Gyeongui–Jungang) เส้นทางจากสถานที่จัดงาน https://cube-convention.com/about/about.php', 'zh-CN': '从数码媒体城站（地铁6号线、机场铁路或京义中央线）步行约10至12分钟。场馆官方路线：https://cube-convention.com/about/about.php' },
  '광운대학교 동해문화예술관': { en: 'Donghae Culture and Arts Center, Kwangwoon University', th: 'ศูนย์วัฒนธรรมและศิลปะทงแฮ มหาวิทยาลัยควังอุน', 'zh-CN': '光云大学东海文化艺术馆' },
  '서울특별시 노원구 월계동 447-1 광운대학교 동해문화예술관': { en: 'Donghae Culture and Arts Center, Kwangwoon University, 447-1 Wolgye-dong, Nowon-gu, Seoul', th: 'ศูนย์วัฒนธรรมและศิลปะทงแฮ มหาวิทยาลัยควังอุน 447-1 Wolgye-dong เขตโนวอน กรุงโซล', 'zh-CN': '首尔特别市芦原区月溪洞447-1，光云大学东海文化艺术馆' },
};

export function catalogText(source: string, locale: string): string {
  if (!isSupportedLocale(locale) || locale === DEFAULT_LOCALE) return source;
  return Object.hasOwn(publishedText, source) ? publishedText[source]![locale] : source;
}

export function formatFloorLabel(source: string, locale: SupportedLocale): string {
  if (locale === 'ko') return source;
  const floor = /^(지하\s*)?(\d+)\s*층$/.exec(source.trim());
  if (!floor) return source;
  const n = floor[2];
  if (floor[1]) return { en: `B${n}`, th: `ชั้นใต้ดิน ${n}`, 'zh-CN': `地下${n}层` }[locale];
  return { en: `${n}F`, th: `ชั้น ${n}`, 'zh-CN': `${n}层` }[locale];
}

export function formatPerformanceAge(source: string, locale: SupportedLocale): string {
  if (locale === 'ko') return source;
  if (/^(전체|전\s*연령)\s*(관람가|관람 가능)?$/.test(source.trim())) {
    return { en: 'All ages', th: 'ทุกช่วงอายุ', 'zh-CN': '不限年龄' }[locale];
  }
  const match = /^(?:만\s*)?(\d+)\s*세\s*이상(?:\s*관람(?:가|\s*가능)?)?$/.exec(source.trim());
  if (!match) return source;
  const age = match[1];
  return { en: `Ages ${age} and up`, th: `อายุ ${age} ปีขึ้นไป`, 'zh-CN': `年满${age}周岁` }[locale];
}

export function formatPerformanceRuntime(source: string, locale: SupportedLocale): string {
  if (locale === 'ko') return source;
  const match = /^(약\s*)?(\d+)\s*분(?:\s*\(\s*(?:인터미션\s*(\d+)\s*분\s*포함|(자유\s*관람))\s*\))?$/.exec(source.trim());
  if (!match) return source;
  const [, approximate, minutes, interval, flexible] = match;
  const value = new Intl.NumberFormat(locale, { style: 'unit', unit: 'minute', unitDisplay: 'long' }).format(Number(minutes));
  const duration = approximate ? { en: `Approx. ${value}`, th: `ประมาณ ${value}`, 'zh-CN': `约${value}` }[locale] : value;
  if (interval) return { en: `${duration} (includes a ${interval}-minute intermission)`, th: `${duration} (รวมเวลาพัก ${interval} นาที)`, 'zh-CN': `${duration}（含中场休息${interval}分钟）` }[locale];
  if (flexible) return { en: `${duration} (self-paced visit)`, th: `${duration} (เข้าชมตามอัธยาศัย)`, 'zh-CN': `${duration}（自由参观）` }[locale];
  return duration;
}
