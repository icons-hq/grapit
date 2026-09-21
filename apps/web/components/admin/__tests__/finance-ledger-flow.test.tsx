import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SettlementDashboard } from '../settlement-dashboard';

describe('Finance query states', () => {
  it('does not display a zero amount before a successful query', () => {
    render(<QueryClientProvider client={new QueryClient()}><SettlementDashboard user={{ id: 'finance', role: 'admin', adminCapabilityBundle: 'finance' }} data={null} /></QueryClientProvider>);
    expect(screen.queryByText('₩0')).not.toBeInTheDocument();
    expect(screen.getByText(/공연과 조회 조건을 선택/)).toBeInTheDocument();
  });
});
