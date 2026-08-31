export declare function isBotActor(actor: string): boolean;
export declare function matchesPattern(actor: string, pattern: string): boolean;
export declare function isActorAllowed(actor: string, options: {
    allowedBots?: string;
    excludeActors?: string;
}): {
    allowed: boolean;
    reason?: string;
};
//# sourceMappingURL=actor-filter.d.ts.map