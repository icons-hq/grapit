import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { pretendard } from './fonts';
import { Toaster } from '@/components/ui/sonner';
import { AuthInitializer } from '@/components/auth/auth-initializer';
import { NetworkBanner } from '@/components/layout/network-banner';
import { Providers } from './providers';
import { LayoutShell } from './layout-shell';
import './globals.css';

export const metadata: Metadata = {
  title: 'Grabit - 공연 티켓 예매',
  description: '공연, 전시, 스포츠 등 라이브 엔터테인먼트 티켓 예매 플랫폼',
  other: {
    google: 'notranslate',
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} translate="no" className={`${pretendard.variable} notranslate`}>
      <body className="flex min-h-screen flex-col">
        <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Seoul">
          <Providers>
            <AuthInitializer />
            <NetworkBanner />
            <LayoutShell>{children}</LayoutShell>
            <Toaster />
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
