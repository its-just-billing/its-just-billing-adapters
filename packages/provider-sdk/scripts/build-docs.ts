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
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import type { z } from 'zod';

import * as BillingDocumentsSchemas from '../src/schemas/billing-documents/index.js';
import * as CheckoutSchemas from '../src/schemas/checkout/index.js';
import * as CustomersSchemas from '../src/schemas/customers/index.js';
import * as DiscountsSchemas from '../src/schemas/discounts/index.js';
import * as EventsSchemas from '../src/schemas/events/index.js';
import * as PaymentMethodsSchemas from '../src/schemas/payment-methods/index.js';
import * as PaymentsSchemas from '../src/schemas/payments/index.js';
import * as PortalSchemas from '../src/schemas/portal/index.js';
import * as PricesSchemas from '../src/schemas/prices/index.js';
import * as ProductsSchemas from '../src/schemas/products/index.js';
import * as SubscriptionsSchemas from '../src/schemas/subscriptions/index.js';
import * as WebhooksSchemas from '../src/schemas/webhooks/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const docsRoot = resolve(repoRoot, 'docs');

/**
 * A capability that changes this operation's behavior. When multiple
 * capabilities affect one operation the rows form a matrix the reader scans
 * to see how the operation behaves under their provider's flags.
 */
type CapabilityEffect = {
  /** Capability name as exposed on `BillingProvider.capabilities`. */
  name: string;
  /** Behavior when the capability is present/true. */
  whenTrue: string;
  /** Behavior when the capability is absent/false. */
  whenFalse: string;
};

type Op = {
  domain: string;
  method: string;
  input: z.ZodTypeAny;
  output: z.ZodTypeAny;
  /** Capabilities whose value changes this operation's behavior. */
  capabilities?: CapabilityEffect[];
};

const CAPABILITY_MATRIX_MARKER = '<!-- AUTO-GENERATED CAPABILITY MATRIX -->';

const OPERATIONS: Op[] = [
  // customers
  {
    domain: 'customers',
    method: 'list',
    input: CustomersSchemas.CustomersListInputSchema,
    output: CustomersSchemas.CustomersListOutputSchema,
  },
  {
    domain: 'customers',
    method: 'get',
    input: CustomersSchemas.CustomersGetInputSchema,
    output: CustomersSchemas.CustomersGetOutputSchema,
  },
  {
    domain: 'customers',
    method: 'create',
    input: CustomersSchemas.CustomersCreateInputSchema,
    output: CustomersSchemas.CustomersCreateOutputSchema,
  },
  {
    domain: 'customers',
    method: 'update',
    input: CustomersSchemas.CustomersUpdateInputSchema,
    output: CustomersSchemas.CustomersUpdateOutputSchema,
  },
  {
    domain: 'customers',
    method: 'archive',
    input: CustomersSchemas.CustomersArchiveInputSchema,
    output: CustomersSchemas.CustomersArchiveOutputSchema,
  },
  // products
  {
    domain: 'products',
    method: 'list',
    input: ProductsSchemas.ProductsListInputSchema,
    output: ProductsSchemas.ProductsListOutputSchema,
  },
  {
    domain: 'products',
    method: 'get',
    input: ProductsSchemas.ProductsGetInputSchema,
    output: ProductsSchemas.ProductsGetOutputSchema,
  },
  {
    domain: 'products',
    method: 'create',
    input: ProductsSchemas.ProductsCreateInputSchema,
    output: ProductsSchemas.ProductsCreateOutputSchema,
    capabilities: [
      {
        name: 'features.productLevelRecurrence',
        whenTrue: '`recurrence` block accepted and stored on the product.',
        whenFalse:
          '`recurrence` rejected with `ProviderNotSupportedError` (422, `not_supported`, feature `product.recurrence`). Recurrence lives on the price instead.',
      },
    ],
  },
  {
    domain: 'products',
    method: 'update',
    input: ProductsSchemas.ProductsUpdateInputSchema,
    output: ProductsSchemas.ProductsUpdateOutputSchema,
  },
  {
    domain: 'products',
    method: 'deactivate',
    input: ProductsSchemas.ProductsDeactivateInputSchema,
    output: ProductsSchemas.ProductsDeactivateOutputSchema,
  },
  {
    domain: 'products',
    method: 'activate',
    input: ProductsSchemas.ProductsActivateInputSchema,
    output: ProductsSchemas.ProductsActivateOutputSchema,
  },
  // prices
  {
    domain: 'prices',
    method: 'list',
    input: PricesSchemas.PricesListInputSchema,
    output: PricesSchemas.PricesListOutputSchema,
  },
  {
    domain: 'prices',
    method: 'get',
    input: PricesSchemas.PricesGetInputSchema,
    output: PricesSchemas.PricesGetOutputSchema,
  },
  {
    domain: 'prices',
    method: 'create',
    input: PricesSchemas.PricesCreateInputSchema,
    output: PricesSchemas.PricesCreateOutputSchema,
    capabilities: [
      {
        name: 'features.priceQuantityConstraints',
        whenTrue: '`quantity` constraint is enforced by the provider at checkout.',
        whenFalse:
          '`quantity` is still persisted on the price and round-trips, but the adapter does not enforce it at checkout — the consumer enforces it from its own persistence.',
      },
      {
        name: 'features.priceLevelRecurrence',
        whenTrue: 'Recurring price `kind` accepted; recurrence lives on the price.',
        whenFalse:
          'Recurring price `kind` rejected; recurrence lives on the product (`products.create` `recurrence`).',
      },
    ],
  },
  {
    domain: 'prices',
    method: 'update',
    input: PricesSchemas.PricesUpdateInputSchema,
    output: PricesSchemas.PricesUpdateOutputSchema,
    capabilities: [
      {
        name: 'features.priceQuantityConstraints',
        whenTrue: '`quantity` constraint is enforced by the provider at checkout.',
        whenFalse:
          '`quantity` is still persisted and round-trips, but is not enforced at checkout by the adapter.',
      },
    ],
  },
  {
    domain: 'prices',
    method: 'deactivate',
    input: PricesSchemas.PricesDeactivateInputSchema,
    output: PricesSchemas.PricesDeactivateOutputSchema,
  },
  {
    domain: 'prices',
    method: 'activate',
    input: PricesSchemas.PricesActivateInputSchema,
    output: PricesSchemas.PricesActivateOutputSchema,
  },
  // subscriptions
  {
    domain: 'subscriptions',
    method: 'list',
    input: SubscriptionsSchemas.SubscriptionsListInputSchema,
    output: SubscriptionsSchemas.SubscriptionsListOutputSchema,
  },
  {
    domain: 'subscriptions',
    method: 'get',
    input: SubscriptionsSchemas.SubscriptionsGetInputSchema,
    output: SubscriptionsSchemas.SubscriptionsGetOutputSchema,
  },
  {
    domain: 'subscriptions',
    method: 'cancel',
    input: SubscriptionsSchemas.SubscriptionsCancelInputSchema,
    output: SubscriptionsSchemas.SubscriptionsCancelOutputSchema,
  },
  {
    domain: 'subscriptions',
    method: 'change',
    input: SubscriptionsSchemas.SubscriptionsChangeInputSchema,
    output: SubscriptionsSchemas.SubscriptionsChangeOutputSchema,
    capabilities: [
      {
        name: 'features.priceQuantityConstraints',
        whenTrue: 'Item `quantity` is enforced against the price quantity constraint.',
        whenFalse:
          'Item `quantity` is not enforced against the price constraint — consumer-owned (the price is still validated for existence and recurring kind).',
      },
    ],
  },
  {
    domain: 'subscriptions',
    method: 'cancelScheduledChange',
    input: SubscriptionsSchemas.SubscriptionsCancelScheduledChangeInputSchema,
    output: SubscriptionsSchemas.SubscriptionsCancelScheduledChangeOutputSchema,
  },
  // checkout
  {
    domain: 'checkout',
    method: 'createSession',
    input: CheckoutSchemas.CheckoutCreateSessionInputSchema,
    output: CheckoutSchemas.CheckoutCreateSessionOutputSchema,
    capabilities: [
      {
        name: 'trialUnits',
        whenTrue: '`trial.unit` in the set is translated and passed to the provider.',
        whenFalse:
          '`trial.unit` outside the set is rejected with `ProviderNotSupportedError` (422, feature `trial.unit`).',
      },
    ],
  },
  {
    domain: 'checkout',
    method: 'getSession',
    input: CheckoutSchemas.CheckoutGetSessionInputSchema,
    output: CheckoutSchemas.CheckoutGetSessionOutputSchema,
  },
  // payments
  {
    domain: 'payments',
    method: 'list',
    input: PaymentsSchemas.PaymentsListInputSchema,
    output: PaymentsSchemas.PaymentsListOutputSchema,
  },
  {
    domain: 'payments',
    method: 'get',
    input: PaymentsSchemas.PaymentsGetInputSchema,
    output: PaymentsSchemas.PaymentsGetOutputSchema,
  },
  // discounts
  {
    domain: 'discounts',
    method: 'list',
    input: DiscountsSchemas.DiscountsListInputSchema,
    output: DiscountsSchemas.DiscountsListOutputSchema,
  },
  {
    domain: 'discounts',
    method: 'get',
    input: DiscountsSchemas.DiscountsGetInputSchema,
    output: DiscountsSchemas.DiscountsGetOutputSchema,
  },
  {
    domain: 'discounts',
    method: 'create',
    input: DiscountsSchemas.DiscountsCreateInputSchema,
    output: DiscountsSchemas.DiscountsCreateOutputSchema,
  },
  {
    domain: 'discounts',
    method: 'update',
    input: DiscountsSchemas.DiscountsUpdateInputSchema,
    output: DiscountsSchemas.DiscountsUpdateOutputSchema,
  },
  {
    domain: 'discounts',
    method: 'deactivate',
    input: DiscountsSchemas.DiscountsDeactivateInputSchema,
    output: DiscountsSchemas.DiscountsDeactivateOutputSchema,
  },
  {
    domain: 'discounts',
    method: 'activate',
    input: DiscountsSchemas.DiscountsActivateInputSchema,
    output: DiscountsSchemas.DiscountsActivateOutputSchema,
  },
  // events
  {
    domain: 'events',
    method: 'list',
    input: EventsSchemas.EventsListInputSchema,
    output: EventsSchemas.EventsListOutputSchema,
  },
  {
    domain: 'events',
    method: 'get',
    input: EventsSchemas.EventsGetInputSchema,
    output: EventsSchemas.EventsGetOutputSchema,
  },
  // webhooks
  {
    domain: 'webhooks',
    method: 'listEndpoints',
    input: WebhooksSchemas.WebhooksListEndpointsInputSchema,
    output: WebhooksSchemas.WebhooksListEndpointsOutputSchema,
  },
  {
    domain: 'webhooks',
    method: 'createEndpoint',
    input: WebhooksSchemas.WebhooksCreateEndpointInputSchema,
    output: WebhooksSchemas.WebhooksCreateEndpointOutputSchema,
  },
  {
    domain: 'webhooks',
    method: 'updateEndpoint',
    input: WebhooksSchemas.WebhooksUpdateEndpointInputSchema,
    output: WebhooksSchemas.WebhooksUpdateEndpointOutputSchema,
  },
  {
    domain: 'webhooks',
    method: 'activateEndpoint',
    input: WebhooksSchemas.WebhooksActivateEndpointInputSchema,
    output: WebhooksSchemas.WebhooksActivateEndpointOutputSchema,
  },
  {
    domain: 'webhooks',
    method: 'deactivateEndpoint',
    input: WebhooksSchemas.WebhooksDeactivateEndpointInputSchema,
    output: WebhooksSchemas.WebhooksDeactivateEndpointOutputSchema,
  },
  {
    domain: 'webhooks',
    method: 'deleteEndpoint',
    input: WebhooksSchemas.WebhooksDeleteEndpointInputSchema,
    output: WebhooksSchemas.WebhooksDeleteEndpointOutputSchema,
  },
  {
    domain: 'webhooks',
    method: 'verify',
    input: WebhooksSchemas.WebhooksVerifyInputSchema,
    output: WebhooksSchemas.WebhooksVerifyOutputSchema,
  },
  // portal (optional)
  {
    domain: 'portal',
    method: 'createSession',
    input: PortalSchemas.PortalCreateSessionInputSchema,
    output: PortalSchemas.PortalCreateSessionOutputSchema,
  },
  // billingDocuments (optional)
  {
    domain: 'billing-documents',
    method: 'list',
    input: BillingDocumentsSchemas.BillingDocumentsListInputSchema,
    output: BillingDocumentsSchemas.BillingDocumentsListOutputSchema,
  },
  {
    domain: 'billing-documents',
    method: 'get',
    input: BillingDocumentsSchemas.BillingDocumentsGetInputSchema,
    output: BillingDocumentsSchemas.BillingDocumentsGetOutputSchema,
  },
  // paymentMethods (optional)
  {
    domain: 'payment-methods',
    method: 'list',
    input: PaymentMethodsSchemas.PaymentMethodsListInputSchema,
    output: PaymentMethodsSchemas.PaymentMethodsListOutputSchema,
  },
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

const CAPABILITY_MATRIX_HEADING = '## Capability Matrix';

/**
 * Render the capability matrix for an operation. Single source of truth: the
 * `capabilities` declared on the `Op`. Empty string when the op has none.
 */
function renderCapabilityMatrix(op: Op): string {
  if (!op.capabilities || op.capabilities.length === 0) return '';
  const rows = op.capabilities
    .map((c) => `| \`${c.name}\` | ${c.whenTrue} | ${c.whenFalse} |`)
    .join('\n');
  return `
${CAPABILITY_MATRIX_HEADING}

${CAPABILITY_MATRIX_MARKER}

Behavior of \`${op.domain}.${op.method}\` by provider capability — pre-flight via \`provider.capabilities\`. When several capabilities affect this operation the rows together form the matrix to read for your provider's flags.

| Capability | true / present | false / absent |
| --- | --- | --- |
${rows}
`;
}

async function ensureReferenceStub(op: Op) {
  const { domain, method } = op;
  const path = resolve(docsRoot, 'reference', domain, `${method}.md`);
  if (await fileExists(path)) {
    const existing = await readFile(path, 'utf8');
    if (!existing.includes(REFERENCE_STUB_BANNER)) return; // handwritten, leave alone
  }
  await mkdir(dirname(path), { recursive: true });
  const operationId = `${domain}.${method}`;
  const matrixSection = renderCapabilityMatrix(op);
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
${matrixSection}
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

/**
 * Every operation that declares capabilities must surface a Capability Matrix
 * section on its reference page. The generator emits it into stubs; a
 * handwritten page must keep the `## Capability Matrix` heading or behavior
 * drifts from the contract silently. Returns the operation ids that are
 * missing it.
 */
export async function checkCapabilityMatrixDrift(): Promise<string[]> {
  const offenders: string[] = [];
  for (const op of OPERATIONS) {
    if (!op.capabilities || op.capabilities.length === 0) continue;
    const id = `${op.domain}.${op.method}`;
    const path = resolve(docsRoot, 'reference', op.domain, `${op.method}.md`);
    if (!(await fileExists(path))) {
      offenders.push(id);
      continue;
    }
    const existing = await readFile(path, 'utf8');
    if (!existing.includes(CAPABILITY_MATRIX_HEADING)) offenders.push(id);
  }
  return offenders;
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
    for (const op of ops) await ensureReferenceStub(op);
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

  const matrixOffenders = await checkCapabilityMatrixDrift();
  if (matrixOffenders.length > 0) {
    console.error(
      `✗ Capability matrix drift: operations declare capabilities but their reference page lacks a "${CAPABILITY_MATRIX_HEADING}" section:`,
    );
    for (const id of matrixOffenders) console.error(`  - ${id}`);
    process.exit(1);
  }
  console.log('✓ All capability-affected operations document a Capability Matrix.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
