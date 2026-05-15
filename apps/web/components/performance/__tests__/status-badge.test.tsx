import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from '../status-badge';

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

  it('renders Traditional Chinese labels for the launch locale', () => {
    render(<StatusBadge status="selling" locale="zh-TW" />);

    expect(screen.getByText('銷售中')).toBeDefined();
    expect(screen.getByLabelText('Status: 銷售中')).toBeDefined();
  });
});
