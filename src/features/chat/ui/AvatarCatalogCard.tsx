import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AVATAR_COMPOSE_H,
  AVATAR_GRID,
  type AvatarKit,
  blitRgba,
  composeStudioRgba,
  DEFAULT_AVATAR_KIT,
  type PartChroma,
  type StudioCatalog,
} from "@/entities/chat";
import { Card } from "@/shared/ui/card/card";
import { Input } from "@/shared/ui/input/Input";

const PREVIEW_SCALE = 3;
const PAGE_SIZE = 8;
const SLOTS = ["body", "head", "outfit", "back", "held"] as const;

const CHROMA_CHANNELS: { key: keyof PartChroma; ko: string; en: string }[] = [
  { key: "outline", ko: "외곽", en: "Outline" },
  { key: "skin", ko: "피부", en: "Skin" },
  { key: "skinD", ko: "피부 그림자", en: "Skin shadow" },
  { key: "cloth", ko: "옷", en: "Cloth" },
  { key: "clothD", ko: "옷 그림자", en: "Cloth shadow" },
  { key: "accent", ko: "포인트", en: "Accent" },
  { key: "metal", ko: "금속", en: "Metal" },
  { key: "eye", ko: "눈", en: "Eye" },
  { key: "white", ko: "하이라이트", en: "White" },
];

function rgbCss(rgb: number[] | undefined): string | null {
  if (!rgb || rgb.length < 3) {
    return null;
  }
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function chromaRows(catalog: StudioCatalog, entry: AvatarCatalogEntry, langKo: boolean) {
  if (entry.mode === "kit") {
    return [];
  }
  const part = catalog.parts.find((item) => item.slot === entry.slot && item.id === entry.partId);
  const setChroma = part?.set ? catalog.sets?.find((item) => item.id === part.set)?.chroma : undefined;
  const partChroma = part?.chroma ?? undefined;
  return CHROMA_CHANNELS.flatMap((channel) => {
    const own = partChroma?.[channel.key];
    const fromSet = setChroma?.[channel.key];
    const rgb = own ?? fromSet;
    const color = rgbCss(rgb);
    if (!color) {
      return [];
    }
    return [
      {
        key: channel.key,
        label: langKo ? channel.ko : channel.en,
        color,
        source: own ? (langKo ? "파츠" : "Part") : langKo ? "세트" : "Set",
      },
    ];
  });
}

export type AvatarCatalogEntry = {
  key: string;
  slot: string;
  partId: string;
  ko: string;
  en: string;
  setName?: string;
  glyphs?: string[];
  shop?: boolean;
  ownerLabel?: string;
  mode: "part" | "kit";
  kit?: AvatarKit;
};

export function AvatarCatalogCard({
  catalog,
  entry,
  langKo,
  actions,
}: {
  catalog: StudioCatalog;
  entry: AvatarCatalogEntry;
  langKo: boolean;
  actions?: ReactNode;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const kit = entry.mode === "kit" && entry.kit ? entry.kit : { ...DEFAULT_AVATAR_KIT, [entry.slot]: entry.partId };
    const draft = entry.glyphs ? { slot: entry.slot, glyphs: entry.glyphs } : undefined;
    blitRgba(canvas, composeStudioRgba(kit, catalog, 0, draft), PREVIEW_SCALE);
  }, [catalog, entry]);

  const rows = chromaRows(catalog, entry, langKo);

  return (
    <Card className="p-2 space-y-2 min-w-0">
      <canvas
        ref={canvasRef}
        width={AVATAR_GRID * PREVIEW_SCALE}
        height={AVATAR_COMPOSE_H * PREVIEW_SCALE}
        className="rounded-md bg-base-300"
        style={{ imageRendering: "pixelated" }}
      />
      <p className="text-xs font-medium truncate">{langKo ? entry.ko : entry.en}</p>
      <div className="flex flex-wrap gap-1">
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-base-300">{entry.slot}</span>
        {entry.setName ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-base-300">{entry.setName}</span> : null}
        {entry.shop ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-base-300">Shop</span> : null}
      </div>
      {entry.ownerLabel ? <p className="text-[10px] text-base-content/55 truncate">{entry.ownerLabel}</p> : null}
      {rows.length > 0 ? (
        <ul className="space-y-0.5">
          {rows.map((row) => (
            <li key={row.key} className="flex items-center gap-1.5 min-w-0">
              <span
                className="w-2.5 h-2.5 rounded-sm shrink-0 border border-base-content/20"
                style={{ background: row.color }}
              />
              <span className="text-[10px] truncate">
                {row.label}
                <span className="text-base-content/45"> {row.source}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {actions ? <div className="flex flex-wrap gap-1">{actions}</div> : null}
    </Card>
  );
}

export function AvatarCatalogBrowser({
  catalog,
  entries,
  langKo,
  renderActions,
}: {
  catalog: StudioCatalog;
  entries: AvatarCatalogEntry[];
  langKo: boolean;
  renderActions?: (entry: AvatarCatalogEntry) => ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [setFilter, setSetFilter] = useState<string | null>(null);
  const [slotFilter, setSlotFilter] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const sets = useMemo(() => {
    const names = new Set<string>();
    for (const entry of entries) {
      if (entry.setName) {
        names.add(entry.setName);
      }
    }
    return [...names].sort();
  }, [entries]);
  const visible = entries.filter((entry) => {
    if (slotFilter && entry.mode === "part" && entry.slot !== slotFilter) {
      return false;
    }
    if (setFilter && entry.setName !== setFilter) {
      return false;
    }
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return true;
    }
    return [entry.ko, entry.en, entry.partId, entry.setName ?? "", entry.slot].join(" ").toLowerCase().includes(needle);
  });
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageEntries = visible.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="space-y-2">
      <Input
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setPage(0);
        }}
        placeholder={langKo ? "이름, 아이디, 세트 검색" : "Search name, id, set"}
      />
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          className={`text-[10px] px-1.5 py-0.5 rounded ${slotFilter ? "bg-base-300" : "bg-primary text-primary-content"}`}
          onClick={() => {
            setSlotFilter(null);
            setPage(0);
          }}
        >
          {langKo ? "전체 슬롯" : "All slots"}
        </button>
        {SLOTS.map((slot) => (
          <button
            key={slot}
            type="button"
            className={`text-[10px] px-1.5 py-0.5 rounded ${slotFilter === slot ? "bg-primary text-primary-content" : "bg-base-300"}`}
            onClick={() => {
              setSlotFilter(slot);
              setPage(0);
            }}
          >
            {slot}
          </button>
        ))}
      </div>
      {sets.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            className={`text-[10px] px-1.5 py-0.5 rounded ${setFilter ? "bg-base-300" : "bg-primary text-primary-content"}`}
            onClick={() => {
              setSetFilter(null);
              setPage(0);
            }}
          >
            {langKo ? "전체" : "All"}
          </button>
          {sets.map((name) => (
            <button
              key={name}
              type="button"
              className={`text-[10px] px-1.5 py-0.5 rounded ${setFilter === name ? "bg-primary text-primary-content" : "bg-base-300"}`}
              onClick={() => {
                setSetFilter(name);
                setPage(0);
              }}
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}
      {visible.length === 0 ? (
        <p className="text-xs text-base-content/45">{langKo ? "해당하는 파츠가 없습니다." : "No matching parts."}</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {pageEntries.map((entry) => (
            <AvatarCatalogCard
              key={entry.key}
              catalog={catalog}
              entry={entry}
              langKo={langKo}
              actions={renderActions?.(entry)}
            />
          ))}
        </div>
      )}
      {pageCount > 1 ? (
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            className="text-xs px-2 py-1 rounded bg-base-300 disabled:opacity-40"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            {langKo ? "이전" : "Prev"}
          </button>
          <span className="text-[11px] text-base-content/60">
            {currentPage + 1} / {pageCount}
          </span>
          <button
            type="button"
            className="text-xs px-2 py-1 rounded bg-base-300 disabled:opacity-40"
            disabled={currentPage >= pageCount - 1}
            onClick={() => setPage(currentPage + 1)}
          >
            {langKo ? "다음" : "Next"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
