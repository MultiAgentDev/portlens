import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface PortLensConfig {
  relay: string;
  defaultName: string;
  defaultDesc: string;
}

const CONFIG_DIR = path.join(os.homedir(), ".portlens");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

const DEFAULTS: PortLensConfig = {
  relay: "wss://relay.portlens.net",
  defaultName: "My App",
  defaultDesc: "",
};

/**
 * Read ~/.portlens/config.json.
 * If the file doesn't exist or is malformed, write defaults first then return them.
 */
export function readConfig(): PortLensConfig {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf8");
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    writeConfig(DEFAULTS);
    return { ...DEFAULTS };
  }
}

export function writeConfig(config: PortLensConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", "utf8");
}

export function configFilePath(): string {
  return CONFIG_FILE;
}
