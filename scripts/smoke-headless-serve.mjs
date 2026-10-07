/**
 * Runs the headless smoke for the current OS.
 *
 *   node scripts/smoke-headless-serve.mjs
 *   pnpm smoke:headless-serve
 *
 * OS-specific entry points:
 *   scripts/smoke-headless-serve-linux.mjs
 *   scripts/smoke-headless-serve-windows.mjs
 *   scripts/smoke-headless-serve-macos.mjs
 */
import { main, profileForPlatform } from "./headless-smoke/run.mjs";

main(profileForPlatform(process.platform));
