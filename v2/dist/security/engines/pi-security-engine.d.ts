import type { SecurityContext, SecurityFinding } from '../types.js';
import type { SecurityEngine } from './security-engine.js';
/**
 * Pi-powered security engine for diff security reviews and finding confirmations.
 * Spec reference: §5.2, §15, §22.
 */
export declare class PiSecurityEngine implements SecurityEngine {
    readonly name = "pi-security";
    /**
     * Run diff-based security reasoning.
     */
    diff(ctx: SecurityContext): Promise<SecurityFinding[]>;
    /**
     * Full repository audit profile (lightweight Pi review if Piolium not selected).
     */
    audit(ctx: SecurityContext, _profile: 'lite' | 'balanced' | 'deep'): Promise<SecurityFinding[]>;
    /**
     * Run an independent confirmation/validation pass for candidate findings.
     * Spec reference: §15 (avoids anchoring to discoverer reasoning).
     */
    confirm(ctx: SecurityContext, findings: SecurityFinding[]): Promise<SecurityFinding[]>;
    private buildDiffSecurityPrompt;
    private buildConfirmationPrompt;
    private executePi;
    private parseFindings;
}
//# sourceMappingURL=pi-security-engine.d.ts.map