import { describe, expect, it } from 'vitest';
import { catalogText, formatFloorLabel, formatPerformanceAge, formatPerformanceRuntime } from './catalog-display';

describe('public performance facts', () => {
  it('formats existing and current Korean form values without dropping conditions', () => {
    expect(formatPerformanceAge('전체 관람가', 'en')).toBe('All ages');
    expect(formatPerformanceAge('8세 이상', 'th')).toBe('อายุ 8 ปีขึ้นไป');
    expect(formatPerformanceAge('만 15세 이상', 'zh-CN')).toBe('年满15周岁');
    expect(formatPerformanceRuntime('160분 (인터미션 20분 포함)', 'en')).toBe('160 minutes (includes a 20-minute intermission)');
    expect(formatPerformanceRuntime('약 90분 (자유 관람)', 'zh-CN')).toBe('约90分钟（自由参观）');
    expect(formatFloorLabel('지하 2층', 'th')).toBe('ชั้นใต้ดิน 2');
  });

  it('retains a revised source until an exact translation is available', () => {
    expect(formatPerformanceRuntime('Until 10 pm', 'en')).toBe('Until 10 pm');
    expect(formatPerformanceAge('Children must be accompanied', 'en')).toBe('Children must be accompanied');
    expect(catalogText('공연장 입장 및 사운드체크 일정 변경', 'th')).toBe('공연장 입장 및 사운드체크 일정 변경');
    expect(catalogText('큐브컨벤션센터 (CUBE CONVENTION CENTER)', 'en')).toBe('CUBE CONVENTION CENTER');
  });
});
