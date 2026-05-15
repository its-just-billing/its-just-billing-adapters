/**
 * Fail if any file under src/conformance/ imports a provider implementation
 * package. Conformance tests must only depend on the public SDK contract.
 *
 * Wired into the test-process.md runbook step 3; run before merging changes
 * to the conformance suite.
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..', 'src', 'conformance');

const FORBIDDEN = [
  '@its-just-billing/provider-mock',
  '@its-just-billing/provider-stripe',
  '@its-just-billing/provider-paddle',
];

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(path);
    } else if (entry.isFile() && /\.(ts|tsx|js|mjs)$/.test(entry.name)) {
      yield path;
    }
  }
}

async function main() {
  const violations: { file: string; line: number; text: string; bad: string }[] = [];
  for await (const file of walk(root)) {
    const content = await readFile(file, 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;
      for (const bad of FORBIDDEN) {
        if (line.includes(bad)) {
          violations.push({ file, line: i + 1, text: line.trim(), bad });
        }
      }
    }
  }

  if (violations.length === 0) {
    console.log('✓ Conformance suite is implementation-pure.');
    return;
  }

  console.error(`✗ ${violations.length} forbidden import(s) under src/conformance/:`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  →  ${v.bad}`);
    console.error(`    ${v.text}`);
  }
  console.error('\nConformance tests must only import from @its-just-billing/provider-sdk.');
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
