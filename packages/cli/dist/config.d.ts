export interface PortLensConfig {
    relay: string;
    defaultName: string;
    defaultDesc: string;
}
/**
 * Read ~/.portlens/config.json.
 * If the file doesn't exist or is malformed, write defaults first then return them.
 */
export declare function readConfig(): PortLensConfig;
export declare function writeConfig(config: PortLensConfig): void;
export declare function configFilePath(): string;
//# sourceMappingURL=config.d.ts.map