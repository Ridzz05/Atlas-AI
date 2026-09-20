#!/usr/bin/env node

/**
 * ATLAS AI OS — Second Brain Vault Synchronizer
 * Scans the local Obsidian vault/ directory and syncs all markdown notes
 * into the running ATLAS agent-service (or validates locally if offline).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const vaultDir = path.join(rootDir, 'vault');

console.log('🧠 ATLAS AI OS — Second Brain Synchronizer');
console.log(`📂 Vault Path: ${vaultDir}\n`);

if (!fs.existsSync(vaultDir)) {
  console.error(`❌ Vault directory does not exist at: ${vaultDir}`);
  process.exit(1);
}

// Read .env if available
const envPath = path.join(rootDir, '.env');
const envVars = {};
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const key = trimmed.substring(0, idx).trim();
      const val = trimmed
        .substring(idx + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
      envVars[key] = val;
    }
  }
}

const apiPort = envVars.PORT || '4000';
const apiUrl = `http://127.0.0.1:${apiPort}/api/v1/brain/ingest`;
const authToken = envVars.API_AUTH_TOKEN || '';

async function syncViaApi() {
  console.log(`🌐 Pinging ATLAS Agent Service at http://127.0.0.1:${apiPort}...`);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const res = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        vaultPath: vaultDir,
        scope: 'second_brain'
      })
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API returned HTTP ${res.status}: ${text}`);
    }

    const data = await res.json();
    console.log('✅ Ingestion completed via ATLAS Agent Service:');
    console.log(`   - Total Files Found: ${data.totalFiles ?? 0}`);
    console.log(`   - Files Ingested:    ${data.ingested ?? 0}`);
    console.log(`   - Files Skipped:     ${data.skipped ?? 0}`);
    if (data.errors && data.errors.length > 0) {
      console.warn(`   - Warnings/Errors:   ${data.errors.length}`);
      for (const err of data.errors) {
        console.warn(`     * [${err.filePath}]: ${err.error}`);
      }
    }
    return true;
  } catch (err) {
    console.log(`⚠️  Agent Service not available (${err.message}). Performing local validation check...\n`);
    return false;
  }
}

function scanVaultLocal(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.obsidian' || entry.name === '.trash') {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...scanVaultLocal(full));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const content = fs.readFileSync(full, 'utf8');
      const titleMatch = content.match(/^title:\s*["']?([^"'\r\n]+)["']?/m) || content.match(/^#\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1].trim() : entry.name;
      results.push({
        relPath: path.relative(vaultDir, full),
        title,
        size: fs.statSync(full).size
      });
    }
  }
  return results;
}

async function main() {
  const synced = await syncViaApi();
  if (!synced) {
    const localFiles = scanVaultLocal(vaultDir);
    console.log(`📋 Found ${localFiles.length} Markdown Notes in Vault:`);
    for (const f of localFiles) {
      console.log(`   • ${f.title} (${f.relPath}) [${f.size} bytes]`);
    }
    console.log(`\n💡 Tip: Start the services with 'npm run dev', then re-run this script to ingest into pgvector.`);
  }
}

main().catch(err => {
  console.error('Fatal sync error:', err);
  process.exit(1);
});
