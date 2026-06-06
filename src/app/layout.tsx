import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Perspective NLP Dashboard',
  description: 'A multi-perspective NLP stance dashboard powered by Ollama and Supabase.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
