import { dirname } from 'node:path';
import type { LlmConfig } from '../llm/provider.js';
import type { ProfileId } from '../types/context.js';
export declare function buildPiRuntimeModelsJson(config: LlmConfig): string;
export interface PiRuntimeConfig {
    configDir: string;
    cleanup(): Promise<void>;
}
export declare function preparePiRuntimeConfig(config: LlmConfig, options?: {
    profiles?: readonly ProfileId[];
}): Promise<PiRuntimeConfig>;
export { dirname };
//# sourceMappingURL=runtime.d.ts.map