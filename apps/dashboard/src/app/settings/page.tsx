'use client';

import React, { useState } from 'react';
import { Settings, Save, ShieldCheck } from 'lucide-react';

export default function SettingsPage() {
  const [dailyBudget, setDailyBudget] = useState('5.00');
  const [maxConcurrency, setMaxConcurrency] = useState('3');
  const [maxTurns, setMaxTurns] = useState('15');
  const [requireApproval, setRequireApproval] = useState(true);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    alert('System settings updated successfully.');
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-white tracking-tight">System Settings & Governance</h1>
        <p className="text-xs text-gray-400">Manage cost ceilings, concurrency limits, and security policy guardrails.</p>
      </div>

      <form onSubmit={handleSave} className="p-6 bg-[#111827] border border-gray-800 rounded-xl space-y-6">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-mono text-gray-400 mb-1">DAILY SPEND BUDGET ($ USD)</label>
            <input
              type="number"
              step="0.5"
              value={dailyBudget}
              onChange={(e) => setDailyBudget(e.target.value)}
              className="w-full bg-[#090d16] border border-gray-700 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-mono text-gray-400 mb-1">MAX CONCURRENT SPECIALISTS</label>
              <input
                type="number"
                value={maxConcurrency}
                onChange={(e) => setMaxConcurrency(e.target.value)}
                className="w-full bg-[#090d16] border border-gray-700 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-mono text-gray-400 mb-1">MAX CHIEF TURNS PER RUN</label>
              <input
                type="number"
                value={maxTurns}
                onChange={(e) => setMaxTurns(e.target.value)}
                className="w-full bg-[#090d16] border border-gray-700 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="flex items-center justify-between p-4 bg-[#090d16] border border-gray-800 rounded-lg">
            <div>
              <p className="text-xs font-semibold text-white">Require Human Approval For Outbound Messages</p>
              <p className="text-[11px] text-gray-400">Strictly blocks all external writes unless signed with cryptographic approval token.</p>
            </div>
            <input
              type="checkbox"
              checked={requireApproval}
              onChange={(e) => setRequireApproval(e.target.checked)}
              className="w-4 h-4 rounded text-indigo-600 bg-gray-800 border-gray-700"
            />
          </div>
        </div>

        <div className="flex justify-end pt-4 border-t border-gray-800">
          <button
            type="submit"
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium flex items-center gap-2 transition-all shadow-md shadow-indigo-600/30"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save Configuration</span>
          </button>
        </div>
      </form>
    </div>
  );
}
