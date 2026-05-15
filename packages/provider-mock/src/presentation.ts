/**
 * Mock-provider checkout presentation. Callers receive a fake hosted-checkout
 * URL on session creation; the URL is intentionally non-routable so tests can
 * detect attempts to follow it.
 */
export interface MockCheckoutPresentation {
  kind: 'mock_hosted';
  url: string;
}
