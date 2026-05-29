import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { SeatMapViewer } from '../seat-map-viewer';
import type { SeatMapConfig, SeatState } from '@grabit/shared';

// B-3: vi.hoisted로 mock factory가 참조할 const들을 hoist-safe하게 선언
const { transformWrapperSpy, transformComponentSpy, mockUseIsMobile, miniMapSpy } = vi.hoisted(() => ({
  transformWrapperSpy: vi.fn<(props: any) => void>(),
  transformComponentSpy: vi.fn<(props: any) => void>(),
  mockUseIsMobile: vi.fn<() => boolean>(() => false),
  miniMapSpy: vi.fn<(props: any) => null>(() => null),
}));

vi.mock('@/hooks/use-is-mobile', () => ({
  useIsMobile: () => mockUseIsMobile(),
}));

vi.mock('react-zoom-pan-pinch', () => ({
  TransformWrapper: (props: any) => {
    transformWrapperSpy(props);
    return (
      <div data-testid="transform-wrapper">
        {typeof props.children === 'function'
          ? props.children({
              zoomIn: vi.fn(),
              zoomOut: vi.fn(),
              resetTransform: vi.fn(),
            })
          : props.children}
      </div>
    );
  },
  TransformComponent: (props: any) => {
    transformComponentSpy(props);
    return <div data-testid="transform-component">{props.children}</div>;
  },
  MiniMap: (props: any) => {
    miniMapSpy(props);
    return <div data-testid="minimap" />;
  },
}));

vi.mock('../seat-map-controls', () => ({
  SeatMapControls: () => <div data-testid="seat-map-controls" />,
}));

const SVG_CONTENT = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200">
  <circle data-seat-id="A-1" cx="50" cy="50" r="15" />
  <circle data-seat-id="A-2" cx="100" cy="50" r="15" />
  <circle data-seat-id="B-1" cx="50" cy="100" r="15" />
</svg>
`;

const SVG_WITH_TEXT_OVERLAY = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120">
  <g class="seat-cell">
    <rect data-seat-id="A-1" x="20" y="20" width="36" height="24" rx="4" />
    <text x="38" y="36" text-anchor="middle">1</text>
  </g>
  <g class="seat-cell">
    <rect data-seat-id="A-2" x="80" y="20" width="36" height="24" rx="4" />
    <text x="98" y="36" text-anchor="middle">2</text>
  </g>
</svg>
`;

const SVG_WITH_SEAT_KEY = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120">
  <g class="seat-cell">
    <rect data-seat-key="2F:A-1" data-seat-id="A-1" x="20" y="20" width="36" height="24" rx="4" />
    <text x="38" y="36" text-anchor="middle">1</text>
  </g>
  <rect data-seat-id="A-2" x="80" y="20" width="36" height="24" rx="4" />
 </svg>
`;

const SVG_WITH_EXCLUDED_SEATS = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120">
  <rect class="seat seat-excluded" data-seat-id="A-9" x="20" y="20" width="36" height="24" rx="4" fill="#F4D03F" />
  <rect data-seat-id="A-10" data-category="EXCLUDED" x="70" y="20" width="36" height="24" rx="4" />
  <rect data-seat-id="A-11" x="120" y="20" width="36" height="24" rx="4" />
</svg>
`;

const SPECIAL_SEAT_ID = 'A-"1\\vip';
const SVG_WITH_SPECIAL_SEAT_ID = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120">
  <rect data-seat-id="A-&quot;1\\vip" x="20" y="20" width="36" height="24" rx="4" />
</svg>
`;

const mockSeatConfig: SeatMapConfig = {
  tiers: [
    { tierName: 'VIP', color: '#6C3CE0', seatIds: ['A-1', 'A-2'] },
    { tierName: 'R', color: '#3B82F6', seatIds: ['B-1'] },
  ],
};

describe('SeatMapViewer', () => {
  beforeEach(() => {
    transformWrapperSpy.mockClear();
    transformComponentSpy.mockClear();
    mockUseIsMobile.mockReset();
    mockUseIsMobile.mockReturnValue(false);
    miniMapSpy.mockClear();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(SVG_CONTENT),
    });
  });

  it('renders available seats with tier color fill', async () => {
    const seatStates = new Map<string, SeatState>([
      ['A-1', 'available'],
      ['A-2', 'available'],
      ['B-1', 'available'],
    ]);

    const { container } = render(
      <SeatMapViewer
        svgUrl="https://example.com/seats.svg"
        seatConfig={mockSeatConfig}
        seatStates={seatStates}
        selectedSeatIds={new Set()}
        onSeatClick={() => {}}
        maxSelect={4}
      />,
    );

    await waitFor(() => {
      const seatA1 = container.querySelector('[data-seat-id="A-1"]');
      expect(seatA1).toBeTruthy();
      expect(seatA1?.getAttribute('fill')).toBe('#6C3CE0');
    });

    const seatB1 = container.querySelector('[data-seat-id="B-1"]');
    expect(seatB1?.getAttribute('fill')).toBe('#3B82F6');
  });

  it('centers the transform viewport and content within the seat-map viewer', async () => {
    render(
      <SeatMapViewer
        svgUrl="https://example.com/seats.svg"
        seatConfig={mockSeatConfig}
        seatStates={new Map<string, SeatState>([
          ['A-1', 'available'],
        ])}
        selectedSeatIds={new Set()}
        onSeatClick={() => {}}
        maxSelect={4}
      />,
    );

    await waitFor(() => {
      expect(transformComponentSpy).toHaveBeenCalled();
    });

    expect(transformComponentSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        wrapperClass: expect.stringMatching(/\bflex\b/),
        contentClass: expect.stringMatching(/\bflex\b/),
        wrapperStyle: expect.objectContaining({
          width: '100%',
          maxWidth: '100%',
        }),
        contentStyle: expect.objectContaining({
          width: '100%',
        }),
      }),
    );
    const props = transformComponentSpy.mock.lastCall?.[0];
    expect(props.wrapperClass).toEqual(expect.stringContaining('min-h-[300px]'));
    expect(props.wrapperClass).toEqual(expect.stringContaining('lg:min-h-[500px]'));
    expect(props.wrapperClass).toEqual(expect.stringContaining('items-center'));
    expect(props.wrapperClass).toEqual(expect.stringContaining('justify-center'));
    expect(props.contentClass).toEqual(expect.stringContaining('min-h-[300px]'));
    expect(props.contentClass).toEqual(expect.stringContaining('lg:min-h-[500px]'));
    expect(props.contentClass).toEqual(expect.stringContaining('items-center'));
    expect(props.contentClass).toEqual(expect.stringContaining('justify-center'));
  });

  it('sanitizes executable SVG payloads before inline rendering', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(`
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
            <script>alert('xss')</script>
            <style>#outside-seat-map{display:none!important}</style>
            <foreignObject><body onload="alert('xss')"></body></foreignObject>
            <a href="javascript:alert('xss')">
              <circle data-seat-id="A-1" onclick="alert('xss')" cx="20" cy="20" r="10" />
            </a>
          </svg>
        `),
    });

    const { container } = render(
      <SeatMapViewer
        svgUrl="https://example.com/malicious.svg"
        seatConfig={mockSeatConfig}
        seatStates={new Map([['A-1', 'available']])}
        selectedSeatIds={new Set()}
        onSeatClick={() => {}}
        maxSelect={4}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector('[data-seat-id="A-1"]')).toBeTruthy();
    });

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('style')).toBeNull();
    expect(container.innerHTML).not.toContain('outside-seat-map');
    expect(container.querySelector('foreignObject')).toBeNull();
    expect(container.querySelector('[onclick]')).toBeNull();
    expect(container.innerHTML).not.toContain('javascript:');
  });

  it('renders unavailable seats with gray fill and reduced opacity', async () => {
    const seatStates = new Map<string, SeatState>([
      ['A-1', 'locked'],
      ['A-2', 'held'],
      ['B-1', 'disabled'],
    ]);

    const { container } = render(
      <SeatMapViewer
        svgUrl="https://example.com/seats.svg"
        seatConfig={mockSeatConfig}
        seatStates={seatStates}
        selectedSeatIds={new Set()}
        onSeatClick={() => {}}
        maxSelect={4}
      />,
    );

    await waitFor(() => {
      const seatA1 = container.querySelector(
        '[data-seat-id="A-1"]',
      ) as SVGElement;
      expect(seatA1?.getAttribute('fill')).toBe('#D1D5DB');
      expect(seatA1?.style.opacity).toBe('0.6');
    });

    const seatA2 = container.querySelector(
      '[data-seat-id="A-2"]',
    ) as SVGElement;
    expect(seatA2?.getAttribute('fill')).toBe('#D1D5DB');
    expect(seatA2?.style.opacity).toBe('0.6');

    const seatB1 = container.querySelector(
      '[data-seat-id="B-1"]',
    ) as SVGElement;
    expect(seatB1?.getAttribute('fill')).toBe('#D1D5DB');
    expect(seatB1?.style.opacity).toBe('0.6');
  });

  it('calls onSeatClick when clicking an available seat', async () => {
    const onSeatClick = vi.fn();
    const seatStates = new Map<string, SeatState>([
      ['A-1', 'available'],
      ['A-2', 'locked'],
    ]);

    const { container } = render(
      <SeatMapViewer
        svgUrl="https://example.com/seats.svg"
        seatConfig={mockSeatConfig}
        seatStates={seatStates}
        selectedSeatIds={new Set()}
        onSeatClick={onSeatClick}
        maxSelect={4}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector('[data-seat-id="A-1"]')).toBeTruthy();
    });

    const seatA1 = container.querySelector('[data-seat-id="A-1"]')!;
    fireEvent.click(seatA1);
    expect(onSeatClick).toHaveBeenCalledWith('A-1');
  });

  it('clicking centered seat-number text over A-1 still selects the seat', async () => {
    const onSeatClick = vi.fn();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(SVG_WITH_TEXT_OVERLAY),
    });

    const { container } = render(
      <SeatMapViewer
        svgUrl="https://example.com/text-overlay.svg"
        seatConfig={mockSeatConfig}
        seatStates={new Map<string, SeatState>([
          ['A-1', 'available'],
          ['A-2', 'available'],
        ])}
        selectedSeatIds={new Set()}
        onSeatClick={onSeatClick}
        maxSelect={4}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector('[data-seat-id="A-1"]')).toBeTruthy();
    });

    const seatLabel = Array.from(container.querySelectorAll('text')).find(
      (node) => node.textContent?.trim() === '1',
    );

    expect(seatLabel).toBeTruthy();
    expect(seatLabel?.getAttribute('pointer-events')).toBe('none');
    fireEvent.click(seatLabel!);
    expect(onSeatClick).toHaveBeenCalledWith('A-1');
  });

  it('does NOT call onSeatClick when clicking a locked seat', async () => {
    const onSeatClick = vi.fn();
    const seatStates = new Map<string, SeatState>([
      ['A-1', 'locked'],
    ]);

    const { container } = render(
      <SeatMapViewer
        svgUrl="https://example.com/seats.svg"
        seatConfig={mockSeatConfig}
        seatStates={seatStates}
        selectedSeatIds={new Set()}
        onSeatClick={onSeatClick}
        maxSelect={4}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector('[data-seat-id="A-1"]')).toBeTruthy();
    });

    const seatA1 = container.querySelector('[data-seat-id="A-1"]')!;
    fireEvent.click(seatA1);
    expect(onSeatClick).not.toHaveBeenCalled();
  });

  it('PR18-CR-MAXSELECT-LOCKED: maxSelect 도달 후 locked 좌석 클릭은 viewer에서 차단된다', async () => {
    const onSeatClick = vi.fn();
    const seatStates = new Map<string, SeatState>([
      ['A-1', 'available'],
      ['A-2', 'available'],
      ['B-1', 'locked'],
    ]);

    const { container } = render(
      <SeatMapViewer
        svgUrl="https://example.com/seats.svg"
        seatConfig={mockSeatConfig}
        seatStates={seatStates}
        selectedSeatIds={new Set(['A-1', 'A-2'])}
        onSeatClick={onSeatClick}
        maxSelect={2}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector('[data-seat-id="B-1"]')).toBeTruthy();
    });

    const seatB1 = container.querySelector('[data-seat-id="B-1"]')!;
    fireEvent.click(seatB1);
    expect(onSeatClick).not.toHaveBeenCalled();
  });

  it('PR18-CR-MAXSELECT-LOCKED 회귀 방지: maxSelect 도달 시 sold 좌석은 여전히 viewer에서 차단', async () => {
    const onSeatClick = vi.fn();
    const seatStates = new Map<string, SeatState>([
      ['A-1', 'available'],
      ['A-2', 'available'],
      ['B-1', 'sold'],
    ]);

    const { container } = render(
      <SeatMapViewer
        svgUrl="https://example.com/seats.svg"
        seatConfig={mockSeatConfig}
        seatStates={seatStates}
        selectedSeatIds={new Set(['A-1', 'A-2'])}
        onSeatClick={onSeatClick}
        maxSelect={2}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector('[data-seat-id="B-1"]')).toBeTruthy();
    });

    const seatB1 = container.querySelector('[data-seat-id="B-1"]')!;
    fireEvent.click(seatB1);
    expect(onSeatClick).not.toHaveBeenCalled();
  });

  it('PR18-CR-MAXSELECT-LOCKED 회귀 방지: maxSelect 도달 시 available 좌석은 viewer에서 차단 (WR-02 유지)', async () => {
    const onSeatClick = vi.fn();
    const seatStates = new Map<string, SeatState>([
      ['A-1', 'available'],
      ['A-2', 'available'],
      ['B-1', 'available'],
    ]);

    const { container } = render(
      <SeatMapViewer
        svgUrl="https://example.com/seats.svg"
        seatConfig={mockSeatConfig}
        seatStates={seatStates}
        selectedSeatIds={new Set(['A-1', 'A-2'])}
        onSeatClick={onSeatClick}
        maxSelect={2}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector('[data-seat-id="B-1"]')).toBeTruthy();
    });

    const seatB1 = container.querySelector('[data-seat-id="B-1"]')!;
    fireEvent.click(seatB1);
    expect(onSeatClick).not.toHaveBeenCalled();
  });

  it('does NOT call onSeatClick when clicking a sold seat', async () => {
    const onSeatClick = vi.fn();
    const seatStates = new Map<string, SeatState>([
      ['A-1', 'sold'],
    ]);

    const { container } = render(
      <SeatMapViewer
        svgUrl="https://example.com/seats.svg"
        seatConfig={mockSeatConfig}
        seatStates={seatStates}
        selectedSeatIds={new Set()}
        onSeatClick={onSeatClick}
        maxSelect={4}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector('[data-seat-id="A-1"]')).toBeTruthy();
    });

    const seatA1 = container.querySelector('[data-seat-id="A-1"]')!;
    fireEvent.click(seatA1);
    expect(onSeatClick).not.toHaveBeenCalled();
  });

  it('does NOT call onSeatClick when clicking a disabled seat', async () => {
    const onSeatClick = vi.fn();
    const seatStates = new Map<string, SeatState>([
      ['A-1', 'disabled'],
    ]);

    const { container } = render(
      <SeatMapViewer
        svgUrl="https://example.com/seats.svg"
        seatConfig={mockSeatConfig}
        seatStates={seatStates}
        selectedSeatIds={new Set()}
        onSeatClick={onSeatClick}
        maxSelect={4}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector('[data-seat-id="A-1"]')).toBeTruthy();
    });

    const seatA1 = container.querySelector('[data-seat-id="A-1"]')!;
    fireEvent.click(seatA1);
    expect(onSeatClick).not.toHaveBeenCalled();
  });

  it('uses the current floor key for callbacks even when SVG data-seat-key is stale', async () => {
    const onSeatClick = vi.fn();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(SVG_WITH_SEAT_KEY),
    });

    const { container } = render(
      <SeatMapViewer
        svgUrl="https://example.com/seat-key.svg"
        floorKey="1F"
        floorLabel="1층"
        seatConfig={mockSeatConfig}
        seatStates={new Map<string, SeatState>([
          ['1F:A-1', 'available'],
          ['A-2', 'available'],
        ])}
        selectedSeatIds={new Set()}
        onSeatClick={onSeatClick}
        maxSelect={4}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector('[data-seat-key="1F:A-1"]')).toBeTruthy();
    });

    fireEvent.click(container.querySelector('[data-seat-key="1F:A-1"]')!);
    expect(onSeatClick).toHaveBeenCalledWith('1F:A-1');

    fireEvent.click(container.querySelector('[data-seat-id="A-2"]')!);
    expect(onSeatClick).toHaveBeenCalledWith('1F:A-2');
  });

  it('uses the canonical current-floor key for text overlay clicks and selected styling', async () => {
    const onSeatClick = vi.fn();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(SVG_WITH_SEAT_KEY),
    });

    const { container } = render(
      <SeatMapViewer
        svgUrl="https://example.com/seat-key-overlay.svg"
        floorKey="1F"
        floorLabel="1층"
        seatConfig={mockSeatConfig}
        seatStates={new Map<string, SeatState>([
          ['1F:A-1', 'available'],
        ])}
        selectedSeatIds={new Set(['1F:A-1'])}
        onSeatClick={onSeatClick}
        maxSelect={4}
      />,
    );

    await waitFor(() => {
      const seat = container.querySelector('[data-seat-key="1F:A-1"]') as SVGElement;
      expect(seat?.getAttribute('stroke')).toBe('#1A1A2E');
    });

    const seatLabel = Array.from(container.querySelectorAll('text')).find(
      (node) => node.textContent?.trim() === '1',
    );
    expect(seatLabel?.getAttribute('data-seat-overlay-for')).toBe('1F:A-1');

    fireEvent.click(seatLabel!);
    expect(onSeatClick).toHaveBeenCalledWith('1F:A-1');
  });

  it('marks excluded seats as disabled and does not call onSeatClick', async () => {
    const onSeatClick = vi.fn();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(SVG_WITH_EXCLUDED_SEATS),
    });

    const { container } = render(
      <SeatMapViewer
        svgUrl="https://example.com/excluded-seats.svg"
        seatConfig={{
          tiers: [
            { tierName: 'VIP', color: '#6C3CE0', seatIds: ['A-11'] },
          ],
        }}
        seatStates={new Map<string, SeatState>([
          ['A-9', 'available'],
          ['A-10', 'available'],
          ['A-11', 'available'],
        ])}
        selectedSeatIds={new Set()}
        onSeatClick={onSeatClick}
        maxSelect={4}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector('[data-seat-id="A-9"]')).toBeTruthy();
    });

    const classExcluded = container.querySelector('[data-seat-id="A-9"]')!;
    const categoryExcluded = container.querySelector('[data-seat-id="A-10"]')!;
    const availableSeat = container.querySelector('[data-seat-id="A-11"]')!;

    expect(classExcluded.getAttribute('data-seat-excluded')).toBe('true');
    expect(categoryExcluded.getAttribute('aria-disabled')).toBe('true');

    fireEvent.click(classExcluded);
    fireEvent.click(categoryExcluded);
    expect(onSeatClick).not.toHaveBeenCalled();

    fireEvent.click(availableSeat);
    expect(onSeatClick).toHaveBeenCalledWith('A-11');
  });

  it('renders selected seats with dark stroke', async () => {
    const seatStates = new Map<string, SeatState>([
      ['A-1', 'available'],
    ]);

    const { container } = render(
      <SeatMapViewer
        svgUrl="https://example.com/seats.svg"
        seatConfig={mockSeatConfig}
        seatStates={seatStates}
        selectedSeatIds={new Set(['A-1'])}
        onSeatClick={() => {}}
        maxSelect={4}
      />,
    );

    await waitFor(() => {
      const seatA1 = container.querySelector('[data-seat-id="A-1"]');
      expect(seatA1?.getAttribute('stroke')).toBe('#1A1A2E');
      expect(seatA1?.getAttribute('stroke-width')).toBe('3');
    });
  });

  it('styles selected and pending seats when the seat id contains CSS selector characters', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(SVG_WITH_SPECIAL_SEAT_ID),
    });

    const specialSeatConfig: SeatMapConfig = {
      tiers: [
        {
          tierName: 'VIP',
          color: '#3B82F6',
          seatIds: [SPECIAL_SEAT_ID],
        },
      ],
    };
    const seatStates = new Map<string, SeatState>([
      [SPECIAL_SEAT_ID, 'available'],
    ]);

    const { container, rerender } = render(
      <SeatMapViewer
        svgUrl="https://example.com/special-seat-id.svg"
        seatConfig={specialSeatConfig}
        seatStates={seatStates}
        selectedSeatIds={new Set([SPECIAL_SEAT_ID])}
        onSeatClick={() => {}}
        maxSelect={4}
      />,
    );

    const findSpecialSeat = () =>
      Array.from(container.querySelectorAll<SVGElement>('[data-seat-id]')).find(
        (element) => element.getAttribute('data-seat-id') === SPECIAL_SEAT_ID,
      );

    await waitFor(() => {
      const seat = findSpecialSeat();
      expect(seat).toBeTruthy();
      expect(seat?.style.transition).toContain('fill 150ms');
      expect(seat?.getAttribute('fill')).toBe('#6C3CE0');
    });

    rerender(
      <SeatMapViewer
        svgUrl="https://example.com/special-seat-id.svg"
        seatConfig={specialSeatConfig}
        seatStates={seatStates}
        selectedSeatIds={new Set()}
        onSeatClick={() => {}}
        maxSelect={4}
      />,
    );

    await waitFor(() => {
      const seat = findSpecialSeat();
      expect(seat).toBeTruthy();
      expect(seat?.style.transition).toContain('fill 150ms');
      expect(seat?.getAttribute('fill')).toBe('#3B82F6');
    });
  });

  it('shows error state when SVG fetch fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
    });

    render(
      <SeatMapViewer
        svgUrl="https://example.com/bad.svg"
        seatConfig={mockSeatConfig}
        seatStates={new Map()}
        selectedSeatIds={new Set()}
        onSeatClick={() => {}}
        maxSelect={4}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          '좌석 배치도를 불러오지 못했습니다. 새로고침해주세요.',
        ),
      ).toBeDefined();
    });
  });

  // 신규 케이스 1 (B-2-RESIDUAL-V2 Option C): useEffect가 fill을 primary로 변경 + transition 부여
  it('B-2-RESIDUAL-V2 Option C: 선택 좌석에 useEffect가 el.style.transition=fill 150ms 부여 + fill primary 변경 (UX-04)', async () => {
    const seatStates = new Map<string, SeatState>([['A-1', 'available']]);
    const { container } = render(
      <SeatMapViewer
        svgUrl="https://example.com/seats.svg"
        seatConfig={mockSeatConfig}
        seatStates={seatStates}
        selectedSeatIds={new Set(['A-1'])}
        onSeatClick={() => {}}
        maxSelect={4}
      />,
    );
    await waitFor(() => {
      const seatA1 = container.querySelector('[data-seat-id="A-1"]') as SVGElement;
      expect(seatA1).toBeTruthy();
      expect(seatA1.style.transition).toContain('fill 150ms');
    });
    await waitFor(() => {
      const seatA1 = container.querySelector('[data-seat-id="A-1"]') as SVGElement;
      const fill = seatA1.getAttribute('fill') ?? '';
      expect(fill.toLowerCase()).toMatch(/#6c3ce0|var\(--color-primary\)/);
    });
  });

  // 신규 케이스 2: locked 좌석 transition:none 회귀 (D-13)
  it('locked 좌석은 transition:none을 유지한다 (D-13 회귀 방지)', async () => {
    const seatStates = new Map<string, SeatState>([['A-1', 'locked']]);
    const { container } = render(
      <SeatMapViewer
        svgUrl="https://example.com/seats.svg"
        seatConfig={mockSeatConfig}
        seatStates={seatStates}
        selectedSeatIds={new Set()}
        onSeatClick={() => {}}
        maxSelect={4}
      />,
    );
    await waitFor(() => {
      const seatA1 = container.querySelector('[data-seat-id="A-1"]') as SVGElement;
      const styleAttr = seatA1.getAttribute('style') ?? '';
      expect(styleAttr).toContain('transition:none');
    });
  });

  // 신규 케이스 3: 선택 좌석 data-seat-checkmark (UX-04 mount fade-in)
  it('선택 좌석에 data-seat-checkmark 속성을 가진 <text> 요소가 삽입된다 (UX-04)', async () => {
    const seatStates = new Map<string, SeatState>([['A-1', 'available']]);
    const { container } = render(
      <SeatMapViewer
        svgUrl="https://example.com/seats.svg"
        seatConfig={mockSeatConfig}
        seatStates={seatStates}
        selectedSeatIds={new Set(['A-1'])}
        onSeatClick={() => {}}
        maxSelect={4}
      />,
    );
    await waitFor(() => {
      const checkmark = container.querySelector('[data-seat-checkmark]');
      expect(checkmark).toBeTruthy();
      expect(checkmark?.tagName.toLowerCase()).toBe('text');
      expect(checkmark?.getAttribute('pointer-events')).toBe('none');
    });
  });

  // 신규 케이스 4: MiniMap 마운트 분기 (UX-05)
  it('데스크톱(isMobile=false)에서 MiniMap 마운트, 모바일(true)에서 미마운트 (UX-05)', async () => {
    mockUseIsMobile.mockReturnValue(false);
    const { container, unmount } = render(
      <SeatMapViewer
        svgUrl="https://example.com/seats.svg"
        seatConfig={mockSeatConfig}
        seatStates={new Map()}
        selectedSeatIds={new Set()}
        onSeatClick={() => {}}
        maxSelect={4}
      />,
    );
    await waitFor(() => {
      expect(container.querySelector('[data-testid="minimap"]')).toBeTruthy();
    });
    unmount();

    mockUseIsMobile.mockReturnValue(true);
    const { container: mobileContainer } = render(
      <SeatMapViewer
        svgUrl="https://example.com/seats.svg"
        seatConfig={mockSeatConfig}
        seatStates={new Map()}
        selectedSeatIds={new Set()}
        onSeatClick={() => {}}
        maxSelect={4}
      />,
    );
    await waitFor(() => {
      expect(mobileContainer.querySelector('[data-testid="transform-wrapper"]')).toBeTruthy();
    });
    expect(mobileContainer.querySelector('[data-testid="minimap"]')).toBeFalsy();
  });

  // 신규 케이스 5: 모바일 initialScale=1.4 (UX-06)
  it('isMobile=true 시 TransformWrapper에 initialScale=1.4 전달 (UX-06)', async () => {
    mockUseIsMobile.mockReturnValue(true);
    render(
      <SeatMapViewer
        svgUrl="https://example.com/seats.svg"
        seatConfig={mockSeatConfig}
        seatStates={new Map()}
        selectedSeatIds={new Set()}
        onSeatClick={() => {}}
        maxSelect={4}
      />,
    );
    await waitFor(() => {
      expect(transformWrapperSpy).toHaveBeenCalledWith(
        expect.objectContaining({ initialScale: 1.4 }),
      );
    });
  });

  // 신규 케이스 6: STAGE 배지 오버레이 (UX-02 viewer — root data-stage)
  it('SVG에 root data-stage 속성만 있을 때 viewer가 STAGE <text> 오버레이를 추가한다 (UX-02)', async () => {
    const SVG_WITH_ROOT_DATA_STAGE_ONLY = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" data-stage="top">
  <rect data-seat-id="A-1" x="10" y="50" width="32" height="32"/>
</svg>
`;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(SVG_WITH_ROOT_DATA_STAGE_ONLY),
    });
    const { container } = render(
      <SeatMapViewer
        svgUrl="https://example.com/data-stage.svg"
        seatConfig={mockSeatConfig}
        seatStates={new Map()}
        selectedSeatIds={new Set()}
        onSeatClick={() => {}}
        maxSelect={4}
      />,
    );
    await waitFor(() => {
      const stageText = Array.from(container.querySelectorAll('text')).find(
        (t) => t.textContent?.trim() === 'STAGE',
      );
      expect(stageText).toBeTruthy();
    });
  });

  // 신규 케이스 7 (B-2-RESIDUAL): 해제 시 체크마크 data-fading-out + 160ms 후 DOM 제거
  it('B-2-RESIDUAL: 해제 시 체크마크에 data-fading-out="true" 부여되고 160ms 후 DOM에서 제거됨', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const seatStates = new Map<string, SeatState>([['A-1', 'available']]);

      const { container, rerender } = render(
        <SeatMapViewer
          svgUrl="https://example.com/seats.svg"
          seatConfig={mockSeatConfig}
          seatStates={seatStates}
          selectedSeatIds={new Set(['A-1'])}
          onSeatClick={() => {}}
          maxSelect={4}
        />,
      );

      await vi.waitFor(() => {
        const checkmark = container.querySelector('[data-seat-checkmark]');
        expect(checkmark).toBeTruthy();
      });

      rerender(
        <SeatMapViewer
          svgUrl="https://example.com/seats.svg"
          seatConfig={mockSeatConfig}
          seatStates={seatStates}
          selectedSeatIds={new Set()}
          onSeatClick={() => {}}
          maxSelect={4}
        />,
      );

      await vi.waitFor(() => {
        const checkmarkDuringFadeOut = container.querySelector('[data-seat-checkmark]');
        expect(checkmarkDuringFadeOut).toBeTruthy();
        expect(checkmarkDuringFadeOut?.getAttribute('data-fading-out')).toBe('true');
      });

      await act(async () => {
        vi.advanceTimersByTime(160);
      });
      await vi.waitFor(() => {
        const checkmarkAfterRemoval = container.querySelector('[data-seat-checkmark]');
        expect(checkmarkAfterRemoval).toBeFalsy();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  // 신규 케이스 8 (reviews revision HIGH #1): 빠른 해제→재선택 race guard
  it('reviews revision HIGH #1: 해제(80ms) → 재선택 → 200ms 진행 시퀀스에서 data-fading-out이 stuck되지 않음', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const seatStates = new Map<string, SeatState>([['A-1', 'available']]);

      // Phase 1: A-1 선택 → 체크마크 마운트
      const { container, rerender } = render(
        <SeatMapViewer
          svgUrl="https://example.com/seats.svg"
          seatConfig={mockSeatConfig}
          seatStates={seatStates}
          selectedSeatIds={new Set(['A-1'])}
          onSeatClick={() => {}}
          maxSelect={4}
        />,
      );

      await vi.waitFor(() => {
        expect(container.querySelector('[data-seat-checkmark]')).toBeTruthy();
      });

      // Phase 2: A-1 해제 → data-fading-out="true" 부여됨
      rerender(
        <SeatMapViewer
          svgUrl="https://example.com/seats.svg"
          seatConfig={mockSeatConfig}
          seatStates={seatStates}
          selectedSeatIds={new Set()}
          onSeatClick={() => {}}
          maxSelect={4}
        />,
      );

      await vi.waitFor(() => {
        const fading = container.querySelector('[data-seat-checkmark][data-fading-out="true"]');
        expect(fading).toBeTruthy();
      });

      // Phase 3: 80ms 진행 (타이머 만료 전)
      await act(async () => {
        vi.advanceTimersByTime(80);
      });

      // Phase 4: 재선택 — 기존 timeout이 cleared 되어야 함 + data-fading-out 즉시 제거
      rerender(
        <SeatMapViewer
          svgUrl="https://example.com/seats.svg"
          seatConfig={mockSeatConfig}
          seatStates={seatStates}
          selectedSeatIds={new Set(['A-1'])}
          onSeatClick={() => {}}
          maxSelect={4}
        />,
      );

      // Phase 5: 추가 200ms 진행 — 과거 timeout이 cleared 되지 않았다면 여기서 DOM 제거 + data-fading-out stuck 발생
      await act(async () => {
        vi.advanceTimersByTime(200);
      });

      // 검증: 체크마크 DOM에 존재 + data-fading-out 속성 없음 (stuck 방지)
      await vi.waitFor(() => {
        const checkmark = container.querySelector('[data-seat-checkmark]');
        expect(checkmark).toBeTruthy();
        expect(checkmark?.getAttribute('data-fading-out')).toBeNull();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  // 신규 케이스 9 (reviews revision HIGH #2): <g data-stage="right"> descendant SVG에서 viewer가 우측 STAGE 오버레이 생성
  it('reviews revision HIGH #2: <g data-stage="right"> descendant SVG에서 viewer가 우측 STAGE 오버레이 생성', async () => {
    const SVG_WITH_DESCENDANT_RIGHT = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200">
  <g data-stage="right">
    <rect data-seat-id="A-1" x="10" y="50" width="32" height="32"/>
  </g>
</svg>
`;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(SVG_WITH_DESCENDANT_RIGHT),
    });
    const { container } = render(
      <SeatMapViewer
        svgUrl="https://example.com/descendant-right.svg"
        seatConfig={mockSeatConfig}
        seatStates={new Map()}
        selectedSeatIds={new Set()}
        onSeatClick={() => {}}
        maxSelect={4}
      />,
    );
    await waitFor(() => {
      const stageText = Array.from(container.querySelectorAll('text')).find(
        (t) => t.textContent?.trim() === 'STAGE',
      );
      expect(stageText).toBeTruthy();
    });
    // 우측 배지: x 좌표가 viewBox width (400)에 가까움 (badgeWidth=120, padding=12 기준 우측 근방)
    const stageTextEl = Array.from(container.querySelectorAll('text')).find(
      (t) => t.textContent?.trim() === 'STAGE',
    );
    const xAttr = parseFloat(stageTextEl?.getAttribute('x') ?? '0');
    // 우측에 배치 → x는 viewBox width의 절반을 초과해야 함 (400의 중앙인 200보다 커야 함)
    expect(xAttr).toBeGreaterThan(200);
  });

  // 신규 케이스 10 (reviews revision MED #4): selected + locked broadcast 회귀 — D-13 BROADCAST PRIORITY
  it('reviews revision MED #4 (D-13 BROADCAST PRIORITY): 선택 좌석이 broadcast로 locked 전환 시 fill LOCKED_COLOR 유지 + transition 없음', async () => {
    // Phase 1: A-1이 selected + available
    const { container, rerender } = render(
      <SeatMapViewer
        svgUrl="https://example.com/seats.svg"
        seatConfig={mockSeatConfig}
        seatStates={new Map<string, SeatState>([['A-1', 'available']])}
        selectedSeatIds={new Set(['A-1'])}
        onSeatClick={() => {}}
        maxSelect={4}
      />,
    );

    await waitFor(() => {
      const seatA1 = container.querySelector('[data-seat-id="A-1"]') as SVGElement;
      expect(seatA1).toBeTruthy();
    });

    // Phase 2: 같은 selectedSeatIds 유지하면서 seatStates만 broadcast로 locked 전환
    rerender(
      <SeatMapViewer
        svgUrl="https://example.com/seats.svg"
        seatConfig={mockSeatConfig}
        seatStates={new Map<string, SeatState>([['A-1', 'locked']])}
        selectedSeatIds={new Set(['A-1'])}
        onSeatClick={() => {}}
        maxSelect={4}
      />,
    );

    await waitFor(() => {
      const seatA1 = container.querySelector('[data-seat-id="A-1"]') as SVGElement;
      const fill = seatA1.getAttribute('fill') ?? '';
      // D-13: locked color (#D1D5DB)로 유지, primary 색 X
      expect(fill.toLowerCase()).toBe('#d1d5db');
      // transition이 fill 150ms로 적용되지 않아야 함 (useEffect가 skip)
      const styleAttr = seatA1.getAttribute('style') ?? '';
      expect(styleAttr).toContain('transition:none');
    });
  });
});
