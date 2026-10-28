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
    expect(screen.getByText('No shows here yet')).toBeDefined();
    const genres=within(screen.getByRole('group',{name:'Genre'}));
    await userEvent.setup().click(genres.getByRole('button',{name:'Concert'}));
    expect(replaceMock).toHaveBeenCalledWith('/en/search?q=girl&genre=concert',{scroll:false});
  });
});
