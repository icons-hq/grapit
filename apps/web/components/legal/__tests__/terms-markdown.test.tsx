import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TermsMarkdown } from '../terms-markdown';

describe('TermsMarkdown', () => {
  it('renders the published Korean definitions as emphasis without exposing Markdown markers', () => {
    const markdown = readFileSync(join(process.cwd(), 'content/legal/terms-of-service.md'), 'utf8');
    const { container } = render(<TermsMarkdown showH1>{markdown}</TermsMarkdown>);
    const terms = [...container.querySelectorAll('li strong')].map((element) => element.textContent);
    expect(terms).toEqual(expect.arrayContaining(['서비스', '회원', '아이디(ID)', '비밀번호']));
    expect(container.textContent).not.toContain('**');
    expect(container.textContent).toContain('"서비스"란 회사가');
  });
  describe('showH1 prop (D-09)', () => {
    it('default (showH1 미지정) 시 H1 을 렌더하지 않는다 - dialog 호환', () => {
      const { container } = render(
        <TermsMarkdown>{'# 이용약관\n\n본문'}</TermsMarkdown>,
      );
      expect(container.querySelector('h1')).toBeNull();
    });

    it('showH1=false 명시 시 H1 을 렌더하지 않는다', () => {
      const { container } = render(
        <TermsMarkdown showH1={false}>{'# 이용약관\n\n본문'}</TermsMarkdown>,
      );
      expect(container.querySelector('h1')).toBeNull();
    });

    it('showH1=true 시 H1 을 text-display 토큰으로 렌더한다', () => {
      const { container } = render(
        <TermsMarkdown showH1>{'# 이용약관\n\n본문'}</TermsMarkdown>,
      );
      const h1 = container.querySelector('h1');
      expect(h1).not.toBeNull();
      expect(h1?.textContent).toBe('이용약관');
      expect(h1?.className).toContain('text-display');
      expect(h1?.className).toContain('font-semibold');
      expect(h1?.className).toContain('text-gray-900');
    });
  });

  describe('기존 매핑 회귀 가드 (UI-SPEC §Typography L82-87 변경 금지)', () => {
    it('h2 가 mt-6 text-base font-semibold 매핑을 유지한다', () => {
      const { container } = render(
        <TermsMarkdown showH1>{'# 제목\n\n## 제1조 (목적)\n\n본문'}</TermsMarkdown>,
      );
      const h2 = container.querySelector('h2');
      expect(h2?.className).toContain('text-base');
      expect(h2?.className).toContain('font-semibold');
      expect(h2?.className).toContain('text-gray-900');
    });

    it('p 가 text-caption leading-relaxed 매핑을 유지한다', () => {
      const { container } = render(
        <TermsMarkdown>{'본문 단락'}</TermsMarkdown>,
      );
      const p = container.querySelector('p');
      expect(p?.className).toContain('text-caption');
      expect(p?.className).toContain('leading-relaxed');
      expect(p?.className).toContain('text-gray-700');
    });
  });

  it('react-markdown node prop 을 DOM attribute 로 전달하지 않는다', () => {
    const { container } = render(
      <TermsMarkdown showH1>
        {'# 제목\n\n## 부제\n\n본문\n\n- 항목\n\n| A | B |\n|---|---|\n| C | D |'}
      </TermsMarkdown>,
    );

    expect(container.querySelector('[node]')).toBeNull();
  });
});
