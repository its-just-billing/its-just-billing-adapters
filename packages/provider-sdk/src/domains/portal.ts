import type {
  PortalCreateSessionInput,
  PortalCreateSessionOutput,
} from '../schemas/portal/index.js';

export interface Portal {
  createSession(input: PortalCreateSessionInput): Promise<PortalCreateSessionOutput>;
}
