export declare function sha256(value: string | Buffer): string;
export declare function canonicalJson(value: unknown): string;
/** 递归哈希一个目录，产出稳定的 workspace fixture hash。 */
export declare function hashDirectory(root: string): Promise<string>;
