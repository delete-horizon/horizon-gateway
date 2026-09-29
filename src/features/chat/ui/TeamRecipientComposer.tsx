import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { listMembers } from "@/entities/team";
import { commands, unwrap } from "@/shared/api";
import { Button } from "@/shared/ui/button/Button";
import { Input } from "@/shared/ui/input/Input";
import { localDummies } from "../lib/localDummies";
import { sendTeamLine } from "../lib/sendTeamLine";

/** Keep in sync with DOCK_* in window_commands.rs */
const DOCK_WIDTH = 240;
const DOCK_SEARCH = 28;
const DOCK_ROW = 22;
const DOCK_MESSAGE = 30;
const DOCK_BORDER = 1;
const DOCK_MAX_ROWS = 4;

function dockHeight(rows: number): number {
  const n = Math.min(Math.max(rows, 1), DOCK_MAX_ROWS);
  return DOCK_SEARCH + n * DOCK_ROW + DOCK_BORDER + DOCK_MESSAGE;
}

export interface TeamRecipient {
  id: string;
  label: string;
  local?: boolean;
}

export function TeamRecipientComposer({
  workspaceId,
  myId,
  members,
  ko,
  focusId,
  fill,
  onClose,
}: {
  workspaceId: string;
  myId: string;
  members?: TeamRecipient[];
  ko: boolean;
  /** When set, that teammate starts checked. Clicking yourself checks everyone. */
  focusId?: string;
  /** One-line dock, the same size as the old single-person composer. */
  fill?: boolean;
  onClose?: () => void;
}) {
  const [loaded, setLoaded] = useState<TeamRecipient[] | null>(members ? null : []);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const didInit = useRef(false);
  const appliedFocus = useRef<string | null>(null);

  useEffect(() => {
    if (members) {
      return;
    }
    let cancelled = false;
    void listMembers(workspaceId)
      .then((list) => {
        if (cancelled) {
          return;
        }
        setLoaded(
          list.map((member) => ({
            id: member.profile_id,
            label:
              member.profile?.display_name?.trim() || member.profile?.email?.trim() || member.profile_id.slice(0, 8),
          })),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setLoaded([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [members, workspaceId]);

  const people = useMemo(() => {
    const source = members ?? loaded ?? [];
    const real = source.filter((person) => person.id !== myId);
    const extras = localDummies()
      .filter((dummy) => !real.some((person) => person.id === dummy.id))
      .map((dummy) => ({ id: dummy.id, label: dummy.label, local: true }));
    return [...real, ...extras];
  }, [loaded, members, myId]);

  const peopleKey = people.map((person) => person.id).join("\n");

  useEffect(() => {
    const ids = peopleKey ? peopleKey.split("\n") : [];
    if (ids.length === 0) {
      return;
    }
    const focus = focusId?.trim() ?? "";
    if (focus && appliedFocus.current !== focus) {
      appliedFocus.current = focus;
      didInit.current = true;
      setSelected(ids.includes(focus) ? [focus] : ids);
      return;
    }
    if (!didInit.current) {
      didInit.current = true;
      setSelected(ids);
      return;
    }
    setSelected((prev) => prev.filter((id) => ids.includes(id)));
  }, [peopleKey, focusId]);

  const visible = people.filter((person) => person.label.toLowerCase().includes(query.trim().toLowerCase()));
  const selectedCount = selected.length;
  const dockRows = Math.min(Math.max(visible.length, 1), DOCK_MAX_ROWS);
  const dockH = dockHeight(dockRows);

  useEffect(() => {
    if (!fill) {
      return;
    }
    void (async () => {
      try {
        unwrap(await commands.fitResidentComposer(dockH));
      } catch {
        /* outside Tauri / old binary */
      }
    })();
  }, [fill, dockH]);

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const selectAll = () => setSelected(people.map((person) => person.id));
  const clearAll = () => setSelected([]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending || selectedCount === 0) {
      return;
    }
    setSending(true);
    setStatus(null);
    try {
      const result = await sendTeamLine({ workspaceId, myId, body, profileIds: selected, ko });
      setDraft("");
      if (fill) {
        setStatus(null);
      } else {
        setStatus(
          result.localOnly
            ? ko
              ? "이 화면의 캐릭터 위에만 표시했습니다."
              : "Shown on your character only."
            : result.missed.length === 0
              ? ko
                ? `${result.delivered}명에게 보냈습니다.`
                : `Sent to ${result.delivered}.`
              : ko
                ? `${result.delivered}명에게 보냈습니다. 못 받은 사람: ${result.missed.join(", ")}`
                : `Sent to ${result.delivered}. Missed: ${result.missed.join(", ")}`,
        );
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  if (fill) {
    return (
      <div className="flex flex-col bg-base-100" style={{ width: DOCK_WIDTH, height: dockH }}>
        <div className="flex shrink-0 items-center gap-1.5 px-2" style={{ height: DOCK_SEARCH }}>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={ko ? "이름 검색" : "Search names"}
            className="min-w-0 flex-1 bg-transparent text-xs text-base-content outline-none placeholder:text-base-content/35"
          />
          <button type="button" className="shrink-0 text-[11px] text-primary" onClick={selectAll}>
            {ko ? "전체" : "All"}
          </button>
          <button type="button" className="shrink-0 text-[11px] text-base-content/50" onClick={clearAll}>
            {ko ? "해제" : "Clear"}
          </button>
        </div>
        <div className="overflow-y-auto px-2" style={{ height: dockRows * DOCK_ROW }}>
          {visible.length === 0 ? (
            <p className="flex items-center text-[11px] text-base-content/40" style={{ height: DOCK_ROW }}>
              {ko ? "없음" : "None"}
            </p>
          ) : (
            visible.map((person) => {
              const on = selected.includes(person.id);
              return (
                <button
                  key={person.id}
                  type="button"
                  onClick={() => toggle(person.id)}
                  className={clsx(
                    "flex w-full items-center justify-between text-left text-xs",
                    on ? "text-primary" : "text-base-content/55",
                  )}
                  style={{ height: DOCK_ROW }}
                >
                  <span className="truncate">{person.label}</span>
                  {on ? <span className="shrink-0 text-[11px]">✓</span> : null}
                </button>
              );
            })
          )}
        </div>
        <form
          className="flex shrink-0 items-center gap-1.5 border-t border-base-300 px-2"
          style={{ height: DOCK_MESSAGE }}
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={status ?? (ko ? "메시지" : "Message")}
            maxLength={80}
            className="min-w-0 flex-1 bg-transparent text-xs text-base-content outline-none placeholder:text-base-content/35"
          />
          <button
            type="submit"
            disabled={sending || draft.trim().length === 0 || selectedCount === 0}
            className="shrink-0 text-[11px] leading-none text-primary disabled:opacity-40"
          >
            {ko ? "보내기" : "Send"}
          </button>
          {onClose ? (
            <button type="button" className="shrink-0 text-xs leading-none text-base-content/40" onClick={onClose}>
              ×
            </button>
          ) : null}
        </form>
      </div>
    );
  }

  const summary =
    selectedCount === 0
      ? ko
        ? "받는 사람을 고르세요"
        : "Choose who receives this"
      : selectedCount === people.length
        ? ko
          ? "팀 전체"
          : "Everyone"
        : people
            .filter((person) => selected.includes(person.id))
            .map((person) => person.label)
            .join(", ");

  return (
    <div
      className={clsx(
        "bg-base-100 px-3 py-3",
        fill ? "flex min-h-0 flex-1 flex-col" : "shrink-0 space-y-2 border-t border-base-300",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium text-base-content/50">{ko ? "받는 사람" : "To"}</span>
        <span className="flex items-center gap-2">
          <button type="button" className="text-xs text-primary" onClick={selectAll}>
            {ko ? "전체" : "All"}
          </button>
          <button type="button" className="text-xs text-base-content/50" onClick={clearAll}>
            {ko ? "해제" : "Clear"}
          </button>
        </span>
      </div>
      <p className="mt-1 truncate text-xs text-base-content/55">{summary}</p>
      {people.length > 6 ? (
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={ko ? "팀원 검색" : "Search teammates"}
          className="mt-2"
        />
      ) : null}
      <div
        className={clsx(
          "mt-2 flex flex-wrap content-start gap-1.5",
          fill ? "min-h-0 flex-1 overflow-y-auto" : "max-h-28 overflow-y-auto",
        )}
      >
        {visible.length === 0 ? (
          <p className="text-xs text-base-content/40">{ko ? "표시할 팀원이 없습니다." : "No teammates to show."}</p>
        ) : (
          visible.map((person) => {
            const on = selected.includes(person.id);
            return (
              <button
                key={person.id}
                type="button"
                onClick={() => toggle(person.id)}
                className={clsx(
                  "rounded-full px-2.5 py-1 text-xs",
                  on ? "bg-primary/15 text-primary" : "bg-base-200 text-base-content/70",
                )}
              >
                {person.label}
                {person.local ? (
                  <span className="ml-1 text-[10px] text-base-content/40">{ko ? "로컬" : "local"}</span>
                ) : null}
              </button>
            );
          })
        )}
      </div>
      <form
        className={clsx("flex items-center gap-2", fill ? "mt-3" : "mt-2")}
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={ko ? "메시지" : "Message"}
          maxLength={80}
        />
        <Button
          variant="primary"
          size="sm"
          disabled={sending || draft.trim().length === 0 || selectedCount === 0}
          onClick={() => void send()}
        >
          {ko ? "보내기" : "Send"}
        </Button>
      </form>
      {status ? <p className="mt-2 truncate text-xs text-base-content/55">{status}</p> : null}
    </div>
  );
}
