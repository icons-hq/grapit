import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { getDisplayPerformanceStatus, StatusBadge } from '../status-badge';

describe('StatusBadge', () => {
  it('renders correct label for selling status', () => {
    render(<StatusBadge status="selling" />);
    expect(screen.getByText('오픈')).toBeDefined();
  });

  it('renders correct label for closing_soon status', () => {
    render(<StatusBadge status="closing_soon" />);
    expect(screen.getByText('마감임박')).toBeDefined();
  });

  it('renders correct label for ended status', () => {
    render(<StatusBadge status="ended" />);
    expect(screen.getByText('판매종료')).toBeDefined();
  });

  it('renders correct label for upcoming status', () => {
    render(<StatusBadge status="upcoming" />);
    expect(screen.getByText('오픈예정')).toBeDefined();
  });

  it('has accessible aria-label', () => {
    render(<StatusBadge status="selling" />);
    expect(screen.getByLabelText('상태: 오픈')).toBeDefined();
  });

  it('renders Simplified Chinese labels for the launch locale', () => {
    render(<StatusBadge status="selling" locale="zh-CN" />);

    expect(screen.getByText('销售中')).toBeDefined();
    expect(screen.getByLabelText('Status: 销售中')).toBeDefined();
  });

  it('displays selling as upcoming while the booking gate is closed', () => {
    expect(getDisplayPerformanceStatus('selling', false)).toBe('upcoming');
  });

  it('displays closing soon as upcoming while the booking gate is closed', () => {
    expect(getDisplayPerformanceStatus('closing_soon', false)).toBe('upcoming');
  });

  it('keeps ended as ended while the booking gate is closed', () => {
    expect(getDisplayPerformanceStatus('ended', false)).toBe('ended');
  });

  it('keeps selling as selling while the booking gate is open', () => {
    expect(getDisplayPerformanceStatus('selling', true)).toBe('selling');
  });
});
