import { useAtomValue } from "jotai";
import { Bug, Pencil, Send, Sparkles, SprayCan } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { languageAtom, supabaseProfileAtom, userProfileAtom } from "@/entities/app";
import {
  AVATAR_CATALOG,
  type AvatarKit,
  applyAvatarSet,
  clearCommOverlay,
  DEFAULT_AVATAR_KIT,
  FRIEND_AVATAR_KIT,
  playCommAction,
  reloadCommAvatarCatalog,
  type StudioSet,
  setCommOverlayTool,
  showCommBubble,
  slotsFromStudioCatalog,
  syncCommResidents,
} from "@/entities/chat";
import { openAvatarStudioWindow } from "@/shared/lib/tauri/openChatWindow";
import { Button } from "@/shared/ui/button/Button";
import { Card } from "@/shared/ui/card/card";
import { Input } from "@/shared/ui/input/Input";
import { ChatShell } from "./ChatShell";

const SELF_ID = "playground-self";
const FRIEND_ID = "playground-friend";

function selfLabel(
  dbName: string | null | undefined,
  localName: string | undefined,
  email: string | null | undefined,
): string {
  return dbName?.trim() || localName?.trim() || email?.split("@")[0] || "나";
}

/** Local-only overlay lab: spawn yourself and send bubbles. Not wired to chat runtime. */
export function OverlayPlayground() {
  const lang = useAtomValue(languageAtom);
  const dbProfile = useAtomValue(supabaseProfileAtom);
  const localProfile = useAtomValue(userProfileAtom);
  const label = selfLabel(dbProfile?.display_name, localProfile.name, dbProfile?.email);
  const [text, setText] = useState("");
  const [withFriend, setWithFriend] = useState(false);
  const [visible, setVisible] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<{ id: string; line: string }[]>([]);
  const [kit, setKit] = useState<AvatarKit>(DEFAULT_AVATAR_KIT);
  const [catalog, setCatalog] = useState(AVATAR_CATALOG);
  const [sets, setSets] = useState<StudioSet[]>([]);
  const [catalogWarning, setCatalogWarning] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadCatalog = useCallback(async () => {
    try {
      const next = await reloadCommAvatarCatalog();
      setCatalog(slotsFromStudioCatalog(next));
      setSets(next.sets ?? []);
      setCatalogWarning(next.warnings?.length ? next.warnings.join("\n") : null);
    } catch (e) {
      setCatalogWarning(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const pushResidents = useCallback(
    async (showFriend: boolean, nextKit = kit) => {
      const residents = [{ profileId: SELF_ID, label, online: true, kit: nextKit }];
      if (showFriend) {
        residents.push({
          profileId: FRIEND_ID,
          label: lang === "ko" ? "테스트 친구" : "Test friend",
          online: true,
          kit: FRIEND_AVATAR_KIT,
        });
      }
      await syncCommResidents(residents);
    },
    [kit, label, lang],
  );

  useEffect(() => {
    if (!visible) {
      return;
    }
    void pushResidents(withFriend).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
    });
  }, [visible, withFriend, pushResidents]);

  useEffect(() => {
    return () => {
      void syncCommResidents([]).catch(() => {});
    };
  }, []);

  const appear = async () => {
    setError(null);
    setVisible(true);
    try {
      await pushResidents(withFriend);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const hide = async () => {
    setError(null);
    setVisible(false);
    try {
      await syncCommResidents([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const send = async () => {
    const body = text.trim();
    if (!body) {
      return;
    }
    setError(null);
    try {
      if (!visible) {
        setVisible(true);
        await pushResidents(withFriend);
      }
      await showCommBubble(SELF_ID, body, 5000);
      setLog((prev) => [{ id: crypto.randomUUID(), line: `${label}: ${body}` }, ...prev].slice(0, 12));
      setText("");
      inputRef.current?.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const pickPart = (slot: keyof AvatarKit, id: string) => {
    const next = { ...kit, [slot]: id };
    setKit(next);
    if (visible) {
      void pushResidents(withFriend, next).catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      });
    }
  };

  const pickSet = (nextSet: StudioSet) => {
    const next = applyAvatarSet(kit, nextSet.kit);
    setKit(next);
    if (visible) {
      void pushResidents(withFriend, next).catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      });
    }
  };

  const spawnFlies = async (count: number) => {
    setError(null);
    try {
      await playCommAction("fly", null, count, label);
      setLog((prev) =>
        [{ id: crypto.randomUUID(), line: lang === "ko" ? `초파리 ×${count}` : `flies ×${count}` }, ...prev].slice(
          0,
          12,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const armSpray = async () => {
    setError(null);
    try {
      await setCommOverlayTool("spray");
      setLog((prev) =>
        [{ id: crypto.randomUUID(), line: lang === "ko" ? "스프레이 켬" : "spray on" }, ...prev].slice(0, 12),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const clearFlies = async () => {
    setError(null);
    try {
      await clearCommOverlay();
      if (visible) {
        await pushResidents(withFriend);
      }
      setLog((prev) =>
        [{ id: crypto.randomUUID(), line: lang === "ko" ? "초파리 치움" : "flies cleared" }, ...prev].slice(0, 12),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <ChatShell title={lang === "ko" ? "오버레이 실험실" : "Overlay lab"}>
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        <section className="space-y-2 min-w-0">
          <h2 className="text-sm font-semibold text-base-content">
            {lang === "ko" ? "화면 하단의 나" : "You, on the bottom edge"}
          </h2>
          <p className="text-xs text-base-content/55 leading-relaxed">
            {lang === "ko"
              ? "채팅 런타임은 아직 안 붙입니다. 픽셀 판타지 캐릭터가 모니터 아래를 걷고, 보낸 말은 말풍선으로 뜹니다. Windows에서만 그려집니다."
              : "Chat runtime is not wired yet. A pixel-fantasy avatar walks the bottom edge; text you send becomes a bubble. Windows-only for now."}
          </p>
          <Card className="p-3 space-y-3 min-w-0">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" onClick={() => void appear()}>
                <Sparkles className="w-3.5 h-3.5" />
                {lang === "ko" ? "나타나기" : "Show"}
              </Button>
              <Button size="sm" onClick={() => void hide()}>
                {lang === "ko" ? "숨기기" : "Hide"}
              </Button>
              <label className="flex items-center gap-1.5 text-xs text-base-content/70 px-1">
                <input
                  type="checkbox"
                  className="checkbox checkbox-xs"
                  checked={withFriend}
                  onChange={(e) => setWithFriend(e.target.checked)}
                />
                {lang === "ko" ? "테스트 친구 하나" : "Add a test friend"}
              </label>
            </div>
            <div className="flex gap-2">
              <Input
                ref={inputRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={lang === "ko" ? "나한테 한마디" : "Say something to yourself"}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <Button size="sm" variant="primary" className="shrink-0 gap-1" onClick={() => void send()}>
                <Send className="w-3.5 h-3.5" />
                {lang === "ko" ? "보내기" : "Send"}
              </Button>
            </div>
            {error ? <p className="text-[11px] text-error whitespace-pre-wrap">{error}</p> : null}
          </Card>
        </section>

        <section className="space-y-2 min-w-0">
          <h2 className="text-sm font-semibold text-base-content">{lang === "ko" ? "스킨 파츠" : "Skin parts"}</h2>
          <p className="text-xs text-base-content/55 leading-relaxed">
            {lang === "ko"
              ? "픽셀 판타지 캐릭터입니다. 세트는 한 번에 여러 파츠를 끼웁니다. Shop은 유료 예정 SKU입니다."
              : "Pixel-fantasy avatar. A set applies several parts at once. Shop marks planned paid SKUs."}
          </p>
          <Card className="p-3 space-y-3 min-w-0">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void openAvatarStudioWindow()}>
                <Pencil className="w-3.5 h-3.5" />
                {lang === "ko" ? "파츠 스튜디오" : "Parts studio"}
              </Button>
              <Button size="sm" onClick={() => void loadCatalog()}>
                {lang === "ko" ? "카탈로그 새로고침" : "Reload catalog"}
              </Button>
            </div>
            {catalogWarning ? <p className="text-[11px] text-error whitespace-pre-wrap">{catalogWarning}</p> : null}
            {sets.length > 0 ? (
              <div className="space-y-1.5">
                <p className="text-[11px] font-medium text-base-content/70">{lang === "ko" ? "세트" : "Sets"}</p>
                <div className="flex flex-wrap gap-1.5">
                  {sets.map((item) => (
                    <Button
                      key={item.id}
                      size="xs"
                      variant={
                        kit.head === item.kit.head &&
                        kit.outfit === item.kit.outfit &&
                        kit.back === item.kit.back &&
                        kit.held === item.kit.held
                          ? "primary"
                          : "secondary"
                      }
                      onClick={() => pickSet(item)}
                    >
                      {lang === "ko" ? item.ko : item.en}
                      {item.shop ? <span className="opacity-60">Shop</span> : null}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
            {catalog.map((slot) => (
              <div key={slot.slot} className="space-y-1.5">
                <p className="text-[11px] font-medium text-base-content/70">{lang === "ko" ? slot.ko : slot.en}</p>
                <div className="flex flex-wrap gap-1.5">
                  {slot.options.map((opt) => (
                    <Button
                      key={opt.id}
                      size="xs"
                      variant={kit[slot.slot] === opt.id ? "primary" : "secondary"}
                      onClick={() => pickPart(slot.slot, opt.id)}
                    >
                      {lang === "ko" ? opt.ko : opt.en}
                      {opt.shop ? <span className="opacity-60">Shop</span> : null}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </Card>
        </section>

        <section className="space-y-2 min-w-0">
          <h2 className="text-sm font-semibold text-base-content">{lang === "ko" ? "초파리" : "Fruit flies"}</h2>
          <p className="text-xs text-base-content/55 leading-relaxed">
            {lang === "ko"
              ? "화면 여기저기에 초파리가 뜹니다. 스프레이를 켠 뒤 마우스 왼쪽 버튼을 누른 채로 쫓으면 주변이 잡힙니다. 창은 클릭을 먹지 않습니다."
              : "Flies scatter across the screen. Arm spray, then hold the left mouse button to catch nearby flies. Overlay windows stay click-through."}
          </p>
          <Card className="p-3 space-y-3 min-w-0">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" onClick={() => void spawnFlies(1)}>
                <Bug className="w-3.5 h-3.5" />
                {lang === "ko" ? "1마리" : "1 fly"}
              </Button>
              <Button size="sm" onClick={() => void spawnFlies(10)}>
                {lang === "ko" ? "10마리" : "10 flies"}
              </Button>
              <Button size="sm" onClick={() => void spawnFlies(40)}>
                {lang === "ko" ? "40마리" : "40 flies"}
              </Button>
              <Button size="sm" onClick={() => void armSpray()}>
                <SprayCan className="w-3.5 h-3.5" />
                {lang === "ko" ? "스프레이" : "Spray"}
              </Button>
              <Button size="sm" onClick={() => void clearFlies()}>
                {lang === "ko" ? "초파리 치우기" : "Clear flies"}
              </Button>
            </div>
          </Card>
        </section>

        <section className="space-y-2 min-w-0">
          <h2 className="text-sm font-semibold text-base-content">{lang === "ko" ? "방금 보낸 말" : "Sent here"}</h2>
          <Card className="p-3 min-h-24">
            {log.length === 0 ? (
              <p className="text-xs text-base-content/45">
                {lang === "ko"
                  ? "아직 없음. 모니터 하단을 보면서 보내 보세요."
                  : "None yet. Send while watching the bottom of the screen."}
              </p>
            ) : (
              <ul className="space-y-1">
                {log.map((item) => (
                  <li key={item.id} className="text-xs text-base-content/80 truncate">
                    {item.line}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      </div>
    </ChatShell>
  );
}
