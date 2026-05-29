import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { SvgPreview } from '../svg-preview';

// sonner mock — toast.error/success 호출 추적
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// use-admin hook mock — presignedUpload.mutateAsync 호출 여부 추적
const mockMutateAsync = vi.fn();
vi.mock('@/hooks/use-admin', () => ({
  usePresignedUpload: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
  useSaveSeatMap: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

// TierEditor는 본 테스트 범위 밖 — 단순 stub
vi.mock('@/components/admin/tier-editor', () => ({
  TierEditor: ({
    tiers,
    onChange,
  }: {
    tiers: Array<{ tierName: string; color: string; seatIds: string[] }>;
    onChange: (tiers: Array<{ tierName: string; color: string; seatIds: string[] }>) => void;
  }) => (
    <>
      <button
        type="button"
        data-testid="tier-editor"
        onClick={() =>
          onChange([
            ...tiers,
            { tierName: 'R', color: '#00AAFF', seatIds: ['B-1'] },
          ])
        }
      >
        tier-editor
      </button>
      <button
        type="button"
        data-testid="drag-tier-editor"
        onClick={() =>
          onChange([
            { ...tiers[0], seatIds: ['A-1', 'A-2', 'A-3'] },
            ...tiers.slice(1),
          ])
        }
      >
        drag-tier-editor
      </button>
    </>
  ),
}));

import { toast } from 'sonner';

const SVG_WITH_TEXT_STAGE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><text>STAGE</text><rect data-seat-id="A-1" x="10" y="10" width="32" height="32"/></svg>';

const SVG_WITH_ROOT_DATA_STAGE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" data-stage="top"><rect data-seat-id="A-1" x="10" y="10" width="32" height="32"/></svg>';

const SVG_WITH_DESCENDANT_DATA_STAGE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><g data-stage="top"><rect data-seat-id="A-1" x="10" y="10" width="32" height="32"/></g></svg>';

const SVG_WITH_INVALID_DATA_STAGE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" data-stage="invalid-value"><rect data-seat-id="A-1" x="10" y="10" width="32" height="32"/></svg>';

const SVG_WITHOUT_STAGE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><rect data-seat-id="A-1" x="10" y="10" width="32" height="32"/></svg>';

const MALFORMED_SVG = '<svg><g data-stage="top"><rect data-seat-id="A-1"';
const SVG_WITH_STYLE_TAG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><text>STAGE</text><style>#outside-seat-map{display:none!important}</style><rect data-seat-id="A-1" x="10" y="10" width="32" height="32"/></svg>';

const SVG_WITH_MISMATCHED_SEAT_KEY =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><text>STAGE</text><rect data-seat-id="A-1" data-seat-key="2F:A-1" x="10" y="10" width="32" height="32"/></svg>';

function makeFile(content: string, name = 'test.svg'): File {
  return new File([content], name, { type: 'image/svg+xml' });
}

describe('SvgPreview — UX-02 admin 업로드 검증 (D-06/D-07 unified contract + enum + parse safety)', () => {
  beforeEach(() => {
    mockMutateAsync.mockReset();
    mockMutateAsync.mockResolvedValue({
      uploadUrl: 'https://r2.example.com/upload',
      publicUrl: 'https://cdn.example.com/seats/test.svg',
      mode: 'r2',
      cacheControl: 'public, max-age=31536000, immutable',
    });
    vi.mocked(toast.error).mockReset();
    vi.mocked(toast.success).mockReset();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('<text>STAGE</text>를 포함한 SVG 업로드 시 검증 통과 + R2 PUT 호출', async () => {
    const { container } = render(<SvgPreview performanceId="perf-1" />);
    const input = container.querySelector('#svg-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile(SVG_WITH_TEXT_STAGE)] } });

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://r2.example.com/upload',
        expect.objectContaining({
          method: 'PUT',
          headers: {
            'Content-Type': 'image/svg+xml',
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        }),
      );
    });
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });

  it('controlled mode does not emit onChange while syncing existing props', async () => {
    const onChange = vi.fn();

    render(
      <SvgPreview
        currentSvgUrl="https://cdn.example.com/seats/existing.svg"
        currentConfig={{
          tiers: [{ tierName: 'VIP', color: '#FFD700', seatIds: ['A-1'] }],
        }}
        currentTotalSeats={1}
        onChange={onChange}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('tier-editor')).toBeTruthy();
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('controlled mode emits onChange once when tiers change', async () => {
    const onChange = vi.fn();

    render(
      <SvgPreview
        currentSvgUrl="https://cdn.example.com/seats/existing.svg"
        currentConfig={{
          tiers: [{ tierName: 'VIP', color: '#FFD700', seatIds: ['A-1'] }],
        }}
        currentTotalSeats={1}
        onChange={onChange}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('tier-editor')).toBeTruthy();
    });
    onChange.mockClear();

    fireEvent.click(screen.getByTestId('tier-editor'));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
    });
    expect(onChange).toHaveBeenCalledWith({
      svgUrl: 'https://cdn.example.com/seats/existing.svg',
      seatConfig: {
        tiers: [
          { tierName: 'VIP', color: '#FFD700', seatIds: ['A-1'] },
          { tierName: 'R', color: '#00AAFF', seatIds: ['B-1'] },
        ],
      },
      totalSeats: 1,
    });
  });

  it('controlled mode forwards a batched visual tier update as one onChange', async () => {
    const onChange = vi.fn();

    render(
      <SvgPreview
        currentSvgUrl="https://cdn.example.com/seats/existing.svg"
        currentConfig={{
          tiers: [{ tierName: 'VIP', color: '#FFD700', seatIds: ['A-1'] }],
        }}
        currentTotalSeats={3}
        onChange={onChange}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('drag-tier-editor')).toBeTruthy();
    });
    onChange.mockClear();

    fireEvent.click(screen.getByTestId('drag-tier-editor'));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
    });
    expect(onChange).toHaveBeenCalledWith({
      svgUrl: 'https://cdn.example.com/seats/existing.svg',
      seatConfig: {
        tiers: [
          { tierName: 'VIP', color: '#FFD700', seatIds: ['A-1', 'A-2', 'A-3'] },
        ],
      },
      totalSeats: 3,
    });
  });

  it('root data-stage 속성 SVG 업로드 시 검증 통과', async () => {
    const { container } = render(<SvgPreview performanceId="perf-1" />);
    const input = container.querySelector('#svg-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile(SVG_WITH_ROOT_DATA_STAGE)] } });

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });

  it('스테이지 마커 없는 SVG 업로드 시 toast.error + R2 PUT 미발생', async () => {
    const { container } = render(<SvgPreview performanceId="perf-1" />);
    const input = container.querySelector('#svg-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile(SVG_WITHOUT_STAGE)] } });

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
        expect.stringContaining('스테이지 마커'),
      );
    });
    expect(mockMutateAsync).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('10MB 초과 파일은 기존 size 에러 toast가 먼저 호출되어 검증 진입 안 됨', async () => {
    const bigContent = 'x'.repeat(11 * 1024 * 1024); // 11MB
    const { container } = render(<SvgPreview performanceId="perf-1" />);
    const input = container.querySelector('#svg-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile(bigContent, 'big.svg')] } });

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
        expect.stringContaining('10MB'),
      );
    });
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  // reviews revision HIGH #2 — unified parsing contract
  it('reviews revision HIGH #2: <g data-stage="top"> descendant SVG 업로드 시 검증 통과', async () => {
    const { container } = render(<SvgPreview performanceId="perf-1" />);
    const input = container.querySelector('#svg-input') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [makeFile(SVG_WITH_DESCENDANT_DATA_STAGE)] },
    });

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });

  // reviews revision HIGH #2 — enum 검증
  it('reviews revision HIGH #2: data-stage="invalid-value"는 enum 위반으로 거부 + R2 PUT 미발생', async () => {
    const { container } = render(<SvgPreview performanceId="perf-1" />);
    const input = container.querySelector('#svg-input') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [makeFile(SVG_WITH_INVALID_DATA_STAGE)] },
    });

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
        expect.stringContaining('top, right, bottom, left'),
      );
    });
    expect(mockMutateAsync).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // reviews revision LOW #7 — parse 실패 try/catch
  it('reviews revision LOW #7: malformed SVG 업로드 시 parse 실패 toast + R2 PUT 미발생', async () => {
    const { container } = render(<SvgPreview performanceId="perf-1" />);
    const input = container.querySelector('#svg-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile(MALFORMED_SVG)] } });

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
        expect.stringContaining('SVG 형식이 올바르지 않습니다'),
      );
    });
    expect(mockMutateAsync).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('보안상 document-wide CSS를 주입하는 <style> SVG 업로드를 거부한다', async () => {
    const { container } = render(<SvgPreview performanceId="perf-1" />);
    const input = container.querySelector('#svg-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile(SVG_WITH_STYLE_TAG)] } });

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
        expect.stringContaining('보안상 허용되지 않는 SVG'),
      );
    });
    expect(mockMutateAsync).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('expected floor와 다른 data-seat-key prefix가 들어간 SVG 업로드를 거부한다', async () => {
    const { container } = render(
      <SvgPreview
        performanceId="perf-1"
        expectedFloorKey="1F"
      />,
    );
    const input = container.querySelector('#svg-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile(SVG_WITH_MISMATCHED_SEAT_KEY)] } });

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
        expect.stringContaining('data-seat-key'),
      );
    });
    expect(mockMutateAsync).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
