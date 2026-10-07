/**
 * Linux headless smoke. Unsets DISPLAY and WAYLAND_DISPLAY and checks /proc.
 *
 *   node scripts/smoke-headless-serve-linux.mjs
 *   pnpm smoke:headless-serve:linux
 */
import { linuxProfile, main } from "./headless-smoke/run.mjs";

main(linuxProfile);
