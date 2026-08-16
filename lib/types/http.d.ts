import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ReplayLabService } from './service.ts';
export declare function createHttpHandler(service: ReplayLabService): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
