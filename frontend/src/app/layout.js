import { Inter, Cormorant_Garamond } from 'next/font/google';
import './globals.css';
import Sidebar from '@/components/Sidebar';

const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-inter',
});

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-serif',
});

export const metadata = {
  title: 'AI Runtime Monitor — Autonomous Performance Diagnosis',
  description:
    'AI-powered runtime monitoring agent that continuously analyzes application performance, detects anomalies, and provides autonomous root-cause diagnosis with code-level fix suggestions.',
  keywords: 'runtime monitoring, AI diagnosis, performance analysis, anomaly detection, eBPF profiling',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${inter.variable} ${cormorant.variable}`}>
      <body>
        <Sidebar />
        <main className="main-content">{children}</main>
      </body>
    </html>
  );
}
