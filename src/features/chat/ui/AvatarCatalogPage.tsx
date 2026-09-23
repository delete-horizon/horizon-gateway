import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { languageAtom, supabaseSessionAtom } from "@/entities/app";
import {
  authorName,
  copyOfficialKit,
  DEFAULT_AVATAR_KIT,
  listMyEntitlements,
  listSharedAvatars,
  loadParts,
  type OwnedAvatar,
  ownedToKit,
  purchaseAvatar,
  reloadCommAvatarCatalog,
  type StudioCatalog,
  type UserPart,
  userPartIds,
} from "@/entities/chat";
import { Button } from "@/shared/ui/button/Button";
import { AvatarCatalogBrowser, type AvatarCatalogEntry } from "./AvatarCatalogCard";
import { ChatShell } from "./ChatShell";

export function AvatarCatalogPage() {
  const lang = useAtomValue(languageAtom);
  const session = useAtomValue(supabaseSessionAtom);
  const ko = lang === "ko";
  const [catalog, setCatalog] = useState<StudioCatalog | null>(null);
  const [shared, setShared] = useState<OwnedAvatar[]>([]);
  const [parts, setParts] = useState<UserPart[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [bought, setBought] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const me = session?.user.id ?? null;

  const load = useCallback(async () => {
    setError(null);
    const nextShared = await listSharedAvatars().catch(() => []);
    const entitlements = await listMyEntitlements().catch(() => []);
    const nextCatalog = await reloadCommAvatarCatalog();
    setCatalog(nextCatalog);
    setShared(nextShared);
    setBought(new Set(entitlements.map((item) => item.avatarId)));
    setParts(await loadParts(nextShared.flatMap(userPartIds)));
    const owners = [...new Set(nextShared.map((item) => item.ownerId))];
    const labels = await Promise.all(owners.map(async (id) => [id, await authorName(id)] as const));
    setNames(Object.fromEntries(labels));
  }, []);

  useEffect(() => {
    void load().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [load]);

  const merged = useMemo(() => {
    if (!catalog) {
      return null;
    }
    return {
      ...catalog,
      parts: [
        ...catalog.parts,
        ...parts.map((part) => ({
          id: part.id,
          slot: part.slot,
          set: part.setKey,
          shop: part.shop,
          ko: part.ko,
          en: part.en,
          glyphs: part.glyphs,
        })),
      ],
    };
  }, [catalog, parts]);

  const entries: AvatarCatalogEntry[] = [
    ...(catalog?.parts ?? []).map((part) => ({
      key: `official:${part.slot}:${part.id}`,
      slot: part.slot,
      partId: part.id,
      ko: part.ko,
      en: part.en,
      setName: part.set,
      glyphs: part.glyphs,
      shop: part.shop,
      mode: "part" as const,
    })),
    ...shared
      .filter((avatar) => avatar.listedForSale)
      .map((avatar) => ({
        key: avatar.id,
        slot: "body",
        partId: avatar.id,
        ko: avatar.nameKo || avatar.id.slice(0, 8),
        en: avatar.nameEn || avatar.id.slice(0, 8),
        ownerLabel: names[avatar.ownerId],
        mode: "kit" as const,
        kit: ownedToKit(avatar, parts),
      })),
  ];

  return (
    <ChatShell title={ko ? "아바타 카탈로그" : "Avatar catalog"}>
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        <section className="space-y-2 min-w-0">
          <h2 className="text-sm font-semibold text-base-content">{ko ? "카탈로그" : "Catalog"}</h2>
          <p className="text-xs text-base-content/55 leading-relaxed">
            {ko
              ? "기본 파츠와 판매 중인 아바타입니다. 다른 사람 것은 복사할 수 없습니다."
              : "Official parts and avatars for sale. Someone else's avatar cannot be copied."}
          </p>
          {error ? <p className="text-[11px] text-error whitespace-pre-wrap">{error}</p> : null}
          {merged ? (
            <AvatarCatalogBrowser
              catalog={merged}
              entries={entries}
              langKo={ko}
              renderActions={(entry) => {
                const avatar = shared.find((item) => item.id === entry.key);
                if (!avatar) {
                  return (
                    <Button
                      size="xs"
                      onClick={() => {
                        void copyOfficialKit(
                          { ...DEFAULT_AVATAR_KIT, [entry.slot]: entry.partId },
                          entry.ko,
                          entry.en,
                        ).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
                      }}
                    >
                      {ko ? "복사" : "Copy"}
                    </Button>
                  );
                }
                if (avatar.ownerId === me) {
                  return <span className="text-[10px] text-base-content/55">{ko ? "내 판매" : "Yours"}</span>;
                }
                if (bought.has(avatar.id)) {
                  return <span className="text-[10px] text-base-content/55">{ko ? "구매함" : "Owned"}</span>;
                }
                return (
                  <Button
                    size="xs"
                    onClick={() => {
                      void purchaseAvatar(avatar.id)
                        .then(() => load())
                        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
                    }}
                  >
                    {ko ? "구매" : "Buy"}
                  </Button>
                );
              }}
            />
          ) : null}
        </section>
      </div>
    </ChatShell>
  );
}
