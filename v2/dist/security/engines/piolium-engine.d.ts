import type { SecurityContext, SecurityFinding } from '../types.js';
import type { SecurityEngine } from './security-engine.js';
/**
 * Piolium Deep Security Audit Engine Adapter.
 * Spec reference: §8, §19.
 */
export declare class PioliumSecurityEngine implements SecurityEngine {
    readonly name = "piolium";
    diff(ctx: SecurityContext): Promise<SecurityFinding[]>;
    audit(ctx: SecurityContext, profile: 'lite' | 'balanced' | 'deep'): Promise<SecurityFinding[]>;
    confirm(ctx: SecurityContext, findings: SecurityFinding[]): Promise<SecurityFinding[]>;
}
//# sourceMappingURL=piolium-engine.d.ts.map