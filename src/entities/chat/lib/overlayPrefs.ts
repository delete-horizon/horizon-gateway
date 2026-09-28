import { atomWithStorage } from "jotai/utils";

/** Per device. Default on: teammates walk the monitor edge until this is turned off. */
export const overlayCharactersEnabledAtom = atomWithStorage("horizon-gateway-overlay-characters", true);
