import { useAtomValue, useSetAtom } from "jotai";
import { Download, Smartphone } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { languageAtom } from "@/entities/app";
import { ProxyServerWarning, proxyStatusAtom } from "@/entities/proxy";
import { openPopupWindow } from "@/features/popup-window";
import type { ProxyStatusPayload } from "@/shared/api";
import { commands, unwrap } from "@/shared/api";
import { listen } from "@/shared/lib/tauri/client";
import { notifyHubDataChanged } from "@/shared/lib/tauri/hubEvents";
import { Button } from "@/shared/ui/button/Button";
import { Card } from "@/shared/ui/card/card";
import { popupEn } from "../i18n/en";
import { popupKo } from "../i18n/ko";

export function InfrastructureContent() {
  const lang = useAtomValue(languageAtom);
  const t = lang === "ko" ? popupKo : popupEn;
  const setGlobalProxyStatus = useSetAtom(proxyStatusAtom);
  const [proxyStatus, setProxyStatus] = useState<ProxyStatusPayload>({
    running: false,
    port: 0,
    reverse_http_port: null,
    reverse_https_port: null,
  });
  const [loading, setLoading] = useState(false);

  const applyStatus = useCallback(
    (data: ProxyStatusPayload) => {
      setProxyStatus(data);
      setGlobalProxyStatus({
        running: data.running ?? false,
        port: data.port ?? null,
        reverse_http_port: data.reverse_http_port ?? null,
        reverse_https_port: data.reverse_https_port ?? null,
      });
    },
    [setGlobalProxyStatus],
  );

  const fetchStatus = useCallback(async () => {
    try {
      const res = await commands.getProxyStatus().then(unwrap);
      if (res.success && res.data) {
        applyStatus(res.data);
      }
    } catch (e) {
      console.error(e);
    }
  }, [applyStatus]);

  useEffect(() => {
    void fetchStatus();
    const unlisten = listen<ProxyStatusPayload>("proxy-status-changed", (ev) => {
      applyStatus(ev.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [fetchStatus, applyStatus]);

  const toggleProxy = async () => {
    setLoading(true);
    try {
      if (proxyStatus.running) {
        await commands.stopLocalProxy().then(unwrap);
      } else {
        await commands.startLocalProxy(null).then(unwrap);
      }
      await fetchStatus();
      await notifyHubDataChanged("features");
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveCA = async () => {
    try {
      await commands.saveRootCa().then(unwrap);
    } catch (e) {
      if (e !== "Save cancelled") {
        console.error(e);
      }
    }
  };

  const port = proxyStatus.running ? proxyStatus.port : 0;
  const pacUrl = port > 0 ? `http://127.0.0.1:${port}/.horizon-gateway/proxy.pac` : "";

  return (
    <div className="space-y-6">
      <ProxyServerWarning onStartProxy={toggleProxy} loading={loading} />

      <section className="space-y-2 min-w-0">
        <h2 className="text-sm font-semibold text-base-content">{t.infraProxy}</h2>
        <Card className="p-3 @min-[32rem]:p-4 space-y-3 min-w-0">
          <p className="text-xs text-base-content/55 leading-relaxed">{t.infraProxyDesc}</p>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-base-content/40">
              {proxyStatus.running
                ? lang === "ko"
                  ? `포트 ${proxyStatus.port}`
                  : `Port ${proxyStatus.port}`
                : t.infraStopped}
            </p>
            <Button
              variant={proxyStatus.running ? "secondary" : "primary"}
              size="sm"
              onClick={toggleProxy}
              disabled={loading}
            >
              {proxyStatus.running ? t.infraStop : t.infraStart}
            </Button>
          </div>
        </Card>
      </section>

      {proxyStatus.running && (
        <>
          <section className="space-y-2 min-w-0">
            <h2 className="text-sm font-semibold text-base-content">{t.infraCert}</h2>
            <Card className="p-3 @min-[32rem]:p-4 space-y-3 min-w-0">
              <p className="text-xs text-base-content/55 leading-relaxed">{t.infraCertDesc}</p>
              <Button variant="primary" size="sm" className="gap-1.5" onClick={handleSaveCA}>
                <Download className="w-3.5 h-3.5" />
                {t.infraCertSave}
              </Button>
            </Card>
          </section>

          <section className="space-y-2 min-w-0">
            <h2 className="text-sm font-semibold text-base-content">{t.infraPac}</h2>
            <Card className="p-3 @min-[32rem]:p-4 space-y-3 min-w-0">
              <p className="text-xs text-base-content/55 leading-relaxed">{t.infraPacDesc}</p>
              <code className="block text-xs font-mono bg-base-200 p-3 rounded-lg break-all text-indigo-600 dark:text-indigo-400">
                {pacUrl || "—"}
              </code>
            </Card>
          </section>

          <section className="space-y-2 min-w-0">
            <h2 className="text-sm font-semibold text-base-content">{t.infraMobile}</h2>
            <Card className="p-3 @min-[32rem]:p-4 space-y-3 min-w-0">
              <p className="text-xs text-base-content/55 leading-relaxed">{t.infraMobileDesc}</p>
              <Button
                variant="secondary"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  void openPopupWindow("mobile");
                }}
              >
                <Smartphone className="w-3.5 h-3.5" />
                {t.infraMobileOpen}
              </Button>
            </Card>
          </section>
        </>
      )}
    </div>
  );
}
