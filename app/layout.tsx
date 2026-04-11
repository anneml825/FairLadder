import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FAIRLADDER.AI — Candidate Intelligence Platform',
  description: 'Level the playing field. Get the intelligence companies already have, before you walk in the door.',
  keywords: ['job offer analysis', 'salary intelligence', 'company research', 'career intelligence', 'negotiate salary'],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
