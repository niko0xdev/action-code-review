export type ReviewMode = 'auto' | 'review' | 'security' | 'agent';
export declare function resolveReviewMode(raw: string | undefined): ReviewMode;
export declare function isSupportedReviewEvent(eventName: string | undefined, action: string | undefined): boolean;
export declare function validateReviewEvent(eventName: string | undefined, action: string | undefined): {
    supported: boolean;
    reason?: string;
};
//# sourceMappingURL=detector.d.ts.map