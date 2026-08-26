'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, CheckSquare, MessageSquare, Users, Brain, ShieldCheck, FileText, Activity, Settings, AlertTriangle } from 'lucide-react';

const NAV_ITEMS = [
  { name: 'Command Center', href: '/', icon: LayoutDashboard },
  { name: 'Tasks', href: '/tasks', icon: CheckSquare },
  { name: 'Communications', href: '/communications', icon: MessageSquare },
  { name: 'Agent Team', href: '/agents', icon: Users },
  { name: 'Shared Brain', href: '/brain', icon: Brain },
  { name: 'Approvals', href: '/approvals', icon: ShieldCheck },
  { name: 'Artifacts', href: '/artifacts', icon: FileText },
  { name: 'Audit & Telemetry', href: '/audit', icon: Activity },
  { name: 'Settings', href: '/settings', icon: Settings }
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 border-r border-gray-800 bg-[#0d1321] flex flex-col justify-between shrink-0 h-screen sticky top-0">
      <div>
        <div className="p-5 border-b border-gray-800 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/30">A</div>
          <div><h1 className="font-semibold tracking-wider text-sm text-white">ATLAS AI OS</h1><p className="text-[10px] text-gray-400 font-mono tracking-wider">v0.1.0 · CONTROL PLANE</p></div>
        </div>
        <nav className="p-3 space-y-1" aria-label="Primary navigation">
          {NAV_ITEMS.map(item => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return <Link key={item.href} href={item.href} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors ${isActive ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 shadow-sm' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'}`}><Icon className="w-4 h-4 shrink-0" /><span>{item.name}</span></Link>;
          })}
        </nav>
      </div>
      <div className="p-4 border-t border-gray-800">
        <div className="w-full flex items-start gap-2 px-3 py-2 rounded-lg bg-rose-600/10 text-rose-300 border border-rose-500/20 text-[11px]">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>Emergency stop is controlled through Telegram until a durable API action is available.</span>
        </div>
      </div>
    </aside>
  );
}
