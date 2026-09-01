import type { SecurityContext, SecurityOptions, SecurityResult } from './types.js';
/**
 * Main security workflow orchestrator.
 * Spec reference: §5.2, §8, §9, §11, §18, §19, §26.
 */
export declare function runSecurityWorkflow(context: SecurityContext, options: SecurityOptions): Promise<SecurityResult>;
//# sourceMappingURL=orchestrator.d.ts.map