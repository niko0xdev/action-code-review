import type { SecurityContext, SecurityFinding } from '../types.js';

export interface SecurityEngine {
	readonly name: string;
	diff(ctx: SecurityContext): Promise<SecurityFinding[]>;
	audit(
		ctx: SecurityContext,
		profile: 'lite' | 'balanced' | 'deep'
	): Promise<SecurityFinding[]>;
	confirm(
		ctx: SecurityContext,
		findings: SecurityFinding[]
	): Promise<SecurityFinding[]>;
}
