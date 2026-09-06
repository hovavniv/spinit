import type { Metadata } from 'next';
import { Archivo, DM_Sans } from 'next/font/google';
import './globals.css';

// The artboards load Archivo and DM Sans from Google Fonts with a <link>.
// next/font downloads the same two families at build time and serves them from
// our own origin, so the browser makes no request to fonts.googleapis.com.
//
// DM Sans loads 600 even though the canvas's own <link> omits it: the canvas
// markup sets font-weight:600 on nearly every label and button, which without
// the real weight renders as a synthesised fake-bold of 400 or a jump to 700.
const archivo = Archivo({
  variable: '--font-display',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  display: 'swap',
});

const dmSans = DM_Sans({
  variable: '--font-body',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
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
      <body className={`${archivo.variable} ${dmSans.variable}`}>{children}</body>
    </html>
  );
}
