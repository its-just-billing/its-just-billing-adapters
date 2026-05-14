/**
 * Build OpenAPI-style fragments and reference-page stubs from the Zod schemas.
 *
 * - Walks the registered SDK methods (see `OPERATIONS` below).
 * - Registers each input/output schema in a zod-to-openapi registry.
 * - Emits one JSON file per domain at `docs/openapi/<domain>.json`.
 * - If a handwritten reference page at `docs/reference/<domain>/<method>.md`
 *   exists, it is left alone; otherwise a stub is created so every method has
 *   a doc page.
 *
 * The reference page prose is handwritten. This script only fills in the
 * schema fragments; the prose, errors, and examples stay in the markdown body.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OpenApiGeneratorV31,
  OpenAPIRegistry,
} from '@asteasolutions/zod-to-openapi';
import type { z } from 'zod';

import * as CustomersSchemas from '../src/schemas/customers/index.js';
import * as ProductsSchemas from '../src/schemas/products/index.js';
import * as PricesSchemas from '../src/schemas/prices/index.js';
import * as SubscriptionsSchemas from '../src/schemas/subscriptions/index.js';
import * as CheckoutSchemas from '../src/schemas/checkout/index.js';
import * as PurchasesSchemas from '../src/schemas/purchases/index.js';
import * as DiscountsSchemas from '../src/schemas/discounts/index.js';
import * as EventsSchemas from '../src/schemas/events/index.js';
import * as WebhooksSchemas from '../src/schemas/webhooks/index.js';
import * as PortalSchemas from '../src/schemas/portal/index.js';
import * as BillingDocumentsSchemas from '../src/schemas/billing-documents/index.js';
import * as PaymentMethodsSchemas from '../src/schemas/payment-methods/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const docsRoot = resolve(repoRoot, 'docs');

type Op = {
  domain: string;
  method: string;
  input: z.ZodTypeAny;
  output: z.ZodTypeAny;
};

const OPERATIONS: Op[] = [
  // customers
  { domain: 'customers', method: 'list', input: CustomersSchemas.CustomersListInputSchema, output: CustomersSchemas.CustomersListOutputSchema },
  { domain: 'customers', method: 'get', input: CustomersSchemas.CustomersGetInputSchema, output: CustomersSchemas.CustomersGetOutputSchema },
  { domain: 'customers', method: 'create', input: CustomersSchemas.CustomersCreateInputSchema, output: CustomersSchemas.CustomersCreateOutputSchema },
  { domain: 'customers', method: 'update', input: CustomersSchemas.CustomersUpdateInputSchema, output: CustomersSchemas.CustomersUpdateOutputSchema },
  { domain: 'customers', method: 'archive', input: CustomersSchemas.CustomersArchiveInputSchema, output: CustomersSchemas.CustomersArchiveOutputSchema },
  // products
  { domain: 'products', method: 'list', input: ProductsSchemas.ProductsListInputSchema, output: ProductsSchemas.ProductsListOutputSchema },
  { domain: 'products', method: 'get', input: ProductsSchemas.ProductsGetInputSchema, output: ProductsSchemas.ProductsGetOutputSchema },
  { domain: 'products', method: 'create', input: ProductsSchemas.ProductsCreateInputSchema, output: ProductsSchemas.ProductsCreateOutputSchema },
  { domain: 'products', method: 'update', input: ProductsSchemas.ProductsUpdateInputSchema, output: ProductsSchemas.ProductsUpdateOutputSchema },
  { domain: 'products', method: 'deactivate', input: ProductsSchemas.ProductsDeactivateInputSchema, output: ProductsSchemas.ProductsDeactivateOutputSchema },
  { domain: 'products', method: 'activate', input: ProductsSchemas.ProductsActivateInputSchema, output: ProductsSchemas.ProductsActivateOutputSchema },
  // prices
  { domain: 'prices', method: 'list', input: PricesSchemas.PricesListInputSchema, output: PricesSchemas.PricesListOutputSchema },
  { domain: 'prices', method: 'get', input: PricesSchemas.PricesGetInputSchema, output: PricesSchemas.PricesGetOutputSchema },
  { domain: 'prices', method: 'create', input: PricesSchemas.PricesCreateInputSchema, output: PricesSchemas.PricesCreateOutputSchema },
  { domain: 'prices', method: 'update', input: PricesSchemas.PricesUpdateInputSchema, output: PricesSchemas.PricesUpdateOutputSchema },
  { domain: 'prices', method: 'deactivate', input: PricesSchemas.PricesDeactivateInputSchema, output: PricesSchemas.PricesDeactivateOutputSchema },
  { domain: 'prices', method: 'activate', input: PricesSchemas.PricesActivateInputSchema, output: PricesSchemas.PricesActivateOutputSchema },
  // subscriptions
  { domain: 'subscriptions', method: 'list', input: SubscriptionsSchemas.SubscriptionsListInputSchema, output: SubscriptionsSchemas.SubscriptionsListOutputSchema },
  { domain: 'subscriptions', method: 'get', input: SubscriptionsSchemas.SubscriptionsGetInputSchema, output: SubscriptionsSchemas.SubscriptionsGetOutputSchema },
  { domain: 'subscriptions', method: 'cancel', input: SubscriptionsSchemas.SubscriptionsCancelInputSchema, output: SubscriptionsSchemas.SubscriptionsCancelOutputSchema },
  { domain: 'subscriptions', method: 'change', input: SubscriptionsSchemas.SubscriptionsChangeInputSchema, output: SubscriptionsSchemas.SubscriptionsChangeOutputSchema },
  { domain: 'subscriptions', method: 'cancelScheduledChange', input: SubscriptionsSchemas.SubscriptionsCancelScheduledChangeInputSchema, output: SubscriptionsSchemas.SubscriptionsCancelScheduledChangeOutputSchema },
  // checkout
  { domain: 'checkout', method: 'createSession', input: CheckoutSchemas.CheckoutCreateSessionInputSchema, output: CheckoutSchemas.CheckoutCreateSessionOutputSchema },
  { domain: 'checkout', method: 'getSession', input: CheckoutSchemas.CheckoutGetSessionInputSchema, output: CheckoutSchemas.CheckoutGetSessionOutputSchema },
  // purchases
  { domain: 'purchases', method: 'list', input: PurchasesSchemas.PurchasesListInputSchema, output: PurchasesSchemas.PurchasesListOutputSchema },
  { domain: 'purchases', method: 'get', input: PurchasesSchemas.PurchasesGetInputSchema, output: PurchasesSchemas.PurchasesGetOutputSchema },
  // discounts
  { domain: 'discounts', method: 'list', input: DiscountsSchemas.DiscountsListInputSchema, output: DiscountsSchemas.DiscountsListOutputSchema },
  { domain: 'discounts', method: 'get', input: DiscountsSchemas.DiscountsGetInputSchema, output: DiscountsSchemas.DiscountsGetOutputSchema },
  { domain: 'discounts', method: 'create', input: DiscountsSchemas.DiscountsCreateInputSchema, output: DiscountsSchemas.DiscountsCreateOutputSchema },
  { domain: 'discounts', method: 'update', input: DiscountsSchemas.DiscountsUpdateInputSchema, output: DiscountsSchemas.DiscountsUpdateOutputSchema },
  { domain: 'discounts', method: 'deactivate', input: DiscountsSchemas.DiscountsDeactivateInputSchema, output: DiscountsSchemas.DiscountsDeactivateOutputSchema },
  { domain: 'discounts', method: 'activate', input: DiscountsSchemas.DiscountsActivateInputSchema, output: DiscountsSchemas.DiscountsActivateOutputSchema },
  // events
  { domain: 'events', method: 'list', input: EventsSchemas.EventsListInputSchema, output: EventsSchemas.EventsListOutputSchema },
  { domain: 'events', method: 'get', input: EventsSchemas.EventsGetInputSchema, output: EventsSchemas.EventsGetOutputSchema },
  // webhooks
  { domain: 'webhooks', method: 'listEndpoints', input: WebhooksSchemas.WebhooksListEndpointsInputSchema, output: WebhooksSchemas.WebhooksListEndpointsOutputSchema },
  { domain: 'webhooks', method: 'createEndpoint', input: WebhooksSchemas.WebhooksCreateEndpointInputSchema, output: WebhooksSchemas.WebhooksCreateEndpointOutputSchema },
  { domain: 'webhooks', method: 'updateEndpoint', input: WebhooksSchemas.WebhooksUpdateEndpointInputSchema, output: WebhooksSchemas.WebhooksUpdateEndpointOutputSchema },
  { domain: 'webhooks', method: 'activateEndpoint', input: WebhooksSchemas.WebhooksActivateEndpointInputSchema, output: WebhooksSchemas.WebhooksActivateEndpointOutputSchema },
  { domain: 'webhooks', method: 'deactivateEndpoint', input: WebhooksSchemas.WebhooksDeactivateEndpointInputSchema, output: WebhooksSchemas.WebhooksDeactivateEndpointOutputSchema },
  { domain: 'webhooks', method: 'deleteEndpoint', input: WebhooksSchemas.WebhooksDeleteEndpointInputSchema, output: WebhooksSchemas.WebhooksDeleteEndpointOutputSchema },
  { domain: 'webhooks', method: 'verify', input: WebhooksSchemas.WebhooksVerifyInputSchema, output: WebhooksSchemas.WebhooksVerifyOutputSchema },
  // portal (optional)
  { domain: 'portal', method: 'createSession', input: PortalSchemas.PortalCreateSessionInputSchema, output: PortalSchemas.PortalCreateSessionOutputSchema },
  // billingDocuments (optional)
  { domain: 'billing-documents', method: 'list', input: BillingDocumentsSchemas.BillingDocumentsListInputSchema, output: BillingDocumentsSchemas.BillingDocumentsListOutputSchema },
  { domain: 'billing-documents', method: 'get', input: BillingDocumentsSchemas.BillingDocumentsGetInputSchema, output: BillingDocumentsSchemas.BillingDocumentsGetOutputSchema },
  // paymentMethods (optional)
  { domain: 'payment-methods', method: 'list', input: PaymentMethodsSchemas.PaymentMethodsListInputSchema, output: PaymentMethodsSchemas.PaymentMethodsListOutputSchema },
];

export function getOperations(): readonly Op[] {
  return OPERATIONS;
}

function buildOpenApiDocForDomain(domain: string, ops: Op[]) {
  const registry = new OpenAPIRegistry();
  for (const op of ops) {
    const operationId = `${domain}.${op.method}`;
    registry.registerPath({
      method: 'post',
      path: `/${domain}/${op.method}`,
      operationId,
      summary: operationId,
      tags: [domain],
      request: {
        body: {
          content: {
            'application/json': { schema: op.input },
          },
        },
      },
      responses: {
        200: {
          description: 'Normalized result',
          content: {
            'application/json': { schema: op.output },
          },
        },
        400: { description: 'ProviderValidationError' },
        401: { description: 'ProviderAuthError' },
        404: { description: 'ProviderNotFoundError (only when applicable)' },
        409: { description: 'ProviderConflictError (only when applicable)' },
        422: { description: 'ProviderConstraintError or MetadataCollisionError' },
        429: { description: 'ProviderRateLimitError' },
        502: { description: 'ProviderNormalizationError' },
        503: { description: 'ProviderUnavailableError' },
      },
    });
  }
  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: `Billing Provider SDK — ${domain}`,
      version: '0.0.0',
      description:
        'OpenAPI-style description of the normalized SDK methods in this domain. These are not real HTTP endpoints; the document exists so any OpenAPI viewer can render the request and response schemas.',
    },
  });
}

const REFERENCE_STUB_BANNER =
  '<!-- AUTO-GENERATED STUB. Replace this file with handwritten prose, an example, and an errors list. The generator will not overwrite a file that lacks this comment. -->';

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureReferenceStub(domain: string, method: string) {
  const path = resolve(docsRoot, 'reference', domain, `${method}.md`);
  if (await fileExists(path)) {
    const existing = await readFile(path, 'utf8');
    if (!existing.includes(REFERENCE_STUB_BANNER)) return; // handwritten, leave alone
  }
  await mkdir(dirname(path), { recursive: true });
  const operationId = `${domain}.${method}`;
  const stub = `${REFERENCE_STUB_BANNER}
---
title: ${operationId}
domain: ${domain}
method: ${method}
---

## Description

_TODO: handwrite a 1–2 paragraph description of what \`${operationId}\` does, when callers reach for it, and any gotchas._

## Request

See [\`docs/openapi/${domain}.json\`](../../openapi/${domain}.json) → operation \`${operationId}\` → \`requestBody\`.

## Response

See [\`docs/openapi/${domain}.json\`](../../openapi/${domain}.json) → operation \`${operationId}\` → response \`200\`.

## Errors

_TODO: list the normalized errors this method can throw and when._

## Example

_TODO: handwrite a runnable end-to-end snippet against the SDK._
`;
  await writeFile(path, stub, 'utf8');
}

async function listReferenceMethods(): Promise<Set<string>> {
  const out = new Set<string>();
  const refRoot = resolve(docsRoot, 'reference');
  try {
    const domains = await readdir(refRoot, { withFileTypes: true });
    for (const d of domains) {
      if (!d.isDirectory()) continue;
      const files = await readdir(resolve(refRoot, d.name));
      for (const f of files) {
        if (!f.endsWith('.md')) continue;
        out.add(`${d.name}.${f.replace(/\.md$/, '')}`);
      }
    }
  } catch {
    // missing reference dir — first run
  }
  return out;
}

export async function checkDocDrift(): Promise<{ missing: string[]; extra: string[] }> {
  const declared = new Set(OPERATIONS.map((o) => `${o.domain}.${o.method}`));
  const present = await listReferenceMethods();
  const missing = [...declared].filter((id) => !present.has(id));
  const extra = [...present].filter((id) => !declared.has(id));
  return { missing, extra };
}

async function main() {
  const byDomain = new Map<string, Op[]>();
  for (const op of OPERATIONS) {
    const list = byDomain.get(op.domain) ?? [];
    list.push(op);
    byDomain.set(op.domain, list);
  }

  await mkdir(resolve(docsRoot, 'openapi'), { recursive: true });

  for (const [domain, ops] of byDomain) {
    const doc = buildOpenApiDocForDomain(domain, ops);
    const outPath = resolve(docsRoot, 'openapi', `${domain}.json`);
    await writeFile(outPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
    for (const op of ops) await ensureReferenceStub(domain, op.method);
    console.log(`✓ ${domain} (${ops.length} method${ops.length === 1 ? '' : 's'})`);
  }

  const drift = await checkDocDrift();
  if (drift.extra.length > 0) {
    console.error(`✗ Doc drift: extra reference pages without a registered operation:`);
    for (const id of drift.extra) console.error(`  - ${id}`);
    process.exit(1);
  }
  if (drift.missing.length > 0) {
    console.error(`✗ Doc drift: registered operations without a reference page:`);
    for (const id of drift.missing) console.error(`  - ${id}`);
    process.exit(1);
  }
  console.log('✓ All registered operations have reference pages.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
