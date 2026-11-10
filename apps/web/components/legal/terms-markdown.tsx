'use client';

import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * TermsMarkdown
 * Phase 9 DEBT-02: 법률 MD 원문을 Dialog 안에서 prose-like 스타일로 렌더.
 * Phase 16 D-09: showH1 prop 추가 — default false 로 dialog 호환 유지.
 *   - dialog (signup-step2): showH1 미지정 → DialogTitle 이 제목 역할
 *   - 공개 페이지 (/legal/{terms,privacy,marketing}): showH1=true → text-display H1 렌더
 *
 * UI-SPEC §Typography L82-119 타이포 매핑 적용 (h2~hr 변경 금지).
 * Phase 16 review MED-4: table/thead/tbody/tr/th/td 매핑 추가 (privacy 개정 이력 GFM 표용).
 *   기존 9개 매핑 + 신규 6개 매핑 — codex 리뷰 옵션 A 채택 (REVIEWS adjudication accept).
 */
const baseComponents: Components = {
  h2: ({ node: _node, ...props }) => (
    <h2 className="mt-6 text-base font-semibold text-gray-900 first:mt-0" {...props} />
  ),
  h3: ({ node: _node, ...props }) => (
    <h3 className="mt-4 text-caption font-semibold text-gray-800" {...props} />
  ),
  p: ({ node: _node, ...props }) => (
    <p className="mt-2 text-caption leading-relaxed text-gray-700" {...props} />
  ),
  ul: ({ node: _node, ...props }) => (
    <ul className="mt-2 ml-5 list-disc text-caption leading-relaxed text-gray-700" {...props} />
  ),
  ol: ({ node: _node, ...props }) => (
    <ol className="mt-2 ml-5 list-decimal text-caption leading-relaxed text-gray-700" {...props} />
  ),
  li: ({ node: _node, ...props }) => <li className="mt-1" {...props} />,
  strong: ({ node: _node, ...props }) => (
    <strong className="font-semibold text-gray-900" {...props} />
  ),
  a: ({ node: _node, ...props }) => (
    <a
      className="text-primary underline hover:text-primary/80"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    />
  ),
  hr: () => <hr className="my-4 border-gray-200" />,
  // Phase 16 review MED-4 (codex) — TermsMarkdown table 매핑 추가.
  // privacy-policy.md 의 `### 개정 이력` GFM 표 + 향후 약관 개정 이력에서 사용.
  // 모바일 overflow 가드: table 자체가 아닌 wrapper div 가 overflow-x-auto 처리.
  table: ({ node: _node, ...props }) => (
    <div tabIndex={0} className="mt-4 -mx-2 max-w-full overflow-x-auto rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
      <table className="min-w-full text-caption text-gray-700 border-collapse" {...props} />
    </div>
  ),
  thead: ({ node: _node, ...props }) => <thead className="bg-gray-50" {...props} />,
  tbody: ({ node: _node, ...props }) => <tbody className="divide-y divide-gray-200" {...props} />,
  tr: ({ node: _node, ...props }) => <tr {...props} />,
  th: ({ node: _node, ...props }) => (
    <th className="min-w-36 break-keep px-3 py-2 text-left font-semibold text-gray-900 border-b border-gray-300 [overflow-wrap:anywhere]" {...props} />
  ),
  td: ({ node: _node, ...props }) => (
    <td className="min-w-36 break-keep px-3 py-2 align-top border-b border-gray-200 [overflow-wrap:anywhere]" {...props} />
  ),
};

const buildComponents = (showH1: boolean): Components => ({
  ...baseComponents,
  h1: showH1
    ? ({ node: _node, ...props }) => (
        <h1
          className="text-display font-semibold leading-[1.2] text-gray-900"
          {...props}
        />
      )
    : () => null,
});

export function TermsMarkdown({
  children,
  showH1 = false,
}: {
  children: string;
  showH1?: boolean;
}) {
  return (
    <ReactMarkdown components={buildComponents(showH1)} remarkPlugins={[remarkGfm]}>
      {children}
    </ReactMarkdown>
  );
}
