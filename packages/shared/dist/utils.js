"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatExpiry = exports.isExpired = void 0;
exports.generateToken = generateToken;
exports.hashPassword = hashPassword;
const node_crypto_1 = require("node:crypto");
// Re-export browser-safe time helpers as part of the server-side utils surface
var time_js_1 = require("./time.js");
Object.defineProperty(exports, "isExpired", { enumerable: true, get: function () { return time_js_1.isExpired; } });
Object.defineProperty(exports, "formatExpiry", { enumerable: true, get: function () { return time_js_1.formatExpiry; } });
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Encode(buf) {
    let num = BigInt("0x" + buf.toString("hex"));
    const base = BigInt(58);
    const chars = [];
    while (num > 0n) {
        chars.unshift(BASE58_ALPHABET[Number(num % base)]);
        num /= base;
    }
    for (const byte of buf) {
        if (byte !== 0)
            break;
        chars.unshift(BASE58_ALPHABET[0]);
    }
    return chars.join("");
}
function generateToken(length) {
    const buf = (0, node_crypto_1.randomBytes)(Math.ceil(length * 0.75));
    return base58Encode(buf).slice(0, length);
}
function hashPassword(password) {
    return (0, node_crypto_1.createHash)("sha256").update(password).digest("hex");
}
//# sourceMappingURL=utils.js.map