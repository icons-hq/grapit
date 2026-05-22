'use client';

import { usePathname } from 'next/navigation';
import { GNB } from '@/components/layout/gnb';
import { Footer } from '@/components/layout/footer';
import { MobileTabBar } from '@/components/layout/mobile-tab-bar';
import { LocaleSuggestion } from '@/components/i18n/locale-suggestion';

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAdmin = pathname.startsWith('/admin');
  // Hide GNB/Footer on booking seat selection and confirm pages, but show on complete page
  const isBookingCheckout =
    pathname.startsWith('/booking') && !pathname.endsWith('/complete');
  const isFieldCheckIn = pathname.startsWith('/field/check-in');
  const hideShell = isAdmin || isBookingCheckout || isFieldCheckIn;

  return (
    <>
      {!hideShell && <LocaleSuggestion />}
      {!hideShell && <GNB />}
      <div
        className={`flex flex-1 flex-col${!hideShell ? ' pb-[calc(56px+env(safe-area-inset-bottom,0px))] md:pb-0' : ''}`}
      >
        {children}
      </div>
      {!hideShell && (
        <div className="hidden md:block">
          <Footer />
        </div>
      )}
      {!hideShell && <MobileTabBar />}
    </>
  );
}
