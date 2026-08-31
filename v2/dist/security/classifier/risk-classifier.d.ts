/**
 * Deterministic Pre-LLM Risk Classifier.
 * Spec reference: §6.
 */
import type { RiskClassification } from '../types.js';
/**
 * Classifies PR risk level and domain surfaces without calling an LLM.
 */
export declare function classifyPrRisk(changedFiles: Array<{
    filename: string;
    patch?: string;
}>): RiskClassification;
//# sourceMappingURL=risk-classifier.d.ts.map