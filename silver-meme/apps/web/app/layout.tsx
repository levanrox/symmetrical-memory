import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Event Suite',
  description: 'Draw, ring operations and scoring for local karate tournaments.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // No maximum-scale: pinching to zoom is how a lot of people read a screen,
  // and suppressing the iOS focus zoom is not a good enough reason to take it.
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
