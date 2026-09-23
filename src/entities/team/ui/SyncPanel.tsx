import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toastError, toastSuccess } from "@/shared/ui/toast";
import { deleteRemoteResourceItem, upsertRemoteResourceItem } from "../api";
import type { TeamWorkspaceController } from "../model/useTeamWorkspace";
import { DEFAULT_SYNC_OPTIONS } from "../sync";
import { buildCatalogCountsFromSnapshot, loadSyncSnapshot, SYNC_CATALOG_KINDS, type SyncSnapshot } from "../syncDiff";
import type { ResourceKind } from "../types";
import { SyncActionBar } from "./SyncActionBar";
import { emptyCatalogCounts, type SyncCatalogCounts, SyncCatalogPane } from "./SyncCatalogPane";
import { SyncDiffListPane } from "./SyncDiffListPane";

interface SyncPanelProps {
  ctrl: TeamWorkspaceController;
  onClose?: () => void;
}

export function SyncPanel({ ctrl, onClose }: SyncPanelProps) {
  const { lang, activeWorkspaceId, syncing, handleExecuteSync, isWorkspaceAdmin } = ctrl;
  const [activeKind, setActiveKind] = useState<ResourceKind>("domains");
  const [syncAction, setSyncAction] = useState<"push" | "pull">("push");
  const [catalogCounts, setCatalogCounts] = useState<Partial<Record<ResourceKind, SyncCatalogCounts>>>({});
  const [snapshot, setSnapshot] = useState<SyncSnapshot | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [managingRemote, setManagingRemote] = useState(false);

  const handleCountsChange = useCallback((kind: ResourceKind, counts: SyncCatalogCounts) => {
    setCatalogCounts((prev) => ({ ...prev, [kind]: counts }));
  }, []);

  const reloadSnapshot = useCallback(async () => {
    if (!activeWorkspaceId) {
      setSnapshot(null);
      return;
    }
    setSnapshotLoading(true);
    try {
      const next = await loadSyncSnapshot(activeWorkspaceId);
      setSnapshot(next);
      setCatalogCounts(buildCatalogCountsFromSnapshot(next, DEFAULT_SYNC_OPTIONS.matchKey));
    } catch (e) {
      console.warn("SyncPanel loadSyncSnapshot:", e);
      setSnapshot(null);
      setCatalogCounts(Object.fromEntries(SYNC_CATALOG_KINDS.map((kind) => [kind, emptyCatalogCounts(kind)])));
    } finally {
      setSnapshotLoading(false);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    void reloadSnapshot();
  }, [reloadSnapshot]);

  const handleSync = async (options: Parameters<typeof handleExecuteSync>[1]) => {
    const ok = await handleExecuteSync(syncAction, options, { stayOpen: true });
    if (ok) {
      await reloadSnapshot();
    }
  };

  const handleDeleteRemoteItem = async (kind: ResourceKind, itemId: string | number): Promise<boolean> => {
    if (!activeWorkspaceId || !isWorkspaceAdmin) {
      return false;
    }
    setManagingRemote(true);
    try {
      await deleteRemoteResourceItem(activeWorkspaceId, kind, itemId);
      toastSuccess(lang === "ko" ? "서버에서 삭제했습니다." : "Deleted from server.");
      await reloadSnapshot();
      return true;
    } catch (e) {
      console.error(e);
      toastError(lang === "ko" ? "서버 삭제에 실패했습니다." : "Failed to delete from server.");
      return false;
    } finally {
      setManagingRemote(false);
    }
  };

  const handleUpsertRemoteItem = async (
    kind: ResourceKind,
    item: Record<string, unknown>,
    options?: { replaceId?: string | number },
  ): Promise<boolean> => {
    if (!activeWorkspaceId || !isWorkspaceAdmin) {
      return false;
    }
    setManagingRemote(true);
    try {
      await upsertRemoteResourceItem(activeWorkspaceId, kind, item, options);
      toastSuccess(lang === "ko" ? "서버에 저장했습니다." : "Saved to server.");
      await reloadSnapshot();
      return true;
    } catch (e) {
      console.error(e);
      toastError(lang === "ko" ? "서버 저장에 실패했습니다." : "Failed to save to server.");
      return false;
    } finally {
      setManagingRemote(false);
    }
  };

  if (!activeWorkspaceId) {
    return null;
  }

  return (
    <div className="flex flex-col h-full min-h-0 shrink-0 flex-1 min-w-[680px] max-w-[920px] border-r border-base-300 bg-base-100">
      <div className="flex items-center gap-2 h-10 px-3 border-b border-base-300 bg-base-200/80 shrink-0">
        <span className="text-primary shrink-0">
          <RefreshCw
            className={`w-3.5 h-3.5 ${snapshotLoading || syncing !== null || managingRemote ? "animate-spin" : ""}`}
          />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-black text-base-content truncate">
            {lang === "ko" ? "설정 동기화" : "Settings sync"}
          </p>
          <p className="text-[10px] text-base-content/45 font-medium truncate">
            {lang === "ko" ? "카테고리 → Push/Pull → 항목 선택" : "Category → Push/Pull → select items"}
          </p>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="text-[10px] font-bold px-2 py-1 rounded-md text-base-content/50 hover:text-base-content hover:bg-base-200"
          >
            {lang === "ko" ? "닫기" : "Close"}
          </button>
        ) : null}
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <SyncCatalogPane
          lang={lang}
          activeKind={activeKind}
          onSelectKind={setActiveKind}
          counts={catalogCounts}
          loading={snapshotLoading || syncing !== null || managingRemote}
        />

        <div className="flex flex-col flex-1 min-h-0 min-w-[360px]">
          <SyncActionBar
            lang={lang}
            action={syncAction}
            onActionChange={setSyncAction}
            disabled={syncing !== null || snapshotLoading || managingRemote}
          />
          <SyncDiffListPane
            lang={lang}
            action={syncAction}
            kind={activeKind}
            snapshot={snapshot}
            snapshotLoading={snapshotLoading}
            busy={syncing !== null}
            canManageRemote={isWorkspaceAdmin}
            managingRemote={managingRemote}
            onCountsChange={handleCountsChange}
            onRefresh={() => void reloadSnapshot()}
            onSync={(options) => void handleSync(options)}
            onDeleteRemoteItem={handleDeleteRemoteItem}
            onUpsertRemoteItem={handleUpsertRemoteItem}
          />
        </div>
      </div>
    </div>
  );
}
