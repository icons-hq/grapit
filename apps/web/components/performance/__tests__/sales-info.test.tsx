import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { SalesInfo } from '../sales-info';

const notice = '- 예매 당일 이후 취소 시 예매수수료는 원칙적으로 환불되지 않습니다.';
const refundRows = [
  ['취소일', '취소수수료'],
  ['예매 당일 23:59까지', '없음'],
  ['예매 후 7일 이내', '없음'],
  ['예매 후 8일 ~ 관람일 10일 전까지', '장당 4,000원 (티켓 금액의 10% 한도)'],
  ['관람일 9일 전 ~ 7일 전까지', '티켓 금액의 10%'],
  ['관람일 6일 전 ~ 3일 전까지', '티켓 금액의 20%'],
  ['관람일 2일 전 ~ 1일 전까지', '티켓 금액의 30%'],
];

describe('SalesInfo', () => {
  it('keeps every notice, date, fee and punctuation while presenting the original rows as a table', () => {
    const source = `${notice}\n\n${refundRows.map((row) => row.join(' | ')).join('\n')}\n`;
    render(<SalesInfo text={source} label="판매정보" />);

    expect(screen.getByText(notice).textContent).toBe(notice);
    const table = screen.getByRole('table', { name: '판매정보' });
    const rows = within(table).getAllByRole('row');
    expect(rows.map((row) => Array.from(row.children, (cell) => cell.textContent))).toEqual(refundRows);
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.getAttribute('scope'))).toEqual(['col', 'col']);
    expect(within(table).getAllByRole('cell')).toHaveLength(12);
  });

  it('preserves literal text without interpreting HTML, links or Markdown', () => {
    const rows = [['항목', '안내'], ['<script>alert(1)</script>', '**원문** [링크](https://example.com)']];
    const { container } = render(<SalesInfo text={rows.map((row) => row.join(' | ')).join('\n')} label="판매정보" />);

    expect(screen.getAllByRole('row').map((row) => Array.from(row.children, (cell) => cell.textContent))).toEqual(rows);
    expect(container.querySelector('script, a, strong')).toBeNull();
  });

  it.each([
    ['plain text', '  안내 문구\n\n두 번째 문장.\n'],
    ['a single pipe line', '안내 | 원문 유지'],
    ['unequal columns', '항목 | 안내\n값 | 내용 | 추가'],
    ['empty cells', '항목 | 안내\n값 | '],
    ['an escaped pipe', '항목 | 안내\n값 | A \\| B'],
  ])('keeps %s unchanged instead of creating a partial table', (_name, text) => {
    const { container } = render(<SalesInfo text={text} label="판매정보" />);
    expect(screen.queryByRole('table')).toBeNull();
    expect(container.textContent).toBe(text);
  });

  it('keeps paragraphs around separate tables and supports outer pipes and CRLF', () => {
    render(<SalesInfo text={'첫 안내\r\n\r\n| 항목 | 수량 | 안내 |\r\n| A | 2 | 원문 |\r\n\r\n다음 안내\r\n\r\n시간 | 장소\r\n오후 | 서울'} label="판매정보" />);
    expect(screen.getByText('첫 안내')).toBeDefined();
    expect(screen.getByText('다음 안내')).toBeDefined();
    const tables = screen.getAllByRole('table', { name: '판매정보' });
    expect(tables).toHaveLength(2);
    expect(within(tables[0]).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['A', '2', '원문']);
    expect(tables[0].style.minWidth).toBe('420px');
    expect(screen.getAllByRole('region').every((region) => region.tabIndex === 0)).toBe(true);
  });
});
