import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SeatMapConfig } from '@grabit/shared';

import { TierEditor } from '../tier-editor';

vi.mock('@/components/admin/visual-seat-tier-editor', () => ({ VisualSeatTierEditor: () => null }));

function StatefulTierEditor({ onTiers }: { onTiers: (tiers: SeatMapConfig['tiers']) => void }) {
  const [tiers, setTiers] = useState<SeatMapConfig['tiers']>([{ tierName: 'VIP', color: '#6C3CE0', seatIds: [] }]);
  return (
    <>
      <TierEditor tiers={tiers} onChange={(next) => { setTiers(next); onTiers(next); }} allowTierStructureEditing={false} />
      <button type="button" onClick={() => setTiers([{ ...tiers[0]!, seatIds: ['Z1', 'Z2'] }])}>시각 편집기 선택</button>
    </>
  );
}

describe('TierEditor manual seat id input', () => {
  it('lets an operator type several comma-separated seat ids when the visual editor is unavailable', async () => {
    const onTiers = vi.fn();
    const user = userEvent.setup();
    render(<StatefulTierEditor onTiers={onTiers} />);
    const textarea = screen.getByLabelText('VIP 좌석 ID');

    await user.click(screen.getByText('좌석 ID 직접 입력'));
    await user.type(textarea, 'A1, A2,A3');

    expect(textarea).toHaveValue('A1, A2,A3');
    expect(onTiers).toHaveBeenLastCalledWith([{ tierName: 'VIP', color: '#6C3CE0', seatIds: ['A1', 'A2', 'A3'] }]);

    await user.tab();
    expect(textarea).toHaveValue('A1, A2, A3');
  });

  it('shows seat ids changed elsewhere once the operator is not typing', async () => {
    const user = userEvent.setup();
    render(<StatefulTierEditor onTiers={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: '시각 편집기 선택' }));

    expect(screen.getByLabelText('VIP 좌석 ID')).toHaveValue('Z1, Z2');
  });
});
