/**
 * Windows headless smoke. Same mock → proxy → capture scenario as Linux.
 * Does not read /proc. Headless is asserted from serve.log.
 *
 *   node scripts/smoke-headless-serve-windows.mjs
 *   pnpm smoke:headless-serve:windows
 */
import { main, windowsProfile } from "./headless-smoke/run.mjs";

main(windowsProfile);
