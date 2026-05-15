import type {
  PortalCreateSessionInput,
  PortalCreateSessionOutput,
} from '../schemas/portal/index.js';

export interface Portal<TRaw = unknown> {
  createSession(input: PortalCreateSessionInput): Promise<PortalCreateSessionOutput<TRaw>>;
}
