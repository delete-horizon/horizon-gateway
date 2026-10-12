import { useAtom, useAtomValue } from "jotai";
import { Check, Database, X } from "lucide-react";
import { useState } from "react";
import { languageAtom } from "@/entities/app";
import { commands, unwrap } from "@/shared/api";
import { createMockModalAtom } from "@/shared/store/modals";
import { Button } from "@/shared/ui/button/Button";
import { Card } from "@/shared/ui/card/card";
import { toastError, toastSuccess } from "@/shared/ui/toast";

const en = {
  saved: "Snapshot saved.",
  saveFailed: (message: string) => `Could not save the snapshot: ${message}`,
  unknownError: "Unknown error",
  saveError: (message: string) => `Error while saving: ${message}`,
  title: "Save mock rule",
  description: "Save the selected response as a mock rule.",
  saving: "Saving...",
  save: "Save rule",
};

const ko: typeof en = {
  saved: "성공적으로 스냅샷이 저장되었습니다.",
  saveFailed: (message: string) => `스냅샷 저장 실패: ${message}`,
  unknownError: "알 수 없는 오류",
  saveError: (message: string) => `저장 중 에러 발생: ${message}`,
  title: "모킹 규칙 저장",
  description: "선택한 응답을 모킹 규칙으로 저장합니다.",
  saving: "저장 중...",
  save: "규칙 저장",
};

export function CreateMockModal() {
  const lang = useAtomValue(languageAtom);
  const t = lang === "ko" ? ko : en;
  const [modalState, setModalState] = useAtom(createMockModalAtom);
  const { isOpen, logData, onSuccess } = modalState;
  const [isSaving, setIsSaving] = useState(false);

  if (!isOpen || !logData) {
    return null;
  }

  const handleClose = () => {
    setModalState((prev) => ({ ...prev, isOpen: false }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = unwrap(
        await commands.createMockRuleFromLog({
          logId: logData.id,
          scenarioId: null,
          name: `${logData.method} ${logData.path}`,
          logDate: logData.timestamp.slice(0, 10),
        }),
      );

      if (res.success) {
        toastSuccess(t.saved);
        handleClose();
        onSuccess?.();
      } else {
        toastError(t.saveFailed(res.message || t.unknownError));
      }
    } catch (err) {
      toastError(t.saveError(String(err)));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[1000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-10 animate-in fade-in zoom-in-95 duration-200"
      onClick={handleClose}
    >
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md">
        <Card className="bg-base-100 p-6 shadow-2xl flex flex-col gap-6">
          <div className="flex justify-between items-center border-b border-base-200 pb-4">
            <h3 className="text-xl font-bold flex items-center gap-2 text-primary">
              <Database className="w-5 h-5" /> {t.title}
            </h3>
            <button type="button" onClick={handleClose}>
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-2 text-sm">
            <p className="text-base-content/70">{t.description}</p>
            <div className="rounded-xl border border-base-300 bg-base-200/40 p-3 font-mono text-xs space-y-1">
              <p>
                <span className="font-black">{logData.method}</span> {logData.path}
              </p>
              <p className="text-base-content/50">{logData.host}</p>
              <p className="text-base-content/50">→ {logData.status_code ?? "?"}</p>
            </div>
          </div>

          <Button
            variant="primary"
            className="w-full h-12 gap-2 text-lg font-black"
            onClick={() => void handleSave()}
            disabled={isSaving}
          >
            <Check className="w-5 h-5" /> {isSaving ? t.saving : t.save}
          </Button>
        </Card>
      </div>
    </div>
  );
}
