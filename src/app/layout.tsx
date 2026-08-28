import type { Metadata } from 'next';
import { Sora, Inter } from 'next/font/google';
import './globals.css';

// The artboards load Sora and Inter from Google Fonts with a <link>. next/font
// downloads the same two families at build time and serves them from our own
// origin, so the browser makes no request to fonts.googleapis.com when the page
// loads. It also generates a fallback font sized to match, so text does not
// shift position when the real font arrives.
const sora = Sora({
  variable: '--font-sora',
  subsets: ['latin'],
  weight: ['400', '600', '700', '800'],
  display: 'swap',
});

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Spinit — the dance floor requests, you decide',
  description:
    'Guests suggest and vote on songs from their phones. Spinit learns the couple’s taste and hands the DJ a ranked queue that explains every pick.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${sora.variable} ${inter.variable}`}>{children}</body>
    </html>
  );
}
