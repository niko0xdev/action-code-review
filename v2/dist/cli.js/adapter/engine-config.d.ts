import type { LlmConfig } from '../llm/provider.js';
/**
 * Engine configuration resolution: explicit action inputs win, the frozen
 * OPENAI_* environment variables are the fallback (spec §7/§27). This is
 * the single place where legacy names meet V2 config.
 */
export interface EngineConfigInput {
    apiKey: string;
    model: string;
    baseUrl?: string;
}
export declare function resolveEngineConfig(input: EngineConfigInput): LlmConfig;
//# sourceMappingURL=engine-config.d.ts.map