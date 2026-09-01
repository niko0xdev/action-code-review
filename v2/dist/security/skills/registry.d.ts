/**
 * Curated Cybersecurity Skills Registry.
 *
 * Attribution:
 * Derived and adapted from mukul975/Anthropic-Cybersecurity-Skills (Apache-2.0 License).
 * Copyright (c) 2024 Anthropic Cybersecurity Skills Contributors.
 * Licensed under the Apache License, Version 2.0.
 *
 * Spec reference: §7, §14, §32.
 */
export interface SecuritySkill {
    id: string;
    domain: string;
    title: string;
    summary: string;
    promptInstructions: string;
    cweList?: string[];
    owaspList?: string[];
}
export declare const CURATED_SECURITY_SKILLS: SecuritySkill[];
//# sourceMappingURL=registry.d.ts.map