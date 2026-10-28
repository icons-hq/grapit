import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const state = vi.hoisted(() => ({pathname:'/',locale:'ko'}));
vi.mock('next/navigation',()=>({usePathname:()=>state.pathname}));
vi.mock('next-intl',()=>({useLocale:()=>state.locale}));
import { MobileTabBar } from '../mobile-tab-bar';

describe('MobileTabBar',()=>{
  beforeEach(()=>{state.pathname='/';state.locale='ko';});
  it('offers all categories, search, home, saved shows and the account hub',()=>{
    render(<MobileTabBar />);
    expect(screen.getAllByRole('link')).toHaveLength(5);
    expect(screen.getByRole('link',{name:'전체 카테고리'}).getAttribute('href')).toBe('/categories');
    expect(screen.getByRole('link',{name:'찜'}).getAttribute('href')).toBe('/wishlist');
    expect(screen.getByRole('link',{name:'마이'}).getAttribute('href')).toBe('/mypage');
  });
  it.each([['/','홈'],['/genre/concert','전체 카테고리'],['/categories','전체 카테고리'],['/mypage/reservations/123','마이'],['/wishlist','찜']])(
    'marks the current destination for %s', (path,label)=>{
      state.pathname=path!;render(<MobileTabBar />);
      expect(screen.getByRole('link',{name:label}).getAttribute('aria-current')).toBe('page');
      expect(screen.getByRole('link',{name:'검색'}).getAttribute('aria-current')).toBeNull();
    });
  it('keeps locale prefixes in every destination',()=>{
    state.pathname='/en/search';state.locale='en';render(<MobileTabBar />);
    expect(screen.getByRole('link',{name:'Search'}).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link',{name:'All categories'}).getAttribute('href')).toBe('/en/categories');
    expect(screen.getByRole('link',{name:'Saved'}).getAttribute('href')).toBe('/en/wishlist');
  });
});
