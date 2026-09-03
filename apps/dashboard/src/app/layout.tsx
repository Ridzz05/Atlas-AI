import './globals.css';
import React from 'react';
import { Sidebar } from '../components/sidebar';
import ThemeRegistry from '../theme/ThemeRegistry';

export const metadata = {
  title: 'ATLAS AI OS — Command Center',
  description: 'Multi-agent orchestration control plane'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Valley+Sans:ital,wght@0,100..900;1,100..900&display=swap" rel="stylesheet" />
      </head>
      <body className="bg-[#fbf8f2] text-[#201515] min-h-screen flex antialiased">
        <ThemeRegistry>
          <div className="flex w-full min-h-screen bg-[#fbf8f2]">
            <Sidebar />
            <main className="flex-1 flex flex-col min-w-0 overflow-y-auto h-screen bg-[#fbf8f2]">
              <header className="h-14 border-b border-[rgba(32,21,21,0.08)] bg-[#fbf8f2]/90 backdrop-blur px-6 flex items-center justify-between sticky top-0 z-10 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#666155] font-medium">Control plane:</span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#ff4f00]/10 text-[#ff4f00] border border-[#ff4f00]/20">
                    API-backed
                  </span>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <span className="text-[#8c827a] font-mono">Budget and cost are shown when supplied by the API.</span>
                </div>
              </header>
              <div className="p-8 flex-1 bg-[#fbf8f2]">{children}</div>
            </main>
          </div>
        </ThemeRegistry>
      </body>
    </html>
  );
}
