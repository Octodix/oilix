import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { Providers } from '@/components/providers';

// Bundled (SIL OFL, see fonts/OFL-Cairo.txt): the server builds offline, so no Google Fonts fetch.
const cairo = localFont({
  src: [
    { path: './fonts/Cairo_400Regular.ttf', weight: '400', style: 'normal' },
    { path: './fonts/Cairo_500Medium.ttf', weight: '500', style: 'normal' },
    { path: './fonts/Cairo_600SemiBold.ttf', weight: '600', style: 'normal' },
    { path: './fonts/Cairo_700Bold.ttf', weight: '700', style: 'normal' },
    { path: './fonts/Cairo_800ExtraBold.ttf', weight: '800', style: 'normal' },
    { path: './fonts/Cairo_900Black.ttf', weight: '900', style: 'normal' },
  ],
  variable: '--font-cairo',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'أوليكس - إدارة المعصرة',
  description: 'نظام إدارة معصرة الزيتون',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover' as const,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" className={cairo.variable} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var r=document.documentElement;r.classList.remove('dark');var s=localStorage.getItem('oilix-theme');if(!s)return;var m=JSON.parse(s).state?.mode;if(m==='dark')r.classList.add('dark');}catch(e){document.documentElement.classList.remove('dark');}})();`,
          }}
        />
      </head>
      <body className="min-h-screen text-[var(--app-text)] antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
