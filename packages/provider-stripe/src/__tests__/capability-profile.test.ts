import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProfileFragment, serializeFragment } from '@its-just-billing/provider-sdk';
import { describe, expect, it } from 'vitest';
import { STRIPE_CAPABILITIES } from '../capabilities.js';

// Anti-drift guard: the committed docs/openapi/profiles/stripe.json must
// always equal what `profile:emit` would produce from the live
// STRIPE_CAPABILITIES. If a capability changes, `pnpm --filter
// @its-just-billing/provider-stripe profile:emit` must be re-run and the
// fragment committed — this test fails until then.
describe('capability profile fragment', () => {
  it('committed docs/openapi/profiles/stripe.json matches live STRIPE_CAPABILITIES', () => {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const fragmentPath = resolve(__dirname, '../../../../docs/openapi/profiles/stripe.json');
    const expected = serializeFragment(buildProfileFragment('stripe', STRIPE_CAPABILITIES));
    const committed = readFileSync(fragmentPath, 'utf8');
    expect(committed).toBe(expected);
  });
});
