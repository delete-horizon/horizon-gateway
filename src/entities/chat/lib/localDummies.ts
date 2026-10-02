import type { AvatarKit } from "./avatarKit";

export interface LocalDummy {
  id: string;
  label: string;
  kit: AvatarKit;
}

const DUMMIES: LocalDummy[] = [
  {
    id: "local-dummy-mina",
    label: "미나",
    kit: { body: "human", head: "hood", outfit: "cloak", back: "none", held: "staff" },
  },
  {
    id: "local-dummy-junho",
    label: "준호",
    kit: { body: "orc", head: "horns", outfit: "leather", back: "cape", held: "blade" },
  },
  {
    id: "local-dummy-hayun",
    label: "하윤",
    kit: { body: "elf", head: "wizard-hat", outfit: "robe", back: "none", held: "grimoire" },
  },
];

/** Dev-only stand-ins so the team member list, composer, and overlay can be tried without other clients. */
export function localDummies(): LocalDummy[] {
  return import.meta.env.DEV ? DUMMIES : [];
}

export function isLocalDummy(id: string): boolean {
  return id.startsWith("local-dummy-");
}
