import { createFileRoute } from "@tanstack/react-router";
import { listen } from "@tauri-apps/api/event";
import { useAtom, useAtomValue } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { CheckCircle2, Circle, Download, RotateCcw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { languageAtom } from "@/entities/app";
import { ProxyServerWarning } from "@/entities/proxy";
import type { ProxyStatusPayload } from "@/shared/api";
import { commands, unwrap } from "@/shared/api";
import { saveTextDownload } from "@/shared/lib/tauri/saveDownload";
import { Button } from "@/shared/ui/button/Button";
import { Card } from "@/shared/ui/card/card";
import { toastError, toastSuccess } from "@/shared/ui/toast";
import { H1, H2, P } from "@/shared/ui/typography/typography";
import { en } from "./en";
import { ko } from "./ko";

export const Route = createFileRoute("/proxy/setup/")({
  component: ProxySetupPage,
});

interface SetupChecklist {
  certSaved: boolean;
  certInstalled: boolean;
  proxyConfigured: boolean;
}

const defaultChecklist: SetupChecklist = {
  certSaved: false,
  certInstalled: false,
  proxyConfigured: false,
};

const setupChecklistAtom = atomWithStorage<SetupChecklist>("horizon-gateway-mitm-checklist", defaultChecklist);

function ProxySetupPage() {
  const lang = useAtomValue(languageAtom);
  const t = lang === "ko" ? ko : en;

  const [checklist, setChecklist] = useAtom(setupChecklistAtom);
  const [proxyStatus, setProxyStatus] = useState<ProxyStatusPayload>({
    running: false,
    port: 0,
    reverse_http_port: null,
    reverse_https_port: null,
  });
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await commands.getProxyStatus().then(unwrap);
      if (res.success && res.data) {
        setProxyStatus(res.data);
      }
    } catch (e) {
      console.error("get_proxy_status:", e);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
    const unlisten = listen<ProxyStatusPayload>("proxy-status-changed", (ev) => {
      setProxyStatus(ev.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [fetchStatus]);

  const startProxy = async () => {
    setStarting(true);
    try {
      await commands.startLocalProxy(null).then(unwrap);
      await fetchStatus();
    } catch (e) {
      console.error("start_local_proxy:", e);
    } finally {
      setStarting(false);
    }
  };

  const toggleItem = (key: keyof SetupChecklist) => {
    setChecklist((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const resetChecklist = () => {
    setChecklist(defaultChecklist);
  };

  const handleSaveCA = async () => {
    setSaving(true);
    try {
      const exported = await commands.saveRootCa().then(unwrap);
      if (!exported.success || !exported.data) {
        throw new Error(exported.message || t.certSaveFailed);
      }
      const saved = await saveTextDownload({
        content: exported.data,
        defaultPath: "horizon-gateway-root-ca.crt",
        filters: [{ name: "Certificate", extensions: ["crt", "pem"] }],
        mimeType: "application/x-pem-file",
      });
      if (saved.status === "cancelled") {
        return;
      }
      toastSuccess(t.certSaved);
      setChecklist((prev) => ({ ...prev, certSaved: true }));
    } catch (e) {
      console.error("save_root_ca:", e);
      toastError(t.certSaveFailed);
    } finally {
      setSaving(false);
    }
  };

  const port = proxyStatus.running ? proxyStatus.port : 0;
  const pacUrl = port > 0 ? `http://127.0.0.1:${port}/.horizon-gateway/proxy.pac` : "";
  const allDone = checklist.certSaved && checklist.certInstalled && checklist.proxyConfigured;

  return (
    <div className="flex flex-col gap-6 max-w-3xl mx-auto w-full pb-16">
      <header className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 text-primary rounded-xl">
          <ShieldCheck className="w-6 h-6" />
        </div>
        <div>
          <H1 className="text-2xl tablet:text-3xl font-black tracking-tight text-base-content">{t.title}</H1>
        </div>
      </header>

      <ProxyServerWarning onStartProxy={startProxy} loading={starting} />

      {!proxyStatus.running && (
        <Card className="p-6 flex flex-col items-start gap-3 border-warning/30 bg-warning/5">
          <P className="text-sm text-warning font-medium">{t.notRunning}</P>
        </Card>
      )}

      {/* Checklist */}
      <section className="space-y-2">
        <H2>{t.checklistTitle}</H2>
        <p className="text-xs text-base-content/55 leading-relaxed">{t.checklistDesc}</p>
        <Card className="p-5 space-y-3">
          <div className="flex justify-end">
            <Button variant="secondary" size="sm" className="gap-1.5 shrink-0" onClick={resetChecklist}>
              <RotateCcw className="w-3.5 h-3.5" />
              {t.checklistReset}
            </Button>
          </div>

          <div className="space-y-1 divide-y divide-base-200">
            {(
              [
                ["certSaved", t.checklistCertSaved],
                ["certInstalled", t.checklistCertInstalled],
                ["proxyConfigured", t.checklistProxyConfigured],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => toggleItem(key)}
                className="w-full flex items-center gap-3 py-2.5 hover:bg-base-200/50 transition-colors text-left"
              >
                {checklist[key] ? (
                  <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
                ) : (
                  <Circle className="w-5 h-5 text-base-content/30 shrink-0" />
                )}
                <span
                  className={`text-sm font-medium ${checklist[key] ? "text-base-content/60 line-through" : "text-base-content"}`}
                >
                  {label}
                </span>
              </button>
            ))}
          </div>

          {allDone && <p className="text-success text-sm font-semibold text-center py-2">{t.checklistAllDone}</p>}
        </Card>
      </section>

      {/* Root CA */}
      <section className="space-y-2">
        <H2>{t.certTitle}</H2>
        <p className="text-xs text-base-content/55 leading-relaxed">{t.certDesc}</p>
        <Card className="p-5 space-y-3">
          <Button variant="primary" size="sm" className="gap-1.5" onClick={handleSaveCA} disabled={saving}>
            <Download className="w-3.5 h-3.5" />
            {t.saveCertBtn}
          </Button>

          <div className="pt-3 border-t border-base-200 space-y-2">
            <h3 className="text-sm font-semibold text-base-content">{t.installationStepsTitle}</h3>
            <ol className="space-y-1.5 text-xs text-base-content/55 leading-relaxed list-decimal list-inside">
              <li>{t.step1}</li>
              <li>{t.step2}</li>
              <li>{t.step3}</li>
              <li>{t.step4}</li>
              <li>{t.step5}</li>
              <li>{t.step6}</li>
              <li>{t.step7}</li>
            </ol>
          </div>

          <p className="text-info text-xs leading-relaxed">{t.macosUsers}</p>
        </Card>
      </section>

      {/* PAC / Manual proxy */}
      <section className="space-y-2">
        <H2>{t.pacTitle}</H2>
        <p className="text-xs text-base-content/55 leading-relaxed">{t.pacDesc}</p>
        <Card className="p-5 space-y-3">
          <code className="block text-xs font-mono break-all text-primary/80">{pacUrl || "—"}</code>
          <div className="text-xs text-base-content/55 space-y-1">
            <p>{t.pacWindows}</p>
            <p>{t.pacMacos}</p>
          </div>

          <div className="pt-3 border-t border-base-200 space-y-2">
            <h3 className="text-sm font-bold text-base-content">{t.manualTitle}</h3>
            <P className="text-xs text-base-content/55">{t.manualDesc}</P>
            <div className="grid grid-cols-2 gap-3 max-w-xs">
              <div className="space-y-0.5">
                <p className="text-[10px] font-medium text-base-content/50">{t.manualAddress}</p>
                <p className="text-sm font-mono font-semibold">127.0.0.1</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-[10px] font-medium text-base-content/50">{t.manualPort}</p>
                <p className="text-sm font-mono font-semibold">{port || "—"}</p>
              </div>
            </div>
          </div>
        </Card>
      </section>
    </div>
  );
}
