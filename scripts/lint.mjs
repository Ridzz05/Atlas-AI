import { readFileSync, readdirSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';

const sourceExtensions = new Set(['.js', '.mjs', '.ts', '.tsx']);
const ignoredDirectories = new Set(['.next', 'coverage', 'dist', 'node_modules']);
const sourceRoots = ['apps', 'packages', 'scripts'];
const repositoryRoot = process.cwd();
const debuggerPattern = new RegExp(`\\b${['debug', 'ger'].join('')}\\b`);
const consoleLogToken = ['console', '.log'].join('');
const consoleLogPattern = new RegExp(`${consoleLogToken.replace('.', '\\.')}\\s*\\(`);

function collectSourceFiles(directory) {
  const files = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) {
      files.push(...collectSourceFiles(resolve(directory, entry.name)));
    } else if (entry.isFile() && sourceExtensions.has(extname(entry.name))) {
      files.push(resolve(directory, entry.name));
    }
  }

  return files;
}

const sourceFiles = sourceRoots.flatMap(root => collectSourceFiles(resolve(repositoryRoot, root)));

const violations = [];

for (const absoluteFile of sourceFiles) {
  const file = relative(repositoryRoot, absoluteFile).replaceAll('\\', '/');
  const lines = readFileSync(absoluteFile, 'utf8').split(/\r?\n/);
  const checkSemanticRules = file !== 'scripts/lint.mjs';

  lines.forEach((line, index) => {
    if (/[ \t]+$/.test(line)) {
      violations.push(`${file}:${index + 1}: trailing whitespace`);
    }
    if (checkSemanticRules && debuggerPattern.test(line)) {
      violations.push(`${file}:${index + 1}: debugger statement`);
    }
    if (checkSemanticRules && file !== 'packages/observability/src/logger.ts' && consoleLogPattern.test(line)) {
      violations.push(`${file}:${index + 1}: use structured logger instead of console logging`);
    }
  });
}

if (violations.length > 0) {
  console.error(`Source lint failed with ${violations.length} violation(s):`);
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Source lint passed (${sourceFiles.length} files checked).`);
}
