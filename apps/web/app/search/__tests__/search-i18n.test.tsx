import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
let searchParams = new URLSearchParams();
const replaceMock=vi.fn();
vi.mock('next-intl',()=>({useLocale:()=> 'en'}));
vi.mock('next/navigation',()=>({useRouter:()=>({replace:replaceMock}),usePathname:()=>'/en/search',useSearchParams:()=>searchParams}));
vi.mock('@/hooks/use-search',()=>({useSearch:()=>({data:{data:[],total:0,page:1,totalPages:1},isLoading:false,isError:false})}));
import SearchPage from '../page';

describe('Ticket search i18n and filters',()=>{
  beforeEach(()=>{searchParams=new URLSearchParams();replaceMock.mockClear();});
  it('offers a localized search and all genres before entering a query',()=>{
    render(<SearchPage />);
    expect(screen.getByRole('searchbox',{name:'Search'})).toBeDefined();
    expect(screen.getByRole('heading',{name:'Looking for a show?'})).toBeDefined();
    expect(screen.getByRole('link',{name:'Concert'})).toHaveAttribute('href','/en/genre/concert');
  });
  it('preserves active filters and clears stale pagination for a new query',async()=>{
    searchParams=new URLSearchParams('page=3&ended=true');render(<SearchPage />);
    await userEvent.setup().type(screen.getByRole('searchbox',{name:'Search'}),'girl rules{Enter}');
    expect(replaceMock).toHaveBeenCalledWith('/en/search?ended=true&q=girl+rules',{scroll:false});
  });
  it('shows a real empty result and applies genre filters before pagination',async()=>{
    searchParams=new URLSearchParams('q=girl&page=3');render(<SearchPage />);
    expect(screen.getByRole('searchbox',{name:'Search'})).toHaveValue('girl');
    expect(screen.getByText('0 results')).toBeDefined();
    expect(screen.getByText('No results found')).toBeDefined();
    const genres=within(screen.getByRole('group',{name:'Genre'}));
    await userEvent.setup().click(genres.getByRole('button',{name:'Concert'}));
    expect(replaceMock).toHaveBeenCalledWith('/en/search?q=girl&genre=concert',{scroll:false});
  });

  it('clears an empty search with default filters and focuses the new input', async () => {
    searchParams = new URLSearchParams('q=missing&status=all&ended=true');
    const view = render(<SearchPage />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Clear search' }));
    const target = new URL(replaceMock.mock.lastCall![0], 'http://localhost');
    expect(target.pathname).toBe('/en/search');
    expect(target.searchParams.has('q')).toBe(false);
    searchParams = target.searchParams;
    view.rerender(<SearchPage />);
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.getByRole('searchbox')).toHaveFocus();
  });

  it('resets an active filter without removing the search term', async () => {
    searchParams = new URLSearchParams('q=missing&genre=concert');
    render(<SearchPage />);
    const emptyState = screen.getByText('No results found').closest('[role="status"]') as HTMLElement;
    await userEvent.setup().click(within(emptyState).getByRole('button', { name: 'Reset' }));
    expect(replaceMock).toHaveBeenCalledWith('/en/search?q=missing', { scroll: false });
  });
});
