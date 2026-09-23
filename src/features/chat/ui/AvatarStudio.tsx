import { listen } from "@tauri-apps/api/event";
import { useAtomValue } from "jotai";
import { Copy, Pencil, Plus, RefreshCw, Save, User } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { languageAtom } from "@/entities/app";
import {
  AVATAR_COMPOSE_H,
  AVATAR_GRID,
  blitRgba,
  composeStudioRgba,
  copyOfficialKit,
  DEFAULT_AVATAR_KIT,
  drawGlyphGrid,
  emptyGlyphs,
  forkSlot,
  GLYPH_CHANNELS,
  type GlyphCh,
  reloadCommAvatarCatalog,
  type StudioCatalog,
  type StudioPart,
  setGlyphCell,
} from "@/entities/chat";
import { AVATAR_EDITOR_OPEN_EVENT, openAvatarDressWindow } from "@/shared/lib/tauri/openChatWindow";
import { Button } from "@/shared/ui/button/Button";
import { Card } from "@/shared/ui/card/card";
import { Input } from "@/shared/ui/input/Input";
import { AvatarCatalogBrowser, type AvatarCatalogEntry } from "./AvatarCatalogCard";
import { ChatShell } from "./ChatShell";

const CELL = 14;
const PREVIEW_SCALE = 6;
const PART_SLOTS = ["body", "head", "outfit", "back", "held"] as const;

function cellAt(canvas: HTMLCanvasElement, clientX: number, clientY: number): { x: number; y: number } | null {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor(((clientX - rect.left) / rect.width) * AVATAR_GRID);
  const y = Math.floor(((clientY - rect.top) / rect.height) * AVATAR_GRID);
  if (x < 0 || y < 0 || x >= AVATAR_GRID || y >= AVATAR_GRID) {
    return null;
  }
  return { x, y };
}

export function AvatarStudio({
  initialSlot,
  initialId,
  initialOwnedId,
}: {
  initialSlot?: string;
  initialId?: string;
  initialOwnedId?: string;
} = {}) {
  const lang = useAtomValue(languageAtom);
  const ko = lang === "ko";
  const [catalog, setCatalog] = useState<StudioCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [slot, setSlot] = useState<(typeof PART_SLOTS)[number]>("body");
  const [id, setId] = useState("sprite");
  const [labelKo, setLabelKo] = useState("스프라이트");
  const [labelEn, setLabelEn] = useState("Sprite");
  const [shop, setShop] = useState(false);
  const [setKey, setSetKey] = useState("");
  const [glyphs, setGlyphs] = useState<string[]>(emptyGlyphs);
  const [brush, setBrush] = useState<GlyphCh>("O");
  const [step, setStep] = useState(0);
  const [ownedId, setOwnedId] = useState(initialOwnedId);
  useEffect(() => {
    if (initialOwnedId) {
      setOwnedId(initialOwnedId);
    }
  }, [initialOwnedId]);
  const paintRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  const loadCatalog = useCallback(async () => {
    setError(null);
    try {
      const next = await reloadCommAvatarCatalog();
      setCatalog(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const primed = useRef(false);
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;
  const pendingOpen = useRef<{ slot: string; id: string } | null>(
    initialSlot && initialId ? { slot: initialSlot, id: initialId } : null,
  );

  const loadPart = useCallback((part: StudioCatalog["parts"][number]) => {
    if (!PART_SLOTS.includes(part.slot as (typeof PART_SLOTS)[number])) {
      return;
    }
    setSlot(part.slot as (typeof PART_SLOTS)[number]);
    setId(part.id);
    setLabelKo(part.ko);
    setLabelEn(part.en);
    setShop(part.shop);
    setSetKey(part.set ?? "");
    setGlyphs(part.glyphs);
    setNotice(null);
  }, []);

  useEffect(() => {
    if (initialSlot && initialId) {
      pendingOpen.current = { slot: initialSlot, id: initialId };
      primed.current = false;
    }
  }, [initialId, initialSlot]);

  useEffect(() => {
    const applyDraft = (part: StudioPart) => {
      loadPart({ ...part, set: part.set ?? "", shop: part.shop ?? false });
    };
    const unlistenDraft = listen<StudioPart>("avatar-draft", (event) => {
      applyDraft(event.payload);
    });
    const unlistenSaved = listen<StudioPart>("avatar-catalog-changed", (event) => {
      applyDraft(event.payload);
      void loadCatalog();
    });
    return () => {
      void unlistenDraft.then((stop) => stop());
      void unlistenSaved.then((stop) => stop());
    };
  }, [loadCatalog, loadPart]);

  useEffect(() => {
    const unlisten = listen<{ slot: string; id: string; ownedId?: string }>(AVATAR_EDITOR_OPEN_EVENT, (event) => {
      if (event.payload.ownedId) {
        setOwnedId(event.payload.ownedId);
      }
      const part = catalogRef.current?.parts.find(
        (item) => item.slot === event.payload.slot && item.id === event.payload.id,
      );
      if (part) {
        loadPart(part);
        return;
      }
      pendingOpen.current = event.payload;
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, [loadPart]);

  useEffect(() => {
    if (!catalog) {
      return;
    }
    const pending = pendingOpen.current;
    if (pending) {
      const part = catalog.parts.find((item) => item.slot === pending.slot && item.id === pending.id);
      if (part) {
        pendingOpen.current = null;
        primed.current = true;
        loadPart(part);
        return;
      }
    }
    if (primed.current) {
      return;
    }
    const first = catalog.parts.find((p) => p.slot === "body" && p.id === "sprite") ?? catalog.parts[0];
    if (!first) {
      return;
    }
    primed.current = true;
    loadPart(first);
  }, [catalog, loadPart]);

  useEffect(() => {
    const canvas = paintRef.current;
    if (canvas) {
      drawGlyphGrid(canvas, glyphs, CELL);
    }
  }, [glyphs]);

  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || !catalog) {
      return;
    }
    const rgba = composeStudioRgba(DEFAULT_AVATAR_KIT, catalog, step, { slot, glyphs });
    blitRgba(canvas, rgba, PREVIEW_SCALE);
  }, [catalog, glyphs, slot, step]);

  const paintAt = (clientX: number, clientY: number, ch: GlyphCh) => {
    const canvas = paintRef.current;
    if (!canvas) {
      return;
    }
    const at = cellAt(canvas, clientX, clientY);
    if (!at) {
      return;
    }
    setGlyphs((prev) => setGlyphCell(prev, at.x, at.y, ch));
  };

  const save = async () => {
    setError(null);
    setNotice(null);
    try {
      const fields = {
        slug: id.trim(),
        ko: labelKo.trim() || id,
        en: labelEn.trim() || id,
        setKey: setKey.trim(),
        shop,
        glyphs,
      };
      let target = ownedId;
      if (!target) {
        const created = await copyOfficialKit(
          { ...DEFAULT_AVATAR_KIT, [slot]: id.trim() || "sprite" },
          fields.ko,
          fields.en,
        );
        target = created.id;
        setOwnedId(target);
      }
      const saved = await forkSlot(target, slot, fields);
      setNotice(saved.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const copyJson = async () => {
    const json = `${JSON.stringify({ id, slot, set: setKey.trim() || undefined, shop, ko: labelKo, en: labelEn, glyphs }, null, 2)}\n`;
    try {
      await navigator.clipboard.writeText(json);
      setNotice(ko ? "JSON을 복사했습니다" : "JSON copied");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const ascii = glyphs.join("\n");

  return (
    <ChatShell title={ko ? "아바타 제작" : "Create avatar"} icon={<Pencil className="w-4 h-4" />}>
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        <section className="space-y-2 min-w-0">
          <h2 className="text-sm font-semibold text-base-content">ASCII</h2>
          <p className="text-xs text-base-content/55 leading-relaxed">
            {ko
              ? "점을 직접 찍으려면 여기서 고칩니다. 한 줄은 24칸입니다."
              : "Edit the dots here. Each line is 24 cells."}
          </p>
          <Card className="p-3 min-w-0">
            <textarea
              className="textarea textarea-bordered font-mono text-[10px] leading-[1.15] w-full h-64 bg-base-100"
              spellCheck={false}
              value={ascii}
              onChange={(e) => {
                const lines = e.target.value.replace(/\r/g, "").split("\n").slice(0, AVATAR_GRID);
                while (lines.length < AVATAR_GRID) {
                  lines.push(".".repeat(AVATAR_GRID));
                }
                setGlyphs(lines.map((line) => line.padEnd(AVATAR_GRID, ".").slice(0, AVATAR_GRID)));
              }}
            />
          </Card>
        </section>
        <section className="space-y-2 min-w-0">
          <h2 className="text-sm font-semibold text-base-content">{ko ? "파츠 그리기" : "Paint a part"}</h2>
          <p className="text-xs text-base-content/55 leading-relaxed">
            {ko
              ? "24×24 ASCII입니다. 저장하면 내 아바타의 이 슬롯만 사용자 파츠로 갈라집니다."
              : "24×24 ASCII. Save forks this slot into a part you own."}
          </p>
          <Card className="p-3 space-y-3 min-w-0">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void openAvatarDressWindow()}>
                <User className="w-3.5 h-3.5" />
                {ko ? "꾸미기 창" : "Dress window"}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {PART_SLOTS.map((s) => (
                <Button key={s} size="xs" variant={slot === s ? "primary" : "secondary"} onClick={() => setSlot(s)}>
                  {s}
                </Button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input value={id} onChange={(e) => setId(e.target.value)} placeholder="id" />
              <label className="flex items-center gap-1.5 text-xs text-base-content/70 px-1">
                <input
                  type="checkbox"
                  className="checkbox checkbox-xs"
                  checked={shop}
                  onChange={(e) => setShop(e.target.checked)}
                />
                Shop
              </label>
              <Input value={labelKo} onChange={(e) => setLabelKo(e.target.value)} placeholder="ko" />
              <Input value={labelEn} onChange={(e) => setLabelEn(e.target.value)} placeholder="en" />
              <Input value={setKey} onChange={(e) => setSetKey(e.target.value)} placeholder="set (crusader)" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {GLYPH_CHANNELS.map((ch) => (
                <Button
                  key={ch.ch}
                  size="xs"
                  variant={brush === ch.ch ? "primary" : "secondary"}
                  className="font-mono"
                  onClick={() => setBrush(ch.ch)}
                >
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-sm border border-base-300"
                    style={{ background: ch.hex ?? "transparent" }}
                  />
                  {ch.ch} {ko ? ch.ko : ch.en}
                </Button>
              ))}
            </div>
            <canvas
              ref={paintRef}
              width={AVATAR_GRID * CELL}
              height={AVATAR_GRID * CELL}
              className="block rounded-md cursor-crosshair touch-none max-w-full"
              style={{ width: AVATAR_GRID * CELL, height: AVATAR_GRID * CELL, imageRendering: "pixelated" }}
              onContextMenu={(e) => e.preventDefault()}
              onPointerDown={(e) => {
                drawing.current = true;
                e.currentTarget.setPointerCapture(e.pointerId);
                paintAt(e.clientX, e.clientY, e.button === 2 ? "." : brush);
              }}
              onPointerMove={(e) => {
                if (!drawing.current) {
                  return;
                }
                paintAt(e.clientX, e.clientY, e.buttons === 2 ? "." : brush);
              }}
              onPointerUp={() => {
                drawing.current = false;
              }}
              onPointerCancel={() => {
                drawing.current = false;
              }}
            />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" onClick={() => void save()}>
                <Save className="w-3.5 h-3.5" />
                {ko ? "저장" : "Save"}
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setId("new-part");
                  setLabelKo("");
                  setLabelEn("");
                  setShop(false);
                  setSetKey("");
                  setGlyphs(emptyGlyphs());
                  setNotice(null);
                }}
              >
                <Plus className="w-3.5 h-3.5" />
                {ko ? "새 파츠" : "New"}
              </Button>
              <Button size="sm" onClick={() => void copyJson()}>
                <Copy className="w-3.5 h-3.5" />
                JSON
              </Button>
              <Button size="sm" onClick={() => void loadCatalog()}>
                <RefreshCw className="w-3.5 h-3.5" />
                {ko ? "새로고침" : "Refresh"}
              </Button>
            </div>
            {error ? <p className="text-[11px] text-error whitespace-pre-wrap">{error}</p> : null}
            {notice ? <p className="text-[11px] text-base-content/60 break-all">{notice}</p> : null}
          </Card>
        </section>

        <section className="space-y-2 min-w-0">
          <h2 className="text-sm font-semibold text-base-content">{ko ? "합성 미리보기" : "Composite preview"}</h2>
          <p className="text-xs text-base-content/55 leading-relaxed">
            {ko
              ? "지금 그리는 슬롯이 기본 아바타 위에 덮입니다."
              : "The slot you are painting replaces that layer on the default avatar."}
          </p>
          <Card className="p-3 space-y-3 min-w-0">
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
            {catalog?.warnings?.length ? (
              <p className="text-[11px] text-warning whitespace-pre-wrap">{catalog.warnings.join("\n")}</p>
            ) : null}
          </Card>
        </section>

        <section className="space-y-2 min-w-0">
          <h2 className="text-sm font-semibold text-base-content">{ko ? "편집할 파츠" : "Part to edit"}</h2>
          {catalog ? (
            <AvatarCatalogBrowser
              catalog={catalog}
              langKo={ko}
              entries={catalog.parts.map(
                (part): AvatarCatalogEntry => ({
                  key: `${part.slot}:${part.id}`,
                  slot: part.slot,
                  partId: part.id,
                  ko: part.ko,
                  en: part.en,
                  setName: part.set,
                  glyphs: part.glyphs,
                  shop: part.shop,
                  mode: "part",
                }),
              )}
              renderActions={(entry) => (
                <Button
                  size="xs"
                  onClick={() => {
                    const part = catalog.parts.find((item) => item.slot === entry.slot && item.id === entry.partId);
                    if (part) {
                      loadPart(part);
                    }
                  }}
                >
                  {ko ? "열기" : "Open"}
                </Button>
              )}
            />
          ) : null}
        </section>
      </div>
    </ChatShell>
  );
}
