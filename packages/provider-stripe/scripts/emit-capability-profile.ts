/**
 * Emit this adapter's capability profile fragment from its REAL
 * `STRIPE_CAPABILITIES` — the single source of truth. `provider-sdk`'s
 * `build-docs` must never import an adapter, so each provider publishes its
 * own fragment here; the SDK only reads/validates/merges them into
 * `docs/openapi/capability-profiles.json`.
 *
 * The committed fragment is kept honest by `capability-profile.test.ts`,
 * which recomputes this in-memory and asserts equality.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProfileFragment, serializeFragment } from '@its-just-billing/provider-sdk';
import { STRIPE_CAPABILITIES } from '../src/capabilities.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const outPath = resolve(repoRoot, 'docs/openapi/profiles/stripe.json');

async function main() {
  const fragment = buildProfileFragment('stripe', STRIPE_CAPABILITIES);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, serializeFragment(fragment), 'utf8');
  console.log(`✓ wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
