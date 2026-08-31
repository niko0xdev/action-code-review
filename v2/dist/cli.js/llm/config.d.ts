import type { LlmConfig } from './provider.js';
/**
 * Environment-driven configuration. The legacy OPENAI_* variable names are
 * frozen contract (docs/v1-interface-contract.md); V2 maps them into its
 * normalized config shape (spec §7/§27).
 */
export declare const DEFAULT_BASE_URL = "https://api.openai.com/v1";
/** Spec §8 optional knobs with their recommended defaults. */
export declare const REVIEW_OPTION_DEFAULTS: {
    readonly aiReviewLevel: "standard";
    readonly aiReviewMaxFiles: 100;
    readonly aiReviewMaxFindings: 20;
    readonly aiReviewMinConfidence: 0.8;
    readonly aiReviewProfile: "auto";
};
export declare const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
export declare const DEFAULT_TIMEOUT_MS = 600000;
export declare function timeoutFromEnv(env?: NodeJS.ProcessEnv, fallback?: number): number;
export declare function loadLlmConfigFromEnv(env?: NodeJS.ProcessEnv): LlmConfig;
/** Accepts gateway URLs with or without a version path; always ends with /v1-style segment preserved or appended. */
export declare function normalizeBaseUrl(url: string): string;
//# sourceMappingURL=config.d.ts.map