import type { VariantContributor } from './registries.ts';
export interface BuiltInVariantOptions {
    anchoredStandard?: {
        available: boolean;
        reason?: string;
    };
}
export declare function builtInVariants(options?: BuiltInVariantOptions): VariantContributor[];
