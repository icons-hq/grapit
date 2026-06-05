import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocale } from 'next-intl/server';

type LegalPageModule = {
  generateMetadata: () => Promise<{
    title?: string;
    description?: string;
    alternates?: {
      canonical?: string;
    };
    robots?: {
      index?: boolean;
      follow?: boolean;
    };
  }>;
  dynamic?: string;
};

const pageModules = import.meta.glob<LegalPageModule>('../*/page.tsx');

vi.mock('next-intl/server', () => ({
  getLocale: vi.fn(),
}));

const getLocaleMock = vi.mocked(getLocale);

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('GRABIT_ENV', 'production');
  getLocaleMock.mockResolvedValue('ko');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadLegalPage(
  globKey: '../terms/page.tsx' | '../privacy/page.tsx' | '../marketing/page.tsx',
  contractImport: string,
) {
  const loader = pageModules[globKey];
  if (!loader) {
    throw new Error(`${contractImport} 모듈이 아직 생성되지 않았습니다.`);
  }
  return loader();
}

describe('Legal pages metadata (D-10, D-13)', () => {
  describe('/legal/terms', () => {
    it('metadata 객체가 D-13 계약을 만족한다', async () => {
      const mod = await loadLegalPage(
        '../terms/page.tsx',
        "import('@/app/legal/terms/page')",
      );
      const metadata = await mod.generateMetadata();

      expect(metadata.title).toBe('이용약관 — Grabit');
      expect(metadata.description).toBe(
        'Grabit 서비스 이용 조건과 회원·회사의 권리·의무를 안내합니다.',
      );
      expect(metadata.alternates?.canonical).toBe(
        'https://heygrabit.com/legal/terms',
      );
      expect(metadata.robots).toMatchObject({ index: true, follow: true });
    });

    it('dynamic export 가 force-static 으로 명시된다 (D-10)', async () => {
      const mod = await loadLegalPage(
        '../terms/page.tsx',
        "import('@/app/legal/terms/page')",
      );
      expect(mod.dynamic).toBe('force-static');
    });
  });

  describe('/legal/privacy', () => {
    it('metadata 객체가 D-13 계약을 만족한다', async () => {
      const mod = await loadLegalPage(
        '../privacy/page.tsx',
        "import('@/app/legal/privacy/page')",
      );
      const metadata = await mod.generateMetadata();

      expect(metadata.title).toBe('개인정보처리방침 — Grabit');
      expect(metadata.description).toBe(
        'Grabit이 수집·이용하는 개인정보 항목과 처리 목적, 보유 기간 및 이용자의 권리를 안내합니다.',
      );
      expect(metadata.alternates?.canonical).toBe(
        'https://heygrabit.com/legal/privacy',
      );
      expect(metadata.robots).toMatchObject({ index: true, follow: true });
    });

    it('dynamic export 가 force-static 으로 명시된다', async () => {
      const mod = await loadLegalPage(
        '../privacy/page.tsx',
        "import('@/app/legal/privacy/page')",
      );
      expect(mod.dynamic).toBe('force-static');
    });
  });

  describe('/legal/marketing', () => {
    it('metadata 객체가 D-13 계약을 만족한다', async () => {
      const mod = await loadLegalPage(
        '../marketing/page.tsx',
        "import('@/app/legal/marketing/page')",
      );
      const metadata = await mod.generateMetadata();

      expect(metadata.title).toBe('마케팅 정보 수신 동의 — Grabit');
      expect(metadata.description).toBe(
        'Grabit이 발송하는 마케팅 정보의 수신 항목, 전송 수단, 동의 거부 권리를 안내합니다.',
      );
      expect(metadata.alternates?.canonical).toBe(
        'https://heygrabit.com/legal/marketing',
      );
      expect(metadata.robots).toMatchObject({ index: true, follow: true });
    });

    it('dynamic export 가 force-static 으로 명시된다', async () => {
      const mod = await loadLegalPage(
        '../marketing/page.tsx',
        "import('@/app/legal/marketing/page')",
      );
      expect(mod.dynamic).toBe('force-static');
    });
  });
});

describe('getLegalRobots', () => {
  it('GRABIT_ENV 가 없고 NODE_ENV=production 이면 index/follow 를 허용한다', async () => {
    vi.stubEnv('GRABIT_ENV', undefined);
    vi.stubEnv('NODE_ENV', 'production');
    const { getLegalRobots } = await import('../robots');

    expect(getLegalRobots()).toEqual({ index: true, follow: true });
  });

  it('preview 환경은 noindex/nofollow 를 유지한다', async () => {
    vi.stubEnv('GRABIT_ENV', 'preview');
    vi.stubEnv('NODE_ENV', 'production');
    const { getLegalRobots } = await import('../robots');

    expect(getLegalRobots()).toEqual({ index: false, follow: false });
  });
});
