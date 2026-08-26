import './globals.css';
import React from 'react';
import { Sidebar } from '../components/sidebar';

export const metadata = {
  title: 'ATLAS AI OS — Command Center',
  description: 'Multi-agent orchestration control plane'
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-[#090d16] text-gray-100 min-h-screen flex">
        <Sidebar />
        <main className="flex-1 flex flex-col min-w-0 overflow-y-auto h-screen">
          <header className="h-14 border-b border-gray-800 bg-[#0d1321]/80 backdrop-blur px-6 flex items-center justify-between sticky top-0 z-10 shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Control plane:</span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                API-backed
              </span>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <span className="text-gray-500 font-mono">Budget and cost are shown when supplied by the API.</span>
            </div>
          </header>
          <div className="p-8 flex-1">
            {children}
          </div>
        </main>
      </body>
    </html>
  );
}
