import type { LlmConfig } from '../llm/provider.js';
export declare function buildPiRuntimeModelsJson(config: LlmConfig): string;
export interface PiRuntimeConfig {
    configDir: string;
    cleanup(): Promise<void>;
}
export declare function preparePiRuntimeConfig(config: LlmConfig): Promise<PiRuntimeConfig>;
//# sourceMappingURL=runtime.d.ts.map