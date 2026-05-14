import type {
  WebhooksActivateEndpointInput,
  WebhooksActivateEndpointOutput,
  WebhooksCreateEndpointInput,
  WebhooksCreateEndpointOutput,
  WebhooksDeactivateEndpointInput,
  WebhooksDeactivateEndpointOutput,
  WebhooksDeleteEndpointInput,
  WebhooksDeleteEndpointOutput,
  WebhooksListEndpointsInput,
  WebhooksListEndpointsOutput,
  WebhooksUpdateEndpointInput,
  WebhooksUpdateEndpointOutput,
  WebhooksVerifyInput,
  WebhooksVerifyOutput,
} from '../schemas/webhooks/index.js';

export interface Webhooks {
  listEndpoints(input?: WebhooksListEndpointsInput): Promise<WebhooksListEndpointsOutput>;
  createEndpoint(input: WebhooksCreateEndpointInput): Promise<WebhooksCreateEndpointOutput>;
  /**
   * Update mutable fields on a webhook endpoint (url, eventTypes, active).
   * Unlike products/prices/discounts, `active` here is a real send/don't-send
   * toggle — flipping it does not delete the endpoint.
   */
  updateEndpoint(input: WebhooksUpdateEndpointInput): Promise<WebhooksUpdateEndpointOutput>;
  /** Convenience: `updateEndpoint({ id, active: true })`. Null when id missing. */
  activateEndpoint(
    input: WebhooksActivateEndpointInput,
  ): Promise<WebhooksActivateEndpointOutput>;
  /** Convenience: `updateEndpoint({ id, active: false })`. Null when id missing. */
  deactivateEndpoint(
    input: WebhooksDeactivateEndpointInput,
  ): Promise<WebhooksDeactivateEndpointOutput>;
  /** Hard delete. Returns `{ deleted: true }` on success. */
  deleteEndpoint(input: WebhooksDeleteEndpointInput): Promise<WebhooksDeleteEndpointOutput>;
  /**
   * Verify a signed payload and parse it into a normalized event. Throws
   * WebhookSignatureError on signature failure.
   */
  verify(input: WebhooksVerifyInput): Promise<WebhooksVerifyOutput>;
}
