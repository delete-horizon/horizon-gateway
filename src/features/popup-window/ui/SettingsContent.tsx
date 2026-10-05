import { listen } from "@tauri-apps/api/event";
import clsx from "clsx";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  RefreshCw,
  Server,
  ShieldAlert,
  SlidersHorizontal,
  Smartphone,
  Upload,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useId, useState } from "react";
import {
  closeBehaviorAtom,
  languageAtom,
  minimizeBehaviorAtom,
  windowBehaviorEn,
  windowBehaviorKo,
} from "@/entities/app";
import {
  proxyPortInputAtom,
  proxyReverseHttpPortInputAtom,
  proxyReverseHttpsPortInputAtom,
  proxyStatusAtom,
} from "@/entities/proxy";
import { MobileConnectionContent } from "@/features/mobile-connection";
import { UpdateBanner, useUpdateCheck } from "@/features/update";
import type {
  OsAppEntry,
  ProxySettings,
  ProxyStatusPayload,
  SettingsExport_Serialize,
  TransparentProxyStatus,
} from "@/shared/api";
import { commands, unwrap } from "@/shared/api";
import { notifyHubDataChanged } from "@/shared/lib/tauri/hubEvents";
import { useIsSecondaryWindow } from "@/shared/lib/tauri/useEmbedMode";
import { Button } from "@/shared/ui/button/Button";
import { Card } from "@/shared/ui/card/card";
import { Input } from "@/shared/ui/input/Input";
import { reportError, toastError, toastSuccess } from "@/shared/ui/toast";
import { settingsEn } from "../i18n/settings-en";
import { settingsKo } from "../i18n/settings-ko";

type SettingsTab = "proxy" | "app";
type SettingsCopy = { [K in keyof typeof settingsEn]: string };

function WindowBehaviorRadios<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { id: T; label: string; hint: string }[];
}) {
  return (
    <fieldset className="space-y-2 min-w-0">
      <legend className="text-[10px] font-medium text-base-content/50">{label}</legend>
      <div className="flex flex-col gap-2">
        {options.map((opt) => (
          <label key={opt.id} className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              className="radio radio-sm radio-primary mt-0.5 shrink-0"
              name={label}
              checked={value === opt.id}
              onChange={() => onChange(opt.id)}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-base-content">{opt.label}</span>
              <span className="block text-[11px] text-base-content/50 leading-snug mt-0.5">{opt.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Section({ title, desc, children }: { title?: string; desc?: string; children: ReactNode }) {
  return (
    <section className="space-y-2 min-w-0">
      {title && <h2 className="text-sm font-semibold text-base-content">{title}</h2>}
      {desc && <p className="text-xs text-base-content/55 leading-relaxed">{desc}</p>}
      <Card className="p-3 @min-[32rem]:p-4 space-y-3 min-w-0">{children}</Card>
    </section>
  );
}

function SettingSwitch({
  title,
  desc,
  checked,
  onChange,
  loading,
  label,
}: {
  title: string;
  desc?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  loading?: boolean;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 min-w-0">
      <div className="min-w-0">
        <p className="text-xs font-bold text-base-content">{title}</p>
        {desc && <p className="text-[10px] text-base-content/50 mt-0.5 leading-relaxed">{desc}</p>}
      </div>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        className="toggle toggle-success toggle-sm shrink-0"
        checked={checked}
        disabled={loading}
        onChange={(e) => onChange(e.target.checked)}
      />
    </div>
  );
}

function SettingsNav({
  tab,
  onChange,
  t,
  side,
}: {
  tab: SettingsTab;
  onChange: (tab: SettingsTab) => void;
  t: SettingsCopy;
  side: boolean;
}) {
  const items: { id: SettingsTab; label: string; icon: typeof Server }[] = [
    { id: "proxy", label: t.tabProxy, icon: Server },
    { id: "app", label: t.tabApp, icon: SlidersHorizontal },
  ];

  const move = (from: SettingsTab, delta: number) => {
    const index = items.findIndex((item) => item.id === from);
    const next = items[(index + delta + items.length) % items.length];
    if (next) {
      onChange(next.id);
      requestAnimationFrame(() => {
        document.getElementById(`settings-tab-${next.id}`)?.focus();
      });
    }
  };

  return (
    <nav
      className={clsx(
        "grid grid-cols-2 p-1.5 gap-1",
        side && "@min-[40rem]:flex @min-[40rem]:flex-col @min-[40rem]:p-2",
      )}
      role="tablist"
      aria-label={t.navLabel}
    >
      {items.map((item) => {
        const Icon = item.icon;
        const selected = tab === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`settings-tab-${item.id}`}
            aria-selected={selected}
            aria-controls={`settings-panel-${item.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                move(item.id, 1);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                move(item.id, -1);
              } else if (e.key === "Home") {
                e.preventDefault();
                onChange(items[0].id);
                requestAnimationFrame(() => {
                  document.getElementById(`settings-tab-${items[0].id}`)?.focus();
                });
              } else if (e.key === "End") {
                e.preventDefault();
                const last = items[items.length - 1];
                onChange(last.id);
                requestAnimationFrame(() => {
                  document.getElementById(`settings-tab-${last.id}`)?.focus();
                });
              }
            }}
            className={clsx(
              "flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-[11px] font-bold transition-colors min-w-0",
              side && "@min-[40rem]:justify-start @min-[40rem]:gap-2 @min-[40rem]:text-xs",
              selected
                ? "bg-primary/15 text-primary"
                : "text-base-content/55 hover:bg-base-200 hover:text-base-content",
            )}
          >
            <Icon className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export function SettingsContent() {
  const isWindow = useIsSecondaryWindow();
  const [tab, setTab] = useState<SettingsTab>("proxy");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [transparentOpen, setTransparentOpen] = useState(false);
  const [pacCopied, setPacCopied] = useState(false);
  const [proxySettings, setProxySettings] = useState<ProxySettings | null>(null);
  const [dnsServerInput, setDnsServerInput] = useState("");
  const [tlsBypassDraft, setTlsBypassDraft] = useState("");
  const [connectTimeoutInput, setConnectTimeoutInput] = useState("15");
  const [upstreamTimeoutInput, setUpstreamTimeoutInput] = useState("30");
  const [engineSaving, setEngineSaving] = useState(false);
  const lang = useAtomValue(languageAtom);
  const globalProxyStatus = useAtomValue(proxyStatusAtom);
  const setGlobalProxyStatus = useSetAtom(proxyStatusAtom);
  const [closeBehavior, setCloseBehavior] = useAtom(closeBehaviorAtom);
  const [minimizeBehavior, setMinimizeBehavior] = useAtom(minimizeBehaviorAtom);
  const { update, isChecking, error: updateError, checkForUpdates } = useUpdateCheck({ onMount: false });
  const dnsFieldId = useId();
  const tpPortId = useId();

  const [proxyStatus, setProxyStatus] = useState<ProxyStatusPayload>({
    running: false,
    port: 0,
    reverse_http_port: null,
    reverse_https_port: null,
  });
  const [proxyPortInput, setProxyPortInput] = useAtom(proxyPortInputAtom);
  const [reverseHttpInput, setReverseHttpInput] = useAtom(proxyReverseHttpPortInputAtom);
  const [reverseHttpsInput, setReverseHttpsInput] = useAtom(proxyReverseHttpsPortInputAtom);
  const [proxyLoading, setProxyLoading] = useState(false);
  const [proxyPortSaving, setProxyPortSaving] = useState(false);
  const [transparentStatus, setTransparentStatus] = useState<TransparentProxyStatus>({
    running: false,
    targetPort: 0,
    activeConnections: 0,
    errorMessage: null,
    experimental: true,
    processAllowlist: [],
  });
  const [transparentLoading, setTransparentLoading] = useState(false);
  const [osApps, setOsApps] = useState<OsAppEntry[]>([]);
  const [selectedApps, setSelectedApps] = useState<string[]>([]);
  const [scanLoading, setScanLoading] = useState(false);
  const [showAdvancedPort, setShowAdvancedPort] = useState(false);
  const [advancedPortInput, setAdvancedPortInput] = useState("");

  const t = lang === "ko" ? settingsKo : settingsEn;
  const wt = lang === "ko" ? windowBehaviorKo : windowBehaviorEn;
  const pacUrl =
    proxyStatus.running && proxyStatus.port > 0
      ? `http://127.0.0.1:${proxyStatus.port}/.horizon-gateway/proxy.pac`
      : "";

  const applyProxyStatus = useCallback(
    (data: ProxyStatusPayload) => {
      setProxyStatus(data);
      setGlobalProxyStatus({
        running: data.running,
        port: data.port,
        reverse_http_port: data.reverse_http_port,
        reverse_https_port: data.reverse_https_port,
      });
    },
    [setGlobalProxyStatus],
  );

  const fetchProxyStatus = useCallback(async () => {
    try {
      const res = await commands.getProxyStatus().then(unwrap);
      if (res.success && res.data) {
        applyProxyStatus(res.data);
      }
    } catch (e) {
      console.error("get_proxy_status:", e);
    }
  }, [applyProxyStatus]);

  const fetchTransparentStatus = useCallback(async () => {
    try {
      const res = await commands.getTransparentProxyStatus().then(unwrap);
      if (res.success && res.data) {
        setTransparentStatus(res.data);
        if (res.data.processAllowlist.length > 0) {
          setSelectedApps(res.data.processAllowlist);
        }
        if (res.data.targetPort > 0) {
          setAdvancedPortInput(String(res.data.targetPort));
        }
      }
    } catch (e) {
      console.error("get_transparent_proxy_status:", e);
    }
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const proxyRes = await commands.getProxySettings().then(unwrap);
      if (proxyRes.success && proxyRes.data) {
        setProxySettings(proxyRes.data);
        setDnsServerInput(proxyRes.data.dns_server ?? "");
        setTlsBypassDraft((proxyRes.data.tls_bypass_hosts ?? []).join("\n"));
        setConnectTimeoutInput(String(proxyRes.data.connect_timeout_secs ?? 15));
        setUpstreamTimeoutInput(String(proxyRes.data.upstream_timeout_secs ?? 30));
        setProxyPortInput(String(proxyRes.data.proxy_port));
        setReverseHttpInput(proxyRes.data.reverse_http_port != null ? String(proxyRes.data.reverse_http_port) : "");
        setReverseHttpsInput(proxyRes.data.reverse_https_port != null ? String(proxyRes.data.reverse_https_port) : "");
      }
    } catch (e) {
      console.error("fetchSettings:", e);
    }
  }, [setProxyPortInput, setReverseHttpInput, setReverseHttpsInput]);

  useEffect(() => {
    if (!globalProxyStatus) {
      return;
    }
    setProxyStatus({
      running: Boolean(globalProxyStatus.running),
      port: globalProxyStatus.port ?? 0,
      reverse_http_port: globalProxyStatus.reverse_http_port ?? null,
      reverse_https_port: globalProxyStatus.reverse_https_port ?? null,
    });
  }, [globalProxyStatus]);

  useEffect(() => {
    fetchSettings();
    void fetchProxyStatus();
    void fetchTransparentStatus();

    const unlisten = listen<ProxyStatusPayload>("proxy-status-changed", (ev) => {
      if (ev.payload) {
        applyProxyStatus(ev.payload);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [fetchSettings, fetchProxyStatus, fetchTransparentStatus, applyProxyStatus]);

  useEffect(() => {
    if (!proxyStatus.running) {
      setMobileOpen(false);
    }
  }, [proxyStatus.running]);

  const handleToggleProxy = async (enabled: boolean) => {
    setProxyLoading(true);
    try {
      const res = enabled
        ? await commands.startLocalProxy(null).then(unwrap)
        : await commands.stopLocalProxy().then(unwrap);
      if (res.success && res.data) {
        applyProxyStatus(res.data);
      }
      await notifyHubDataChanged("features");
      void fetchTransparentStatus();
    } catch (e) {
      reportError(e);
    } finally {
      setProxyLoading(false);
    }
  };

  const handleScanOsApps = async () => {
    setScanLoading(true);
    try {
      const res = await commands.scanOsApps().then(unwrap);
      if (res.success && res.data) {
        setOsApps(res.data);
        toastSuccess(res.message);
      }
    } catch (e) {
      console.error("scan_os_apps:", e);
      toastError(String(e));
    } finally {
      setScanLoading(false);
    }
  };

  const toggleSelectedApp = (name: string) => {
    setSelectedApps((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
  };

  const parseAdvancedPort = (): number | null => {
    const trimmed = advancedPortInput.trim();
    if (!trimmed) {
      return null;
    }
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      return null;
    }
    return n;
  };

  const handleApplyTransparentApps = async () => {
    setTransparentLoading(true);
    try {
      const res = await commands
        .applyTransparentProxyApps({
          processNames: selectedApps,
          port: parseAdvancedPort(),
        })
        .then(unwrap);
      if (res.success && res.data) {
        setTransparentStatus(res.data);
        toastSuccess(res.message);
      }
    } catch (e) {
      console.error("apply_transparent_proxy_apps:", e);
      toastError(String(e));
      void fetchTransparentStatus();
    } finally {
      setTransparentLoading(false);
    }
  };

  const handleStopTransparent = async () => {
    setTransparentLoading(true);
    try {
      const res = await commands.stopTransparentProxy().then(unwrap);
      if (res.success && res.data) {
        setTransparentStatus(res.data);
        setSelectedApps([]);
        toastSuccess(res.message);
      }
    } catch (e) {
      console.error("stop transparent proxy:", e);
      toastError(String(e));
      void fetchTransparentStatus();
    } finally {
      setTransparentLoading(false);
    }
  };

  const handleSaveAllPorts = async () => {
    const port = Number(proxyPortInput);
    if (Number.isNaN(port) || port < 1 || port > 65535) {
      return;
    }
    setProxyPortSaving(true);
    try {
      const portRes = await commands.setProxyPort({ port }).then(unwrap);
      if (portRes.success && portRes.data) {
        setProxySettings(portRes.data);
      }
      const http = reverseHttpInput.trim() ? Number(reverseHttpInput) : null;
      const https = reverseHttpsInput.trim() ? Number(reverseHttpsInput) : null;
      if (
        (http === null || (!Number.isNaN(http) && http >= 1 && http <= 65535)) &&
        (https === null || (!Number.isNaN(https) && https >= 1 && https <= 65535))
      ) {
        const revRes = await commands
          .setProxyReversePorts({ reverseHttpPort: http, reverseHttpsPort: https })
          .then(unwrap);
        if (revRes.success && revRes.data) {
          setProxySettings(revRes.data);
        }
      }
    } catch (e) {
      console.error("save ports:", e);
    } finally {
      setProxyPortSaving(false);
    }
  };

  const handleSaveDnsServer = async () => {
    const value = dnsServerInput.trim() || null;
    try {
      const res = await commands.setProxyDnsServer({ dnsServer: value === "" ? null : value }).then(unwrap);
      if (res.success && res.data) {
        setProxySettings(res.data);
      }
    } catch (e) {
      console.error("set_proxy_dns_server:", e);
    }
  };

  const applyEngineSettings = (data: ProxySettings) => {
    setProxySettings(data);
    setTlsBypassDraft((data.tls_bypass_hosts ?? []).join("\n"));
    setConnectTimeoutInput(String(data.connect_timeout_secs ?? 15));
    setUpstreamTimeoutInput(String(data.upstream_timeout_secs ?? 30));
  };

  const patchEngine = async (payload: Parameters<typeof commands.updateProxySettings>[0]) => {
    setEngineSaving(true);
    try {
      const res = await commands.updateProxySettings(payload).then(unwrap);
      if (res.success && res.data) {
        applyEngineSettings(res.data);
        await notifyHubDataChanged("features");
      }
    } catch (e) {
      console.error("update_proxy_settings:", e);
    } finally {
      setEngineSaving(false);
    }
  };

  const handleSaveTlsBypass = async () => {
    const hosts = tlsBypassDraft
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
    await patchEngine({ tlsBypassHosts: hosts });
  };

  const handleSaveTimeouts = async () => {
    const connect = Number(connectTimeoutInput);
    const upstream = Number(upstreamTimeoutInput);
    if (!Number.isFinite(connect) || connect < 1 || !Number.isFinite(upstream) || upstream < 1) {
      return;
    }
    await patchEngine({
      connectTimeoutSecs: Math.round(connect),
      upstreamTimeoutSecs: Math.round(upstream),
    });
  };

  const handleCopyPac = async () => {
    if (!pacUrl) {
      return;
    }
    try {
      await navigator.clipboard.writeText(pacUrl);
      setPacCopied(true);
      window.setTimeout(() => setPacCopied(false), 1500);
    } catch (e) {
      console.error("copy pac:", e);
    }
  };

  const handleExport = async () => {
    try {
      const res = await commands.exportAllSettings().then(unwrap);
      if (!res.success || !res.data) {
        return;
      }
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      const path = await save({
        filters: [
          { name: "Horizon Gateway Bundle", extensions: ["hg.json"] },
          { name: "JSON", extensions: ["json"] },
        ],
        defaultPath: `horizon-gateway-${new Date().toISOString().slice(0, 10)}.hg.json`,
      });
      if (path) {
        await writeTextFile(path, JSON.stringify(res.data, null, 2));
        toastSuccess(t.alertExportSuccess);
      }
    } catch (e) {
      console.error("export_all_settings:", e);
      toastError(t.alertExportFail);
    }
  };

  const handleImport = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const path = await open({
        filters: [
          { name: "Horizon Gateway Bundle", extensions: ["hg.json", "json"] },
          { name: "JSON", extensions: ["json"] },
        ],
        multiple: false,
      });
      if (path === null || Array.isArray(path)) {
        return;
      }
      const raw = await readTextFile(path);
      const parsed = JSON.parse(raw) as SettingsExport_Serialize & {
        data?: SettingsExport_Serialize;
        schemaVersion?: number;
        schema_version?: number;
      };
      const data = (
        parsed.data && typeof parsed.data === "object" ? parsed.data : parsed
      ) as SettingsExport_Serialize & {
        schemaVersion?: number;
        schema_version?: number;
      };
      const version = data.version ?? data.schemaVersion ?? data.schema_version ?? 3;
      data.version = version;
      data.schemaVersion = version;
      data.domains = data.domains ?? [];
      data.groups = data.groups ?? [];
      data.domainGroupLinks = data.domainGroupLinks ?? [];
      data.localRoutes = data.localRoutes ?? [];
      data.scenarios = data.scenarios ?? [];
      data.mockRules = data.mockRules ?? [];

      if (data.app && data.app !== "horizon-gateway") {
        toastError(t.alertImportInvalid);
        return;
      }
      const modeChoice = window.prompt(
        lang === "ko" ? "가져오기 모드를 입력하세요: replace 또는 merge" : "Enter import mode: replace or merge",
        "replace",
      );
      if (!modeChoice) {
        return;
      }
      const mode = modeChoice.trim().toLowerCase() === "merge" ? "merge" : "replace";
      await commands.importAllSettings(data, mode).then(unwrap);
      toastSuccess(t.alertImportSuccess);
      fetchSettings();
      await notifyHubDataChanged("domains");
    } catch (e) {
      console.error("import_all_settings:", e);
      toastError(t.alertImportFail);
    }
  };

  const transparentRows = (() => {
    const byName = new Map(osApps.map((a) => [a.name.toLowerCase(), a]));
    for (const name of selectedApps) {
      const key = name.toLowerCase();
      if (!byName.has(key)) {
        byName.set(key, { name, pids: [], instanceCount: 0 });
      }
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  })();

  return (
    <div
      className={clsx("@container h-full min-h-0 flex flex-col bg-base-200/40", isWindow && "@min-[40rem]:flex-row")}
    >
      <div
        className={clsx(
          "shrink-0 border-b border-base-300 bg-base-100",
          isWindow && "@min-[40rem]:border-b-0 @min-[40rem]:border-r @min-[40rem]:w-44",
        )}
      >
        <SettingsNav tab={tab} onChange={setTab} t={t} side={isWindow} />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        <div
          id={`settings-panel-${tab}`}
          role="tabpanel"
          aria-labelledby={`settings-tab-${tab}`}
          className="p-3 @min-[32rem]:p-4 @min-[48rem]:p-5 space-y-6 max-w-3xl @min-[56rem]:max-w-4xl"
        >
          {tab === "proxy" && (
            <>
              <Section title={t.proxyTitle} desc={t.proxyDesc}>
                <SettingSwitch
                  title={t.proxyToggleLabel}
                  desc={proxyStatus.running ? `${t.proxyRunning} · Port ${proxyStatus.port}` : t.proxyStopped}
                  checked={proxyStatus.running}
                  onChange={handleToggleProxy}
                  loading={proxyLoading}
                  label={proxyStatus.running ? t.proxyRunning : t.proxyStopped}
                />
                <div className="pt-2 border-t border-base-300 space-y-2">
                  {!proxyStatus.running ? (
                    <p className="text-xs text-base-content/50">{t.mobileHintOff}</p>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 min-w-0 text-left"
                        aria-expanded={mobileOpen}
                        onClick={() => setMobileOpen((open) => !open)}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <Smartphone className="w-3.5 h-3.5 shrink-0 text-base-content/50" />
                          <span className="min-w-0">
                            <span className="block text-xs font-bold text-base-content">{t.mobileTitle}</span>
                            <span className="block text-[10px] text-base-content/50 mt-0.5 leading-relaxed">
                              {t.mobileDesc}
                            </span>
                          </span>
                        </span>
                        <ChevronDown
                          className={clsx(
                            "w-4 h-4 shrink-0 text-base-content/40 transition-transform",
                            mobileOpen && "rotate-180",
                          )}
                        />
                      </button>
                      {mobileOpen && (
                        <div className="rounded-xl border border-base-300 bg-base-200/40 p-2 @min-[32rem]:p-3 overflow-x-hidden">
                          <MobileConnectionContent embedded />
                        </div>
                      )}
                    </>
                  )}
                </div>
              </Section>

              {proxyStatus.running && (
                <>
                  <Section title={t.certTitle} desc={t.certDesc}>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => {
                        void commands
                          .saveRootCa()
                          .then(unwrap)
                          .catch((e) => {
                            if (e !== "Save cancelled") {
                              console.error(e);
                            }
                          });
                      }}
                    >
                      <Download className="w-3.5 h-3.5" />
                      {t.certSave}
                    </Button>
                  </Section>
                  <Section title={t.pacTitle} desc={t.pacDesc}>
                    <div className="flex flex-col @min-[28rem]:flex-row gap-2 @min-[28rem]:items-center">
                      <code className="flex-1 min-w-0 text-xs font-mono break-all text-primary/80">
                        {pacUrl || "—"}
                      </code>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="gap-1.5 shrink-0 self-stretch @min-[28rem]:self-auto"
                        onClick={() => void handleCopyPac()}
                        disabled={!pacUrl}
                      >
                        {pacCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        {pacCopied ? t.pacCopied : t.pacCopy}
                      </Button>
                    </div>
                  </Section>
                </>
              )}

              <Section title={t.networkTitle} desc={t.networkDesc}>
                <div className="grid grid-cols-1 @min-[28rem]:grid-cols-3 gap-3">
                  <div className="flex flex-col gap-1 min-w-0">
                    <label htmlFor="settings-proxy-port" className="text-[10px] font-medium text-base-content/50">
                      {t.proxyPortLabel}
                    </label>
                    <Input
                      id="settings-proxy-port"
                      type="number"
                      min={1}
                      max={65535}
                      className="h-9 text-sm w-full"
                      value={proxyPortInput}
                      onChange={(e) => setProxyPortInput(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1 min-w-0">
                    <label htmlFor="settings-reverse-http" className="text-[10px] font-medium text-base-content/50">
                      {t.proxyHttpLabel}
                    </label>
                    <Input
                      id="settings-reverse-http"
                      type="number"
                      min={1}
                      max={65535}
                      placeholder="8080"
                      className="h-9 text-sm w-full"
                      value={reverseHttpInput}
                      onChange={(e) => setReverseHttpInput(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1 min-w-0">
                    <label htmlFor="settings-reverse-https" className="text-[10px] font-medium text-base-content/50">
                      {t.proxyHttpsLabel}
                    </label>
                    <Input
                      id="settings-reverse-https"
                      type="number"
                      min={1}
                      max={65535}
                      placeholder="8443"
                      className="h-9 text-sm w-full"
                      value={reverseHttpsInput}
                      onChange={(e) => setReverseHttpsInput(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button variant="secondary" size="sm" onClick={handleSaveAllPorts} disabled={proxyPortSaving}>
                    {proxyPortSaving ? t.proxySaving : t.proxySavePorts}
                  </Button>
                </div>
              </Section>

              <Section title={t.dnsTitle} desc={t.dnsDesc}>
                <div className="flex flex-col @min-[28rem]:flex-row gap-2 @min-[28rem]:items-end">
                  <div className="flex flex-col gap-1 flex-1 w-full min-w-0">
                    <label htmlFor={dnsFieldId} className="text-[10px] font-medium text-base-content/50">
                      {t.dnsLabel}
                    </label>
                    <Input
                      id={dnsFieldId}
                      placeholder={t.dnsPlaceholder}
                      className="h-9 text-sm w-full"
                      value={dnsServerInput}
                      onChange={(e) => setDnsServerInput(e.target.value)}
                    />
                  </div>
                  <Button variant="secondary" size="sm" onClick={handleSaveDnsServer} className="shrink-0">
                    {t.dnsSave}
                  </Button>
                </div>
                {proxySettings?.dns_server && (
                  <p className="text-xs text-base-content/40">
                    {t.dnsCurrent} <code className="bg-base-200 px-1 rounded">{proxySettings.dns_server}</code>
                  </p>
                )}
              </Section>

              <Section title={t.corsTitle} desc={t.corsDesc}>
                <div className="flex justify-end">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label={proxySettings?.cors_rewrite_enabled !== false ? t.corsOn : t.corsOff}
                    className="toggle toggle-success toggle-sm shrink-0"
                    checked={proxySettings?.cors_rewrite_enabled !== false}
                    disabled={engineSaving}
                    onChange={(e) => void patchEngine({ corsRewriteEnabled: e.target.checked })}
                  />
                </div>
              </Section>

              <Section title={t.remoteAccessTitle} desc={t.remoteAccessDesc}>
                <div className="flex justify-end">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label={proxySettings?.allow_remote_access ? t.corsOn : t.corsOff}
                    className="toggle toggle-warning toggle-sm shrink-0"
                    checked={proxySettings?.allow_remote_access === true}
                    disabled={engineSaving}
                    onChange={(e) => void patchEngine({ allowRemoteAccess: e.target.checked })}
                  />
                </div>
              </Section>

              <Section title={t.tlsBypassTitle} desc={t.tlsBypassDesc}>
                <textarea
                  className="textarea textarea-bordered w-full font-mono text-xs min-h-28"
                  placeholder={t.tlsBypassPlaceholder}
                  value={tlsBypassDraft}
                  onChange={(e) => setTlsBypassDraft(e.target.value)}
                />
                <div className="flex justify-end">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={engineSaving}
                    onClick={() => void handleSaveTlsBypass()}
                  >
                    {t.tlsBypassSave}
                  </Button>
                </div>
              </Section>

              <Section title={t.timeoutTitle} desc={t.timeoutDesc}>
                <div className="grid grid-cols-1 @min-[28rem]:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-medium text-base-content/50">{t.timeoutConnect}</label>
                    <Input
                      type="number"
                      min={1}
                      max={300}
                      className="h-9 text-sm"
                      value={connectTimeoutInput}
                      onChange={(e) => setConnectTimeoutInput(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-medium text-base-content/50">{t.timeoutUpstream}</label>
                    <Input
                      type="number"
                      min={1}
                      max={600}
                      className="h-9 text-sm"
                      value={upstreamTimeoutInput}
                      onChange={(e) => setUpstreamTimeoutInput(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={engineSaving}
                    onClick={() => void handleSaveTimeouts()}
                  >
                    {t.timeoutSave}
                  </Button>
                </div>
              </Section>

              <Section title={t.transparentTitle} desc={transparentOpen ? t.transparentDesc : undefined}>
                <div className="flex flex-col @min-[28rem]:flex-row @min-[28rem]:items-center justify-between gap-2">
                  <p className="text-xs text-base-content/50 min-w-0 break-words">
                    {transparentStatus.running
                      ? `${t.transparentRunning} · :${transparentStatus.targetPort} · ${transparentStatus.processAllowlist.join(", ") || "—"}`
                      : t.transparentStopped}
                  </p>
                  <div className="flex items-center gap-2 shrink-0">
                    {transparentStatus.running && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleStopTransparent}
                        disabled={transparentLoading}
                      >
                        {t.transparentStop}
                      </Button>
                    )}
                    <button
                      type="button"
                      className="flex items-center gap-1 text-[11px] font-bold text-base-content/55"
                      aria-expanded={transparentOpen}
                      onClick={() => setTransparentOpen((open) => !open)}
                    >
                      {transparentOpen ? t.mobileCollapse : t.mobileExpand}
                      <ChevronDown
                        className={clsx("w-3.5 h-3.5 transition-transform", transparentOpen && "rotate-180")}
                      />
                    </button>
                  </div>
                </div>
                {transparentOpen && (
                  <>
                    <p className="text-[10px] text-warning font-bold flex items-start gap-1.5">
                      <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-px" />
                      <span>{t.transparentWarn}</span>
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="gap-2"
                        onClick={handleScanOsApps}
                        disabled={scanLoading}
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${scanLoading ? "animate-spin" : ""}`} />
                        {scanLoading ? t.transparentScanning : t.transparentScan}
                      </Button>
                      <span className="text-[10px] text-base-content/40">{t.transparentScanHint}</span>
                    </div>
                    <div className="max-h-48 overflow-y-auto rounded-xl border border-base-300 divide-y divide-base-300">
                      {transparentRows.length === 0 ? (
                        <p className="text-xs text-base-content/40 px-3 py-4">{t.transparentAppsEmpty}</p>
                      ) : (
                        transparentRows.map((app) => {
                          const checked = selectedApps.some((n) => n.toLowerCase() === app.name.toLowerCase());
                          return (
                            <label
                              key={app.name}
                              className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-base-200/60 min-w-0"
                            >
                              <input
                                type="checkbox"
                                className="checkbox checkbox-sm shrink-0"
                                checked={checked}
                                onChange={() => toggleSelectedApp(app.name)}
                              />
                              <span className="text-xs font-medium flex-1 truncate">{app.name}</span>
                              {app.instanceCount > 0 && (
                                <span className="text-[10px] text-base-content/40 shrink-0">
                                  {app.instanceCount}
                                  {t.transparentInstances}
                                </span>
                              )}
                            </label>
                          );
                        })
                      )}
                    </div>
                    <button
                      type="button"
                      className="text-[10px] font-medium text-base-content/50"
                      onClick={() => setShowAdvancedPort((v) => !v)}
                    >
                      {t.transparentAdvanced}
                      {showAdvancedPort ? " ▴" : " ▾"}
                    </button>
                    {showAdvancedPort && (
                      <div className="flex flex-col gap-1">
                        <label htmlFor={tpPortId} className="text-[10px] font-medium text-base-content/50">
                          {t.transparentPortLabel}
                        </label>
                        <Input
                          id={tpPortId}
                          type="number"
                          min={1}
                          max={65535}
                          placeholder="8887"
                          className="h-9 text-sm"
                          value={advancedPortInput}
                          onChange={(e) => setAdvancedPortInput(e.target.value)}
                        />
                        <p className="text-[10px] text-base-content/40">{t.transparentPortHint}</p>
                      </div>
                    )}
                    <div className="flex justify-end">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleApplyTransparentApps}
                        disabled={transparentLoading || (!proxyStatus.running && selectedApps.length > 0)}
                      >
                        {transparentLoading ? t.transparentApplying : t.transparentApply}
                      </Button>
                    </div>
                  </>
                )}
              </Section>
            </>
          )}

          {tab === "app" && (
            <>
              <Section title={t.updateTitle} desc={t.updateDesc}>
                <div className="flex flex-wrap gap-3 items-center">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="gap-2"
                    onClick={() => checkForUpdates()}
                    disabled={isChecking}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? "animate-spin" : ""}`} />
                    {isChecking ? t.updateChecking : t.updateCheckBtn}
                  </Button>
                  {updateError && <span className="text-xs text-error">{updateError}</span>}
                  {!update && !isChecking && !updateError && (
                    <span className="text-xs text-base-content/40">{t.updateClickToCheck}</span>
                  )}
                </div>
                {update && <UpdateBanner update={update} onDismiss={undefined} />}
              </Section>

              <Section title={wt.settingsTitle} desc={wt.settingsDesc}>
                <div className="grid grid-cols-1 @min-[36rem]:grid-cols-2 gap-5">
                  <WindowBehaviorRadios
                    label={wt.closeButtonLabel}
                    value={closeBehavior}
                    onChange={(value) => setCloseBehavior(value)}
                    options={[
                      { id: "ask", label: wt.optionAsk, hint: wt.optionAskHint },
                      { id: "hide", label: wt.hideToTray, hint: wt.hideToTrayHint },
                      { id: "quit", label: wt.quitApp, hint: wt.quitAppHint },
                    ]}
                  />
                  <WindowBehaviorRadios
                    label={wt.minimizeButtonLabel}
                    value={minimizeBehavior}
                    onChange={(value) => setMinimizeBehavior(value)}
                    options={[
                      { id: "ask", label: wt.optionAsk, hint: wt.optionAskHint },
                      { id: "taskbar", label: wt.minimizeToTaskbar, hint: wt.minimizeToTaskbarHint },
                      { id: "tray", label: wt.hideToTray, hint: wt.hideToTrayHint },
                    ]}
                  />
                </div>
              </Section>

              <Section title={t.backupTitle} desc={t.backupDesc}>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" className="gap-1.5" onClick={handleExport}>
                    <Download className="w-3.5 h-3.5" /> {t.backupExport}
                  </Button>
                  <Button variant="secondary" size="sm" className="gap-1.5" onClick={handleImport}>
                    <Upload className="w-3.5 h-3.5" /> {t.backupImport}
                  </Button>
                </div>
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
