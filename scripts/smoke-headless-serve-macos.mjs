/**
 * macOS headless smoke. Same mock → proxy → capture scenario as Linux.
 * Does not read /proc. Headless is asserted from serve.log.
 *
 *   node scripts/smoke-headless-serve-macos.mjs
 *   pnpm smoke:headless-serve:macos
 */
import { macosProfile, main } from "./headless-smoke/run.mjs";

main(macosProfile);
