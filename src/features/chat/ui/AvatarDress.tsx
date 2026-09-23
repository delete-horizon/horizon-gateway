import { useAtomValue } from "jotai";
import { Pencil, User } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { languageAtom } from "@/entities/app";
import {
  AVATAR_COMPOSE_H,
  AVATAR_GRID,
  type AvatarKit,
  blitRgba,
  composeStudioRgba,
  copyOfficialKit,
  copyOwnedAvatar,
  DEFAULT_AVATAR_KIT,
  listMyAvatars,
  loadParts,
  type OwnedAvatar,
  ownedToKit,
  pushAvatarUpdate,
  reloadCommAvatarCatalog,
  type StudioCatalog,
  setListedForSale,
  setVisibility,
  type UserPart,
  userPartIds,
} from "@/entities/chat";
import { openAvatarCatalogWindow, openAvatarStudioWindow } from "@/shared/lib/tauri/openChatWindow";
import { Button } from "@/shared/ui/button/Button";
import { Card } from "@/shared/ui/card/card";
import { AvatarCatalogBrowser, type AvatarCatalogEntry } from "./AvatarCatalogCard";
import { ChatShell } from "./ChatShell";

const PREVIEW_SCALE = 6;
const PART_SLOTS = ["body", "head", "outfit", "back", "held"] as const;

type PartSlot = (typeof PART_SLOTS)[number];

function isPartSlot(slot: string): slot is PartSlot {
  return PART_SLOTS.includes(slot as PartSlot);
}

export function AvatarDress() {
  const lang = useAtomValue(languageAtom);
  const ko = lang === "ko";
  const [catalog, setCatalog] = useState<StudioCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kit, setKit] = useState<AvatarKit>(DEFAULT_AVATAR_KIT);
  const [step, setStep] = useState(0);
  const [owned, setOwned] = useState<OwnedAvatar[]>([]);
  const [parts, setParts] = useState<UserPart[]>([]);
  const previewRef = useRef<HTMLCanvasElement>(null);

  const refreshOwned = useCallback(async () => {
    const mine = await listMyAvatars();
    setOwned(mine);
    setParts(await loadParts(mine.flatMap(userPartIds)));
  }, []);

  const loadCatalog = useCallback(async () => {
    setError(null);
    try {
      setCatalog(await reloadCommAvatarCatalog());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
    void refreshOwned().catch(() => {
      setOwned([]);
    });
  }, [loadCatalog, refreshOwned]);

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

  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || !merged) {
      return;
    }
    blitRgba(canvas, composeStudioRgba(kit, merged, step), PREVIEW_SCALE);
  }, [merged, kit, step]);

  const officialEntries: AvatarCatalogEntry[] = (catalog?.parts ?? []).map((part) => ({
    key: `official:${part.slot}:${part.id}`,
    slot: part.slot,
    partId: part.id,
    ko: part.ko,
    en: part.en,
    setName: part.set,
    glyphs: part.glyphs,
    shop: part.shop,
    mode: "part",
  }));

  const mineEntries: AvatarCatalogEntry[] = owned.map((avatar) => ({
    key: avatar.id,
    slot: "body",
    partId: avatar.id,
    ko: avatar.nameKo || avatar.id.slice(0, 8),
    en: avatar.nameEn || avatar.id.slice(0, 8),
    mode: "kit",
    kit: ownedToKit(avatar, parts),
  }));

  return (
    <ChatShell title={ko ? "아바타 꾸미기" : "Dress avatar"} icon={<User className="w-4 h-4" />}>
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        <section className="space-y-2 min-w-0">
          <h2 className="text-sm font-semibold text-base-content">{ko ? "미리보기" : "Preview"}</h2>
          <p className="text-xs text-base-content/55 leading-relaxed">
            {ko ? "입고 있는 파츠를 합성해서 보여 줍니다." : "Shows the parts you have equipped, composed together."}
          </p>
          <Card className="p-3 space-y-3 min-w-0">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" onClick={() => void openAvatarStudioWindow()}>
                <Pencil className="w-3.5 h-3.5" />
                {ko ? "제작 및 편집" : "Create and edit"}
              </Button>
              <Button size="sm" onClick={() => void loadCatalog()}>
                {ko ? "새로고침" : "Refresh"}
              </Button>
            </div>
            <div className="flex items-end gap-3">
              <canvas
                ref={previewRef}
                width={AVATAR_GRID * PREVIEW_SCALE}
                height={AVATAR_COMPOSE_H * PREVIEW_SCALE}
                className="rounded-md bg-base-300"
                style={{ imageRendering: "pixelated" }}
              />
              <label className="flex items-center gap-1.5 text-xs text-base-content/70">
                <input
                  type="checkbox"
                  className="checkbox checkbox-xs"
                  checked={step % 2 === 1}
                  onChange={(e) => setStep(e.target.checked ? 1 : 0)}
                />
                {ko ? "걸음" : "Walk"}
              </label>
            </div>
            {error ? <p className="text-[11px] text-error whitespace-pre-wrap">{error}</p> : null}
            {catalog?.warnings?.length ? (
              <p className="text-[11px] text-warning whitespace-pre-wrap">{catalog.warnings.join("\n")}</p>
            ) : null}
          </Card>
        </section>

        <section className="space-y-2 min-w-0">
          <h2 className="text-sm font-semibold text-base-content">{ko ? "기본" : "Official"}</h2>
          <p className="text-xs text-base-content/55 leading-relaxed">
            {ko ? "앱 소유 파츠입니다. 복사하면 내 아바타가 됩니다." : "App-owned parts. Copy makes one of yours."}
          </p>
          {merged ? (
            <AvatarCatalogBrowser
              catalog={merged}
              entries={officialEntries}
              langKo={ko}
              renderActions={(entry) => (
                <>
                  <Button
                    size="xs"
                    onClick={() => {
                      if (!isPartSlot(entry.slot)) {
                        return;
                      }
                      setKit((prev) => ({ ...prev, [entry.slot]: entry.partId }));
                    }}
                  >
                    {ko ? "착용" : "Wear"}
                  </Button>
                  <Button
                    size="xs"
                    onClick={() => {
                      void copyOfficialKit({ ...DEFAULT_AVATAR_KIT, [entry.slot]: entry.partId }, entry.ko, entry.en)
                        .then(() => refreshOwned())
                        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
                    }}
                  >
                    {ko ? "복사" : "Copy"}
                  </Button>
                </>
              )}
            />
          ) : null}
        </section>

        <section className="space-y-2 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-base-content">{ko ? "내 아바타" : "Mine"}</h2>
            <Button size="xs" onClick={() => void openAvatarCatalogWindow()}>
              {ko ? "카탈로그" : "Catalog"}
            </Button>
          </div>
          {merged ? (
            <AvatarCatalogBrowser
              catalog={merged}
              entries={mineEntries}
              langKo={ko}
              renderActions={(entry) => {
                const avatar = owned.find((item) => item.id === entry.key);
                if (!avatar) {
                  return null;
                }
                return (
                  <>
                    <Button size="xs" onClick={() => setKit(ownedToKit(avatar, parts))}>
                      {ko ? "착용" : "Wear"}
                    </Button>
                    <Button
                      size="xs"
                      onClick={() =>
                        void openAvatarStudioWindow({ slot: "body", id: avatar.bodyRef, ownedId: avatar.id })
                      }
                    >
                      {ko ? "편집" : "Edit"}
                    </Button>
                    <Button
                      size="xs"
                      onClick={() => {
                        void copyOwnedAvatar(avatar.id)
                          .then(() => refreshOwned())
                          .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
                      }}
                    >
                      {ko ? "복사" : "Copy"}
                    </Button>
                    <Button
                      size="xs"
                      onClick={() => {
                        void setVisibility(avatar.id, avatar.visibility === "shared" ? "private" : "shared")
                          .then(() => refreshOwned())
                          .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
                      }}
                    >
                      {avatar.visibility === "shared" ? (ko ? "내리기" : "Unshare") : ko ? "공유" : "Share"}
                    </Button>
                    <Button
                      size="xs"
                      onClick={() => {
                        void setListedForSale(avatar.id, !avatar.listedForSale)
                          .then(() => refreshOwned())
                          .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
                      }}
                    >
                      {avatar.listedForSale ? (ko ? "판매 중지" : "Stop sale") : ko ? "판매" : "Sell"}
                    </Button>
                    {avatar.listedForSale ? (
                      <Button
                        size="xs"
                        onClick={() => {
                          void pushAvatarUpdate(avatar.id).catch((e: unknown) =>
                            setError(e instanceof Error ? e.message : String(e)),
                          );
                        }}
                      >
                        {ko ? "구매분 갱신" : "Update buyers"}
                      </Button>
                    ) : null}
                  </>
                );
              }}
            />
          ) : null}
        </section>
      </div>
    </ChatShell>
  );
}
