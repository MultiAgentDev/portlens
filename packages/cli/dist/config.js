import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const CONFIG_DIR = path.join(os.homedir(), ".portlens");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const DEFAULTS = {
    relay: "wss://relay.portlens.net",
    defaultName: "My App",
    defaultDesc: "",
};
/**
 * Read ~/.portlens/config.json.
 * If the file doesn't exist or is malformed, write defaults first then return them.
 */
export function readConfig() {
    try {
        const raw = fs.readFileSync(CONFIG_FILE, "utf8");
        return { ...DEFAULTS, ...JSON.parse(raw) };
    }
    catch {
        writeConfig(DEFAULTS);
        return { ...DEFAULTS };
    }
}
export function writeConfig(config) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", "utf8");
}
export function configFilePath() {
    return CONFIG_FILE;
}
//# sourceMappingURL=config.js.map