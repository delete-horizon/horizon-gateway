import { useAtomValue } from "jotai";
import {
  AlertCircle,
  CheckCircle2,
  Loader2Icon,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Usb,
  Wifi,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { languageAtom, proxyRunningAtom } from "@/entities/app";
import { ProxyServerWarning } from "@/entities/proxy";
import type { AdbStatus, ProxyStatusPayload, RemoteAccessHosts } from "@/shared/api";
import { commands, unwrap } from "@/shared/api";
import { Badge } from "@/shared/ui/badge/badge";
import { Card } from "@/shared/ui/card/card";
import { StatusToggle } from "@/shared/ui/status-toggle/StatusToggle";
import { SegmentedTabs } from "@/shared/ui/tabs";
import { toastInfo } from "@/shared/ui/toast";
import { H1, P } from "@/shared/ui/typography/typography";
import { en } from "../i18n/en";
import { ko } from "../i18n/ko";

function Section({
  title,
  desc,
  children,
  titleExtra,
  cardClassName,
}: {
  title: ReactNode;
  desc?: string;
  children: ReactNode;
  titleExtra?: ReactNode;
  cardClassName?: string;
}) {
  return (
    <section className="space-y-2 min-w-0">
      <div className="flex items-center justify-between gap-2 min-w-0">
        <h2 className="text-sm font-semibold text-base-content flex items-center gap-2 min-w-0">{title}</h2>
        {titleExtra}
      </div>
      {desc && <p className="text-xs text-base-content/55 leading-relaxed">{desc}</p>}
      <Card className={`p-3 @min-[28rem]:p-4 space-y-3 min-w-0 ${cardClassName ?? ""}`}>{children}</Card>
    </section>
  );
}

const EMPTY_HOSTS: RemoteAccessHosts = {
  tailscale_ip: null,
  lan_ips: [],
  allow_remote_access: false,
  setup_port: 13030,
};

function directUrl(host: string | null, port: number): string | null {
  if (!host || !port) {
    return null;
  }
  return `http://${host}:${port}/connect`;
}

export function MobileConnectionContent({ embedded = false }: { embedded?: boolean }) {
  const lang = useAtomValue(languageAtom);
  const t = lang === "ko" ? ko : en;
  const isProxyRunning = useAtomValue(proxyRunningAtom);

  const [activeTab, setActiveTab] = useState<"wireless" | "usb">("wireless");
  const [proxyStatus, setProxyStatus] = useState<ProxyStatusPayload>({
    running: false,
    port: 0,
    reverse_http_port: null,
    reverse_https_port: null,
  });
  const [hosts, setHosts] = useState<RemoteAccessHosts>(EMPTY_HOSTS);
  const [hostsLoading, setHostsLoading] = useState(true);
  const [remoteSaving, setRemoteSaving] = useState(false);
  const [tunnelActive, setTunnelActive] = useState(false);
  const [tunnelUrl, setTunnelUrl] = useState<string | null>(null);
  const [tunnelLoading, setTunnelLoading] = useState(false);
  const [tunnelError, setTunnelError] = useState<string | null>(null);
  const [adbStatus, setAdbStatus] = useState<AdbStatus | null>(null);
  const [adbLoading, setAdbLoading] = useState(true);
  const [usbTunnelActive, setUsbTunnelActive] = useState(false);
  const [usbTunnelLoading, setUsbTunnelLoading] = useState(false);
  const [usbError, setUsbError] = useState<string | null>(null);

  const proxyPortRef = useRef(proxyStatus.port);
  useEffect(() => {
    proxyPortRef.current = proxyStatus.port;
  }, [proxyStatus.port]);

  const fetchProxyStatus = useCallback(async () => {
    try {
      const res = await commands.getProxyStatus().then(unwrap);
      if (res.success && res.data) {
        setProxyStatus(res.data);
      }
    } catch (e) {
      console.error("fetchProxyStatus error:", e);
    }
  }, []);

  const fetchRemoteHosts = useCallback(async () => {
    setHostsLoading(true);
    try {
      const res = await commands.getRemoteAccessHosts().then(unwrap);
      if (res.success && res.data) {
        setHosts(res.data);
      } else {
        setHosts(EMPTY_HOSTS);
      }
    } catch (e) {
      console.error("fetchRemoteHosts error:", e);
      setHosts(EMPTY_HOSTS);
    } finally {
      setHostsLoading(false);
    }
  }, []);

  const fetchAdbStatus = useCallback(async () => {
    setAdbLoading(true);
    setUsbError(null);
    try {
      const res = await commands.checkAdbStatus().then(unwrap);
      if (res.success && res.data) {
        setAdbStatus(res.data);
      } else {
        setAdbStatus(null);
      }
    } catch (e: unknown) {
      console.error("checkAdbStatus error:", e);
      setUsbError(e instanceof Error ? e.message : String(e));
      setAdbStatus(null);
    } finally {
      setAdbLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchProxyStatus();
    void fetchRemoteHosts();
    void fetchAdbStatus();
    return () => {
      void commands.stopCloudflareTunnel().then(unwrap).catch(console.error);
      if (proxyPortRef.current) {
        void commands.stopUsbReverse(proxyPortRef.current).then(unwrap).catch(console.error);
      }
    };
  }, [fetchProxyStatus, fetchRemoteHosts, fetchAdbStatus]);

  const handleRemoteToggle = async (checked: boolean) => {
    setRemoteSaving(true);
    try {
      await commands.updateProxySettings({ allowRemoteAccess: checked }).then(unwrap);
      await fetchRemoteHosts();
      toastInfo(t.remoteRestart);
    } catch (e: unknown) {
      console.error("updateProxySettings error:", e);
    } finally {
      setRemoteSaving(false);
    }
  };

  const handleToggleTunnel = async () => {
    setTunnelLoading(true);
    setTunnelError(null);
    if (tunnelActive) {
      try {
        await commands.stopCloudflareTunnel().then(unwrap);
        setTunnelActive(false);
        setTunnelUrl(null);
      } catch (e: unknown) {
        console.error("stopCloudflareTunnel error:", e);
        setTunnelError(e instanceof Error ? e.message : String(e));
      } finally {
        setTunnelLoading(false);
      }
      return;
    }
    try {
      const res = await commands.startCloudflareTunnel().then(unwrap);
      if (res.success && res.data) {
        setTunnelUrl(res.data);
        setTunnelActive(true);
      } else {
        setTunnelError(res.message || t.tunnelFailed);
      }
    } catch (e: unknown) {
      console.error("startCloudflareTunnel error:", e);
      setTunnelError(e instanceof Error ? e.message : String(e));
    } finally {
      setTunnelLoading(false);
    }
  };

  const handleToggleUsbTunnel = async () => {
    if (!proxyStatus.port) {
      return;
    }
    setUsbTunnelLoading(true);
    setUsbError(null);
    if (usbTunnelActive) {
      try {
        await commands.stopUsbReverse(proxyStatus.port).then(unwrap);
        setUsbTunnelActive(false);
      } catch (e: unknown) {
        console.error("stopUsbReverse error:", e);
        setUsbError(e instanceof Error ? e.message : String(e));
      } finally {
        setUsbTunnelLoading(false);
      }
      return;
    }
    try {
      await commands.startUsbReverse(proxyStatus.port).then(unwrap);
      setUsbTunnelActive(true);
    } catch (e: unknown) {
      console.error("startUsbReverse error:", e);
      setUsbError(e instanceof Error ? e.message : String(e));
    } finally {
      setUsbTunnelLoading(false);
    }
  };

  const copyCommand = (command: string) => {
    void navigator.clipboard.writeText(command);
    toastInfo(t.commandCopied);
  };

  const lanHost = hosts.lan_ips[0] ?? null;
  const lanConnect = hosts.allow_remote_access ? directUrl(lanHost, hosts.setup_port) : null;
  const tailscaleConnect = hosts.allow_remote_access ? directUrl(hosts.tailscale_ip, hosts.setup_port) : null;
  const tunnelConnect = tunnelUrl ? `${tunnelUrl}/connect` : null;
  const connectUrl = tunnelConnect ?? lanConnect ?? tailscaleConnect;
  const proxyPort = proxyStatus.port || 8888;

  return (
    <div className={`@container flex flex-col ${embedded ? "gap-3" : "gap-8 pb-20"}`}>
      {!embedded && (
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-primary">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Smartphone className="w-5 h-5" />
            </div>
            <H1 className="text-2xl tablet:text-3xl font-black text-base-content tracking-tight">{t.title}</H1>
          </div>
        </div>
      )}

      {!embedded && <ProxyServerWarning />}

      <SegmentedTabs<"wireless" | "usb">
        value={activeTab}
        onChange={setActiveTab}
        variant="underline"
        size="md"
        fullWidth
        className="min-w-0"
        items={[
          {
            id: "wireless",
            label: embedded ? t.tabWireless : t.tabWirelessFull,
            icon: Wifi,
          },
          {
            id: "usb",
            label: embedded ? t.tabUsb : t.tabUsbFull,
            icon: Usb,
          },
        ]}
      />

      {activeTab === "wireless" ? (
        <div className="grid grid-cols-1 @min-[36rem]:grid-cols-3 gap-4 @min-[36rem]:gap-8 items-start">
          <div className="@min-[36rem]:col-span-2 flex flex-col gap-4 @min-[36rem]:gap-6">
            <Section
              title={
                <>
                  <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
                  {t.deviceStatus}
                </>
              }
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3 p-4 bg-base-200/50 rounded-xl border border-base-300/30">
                  <div className="flex flex-col min-w-0">
                    <span className="font-bold text-sm">{t.proxyServer}</span>
                    <span className="text-xs text-base-content/55 mt-1">{t.proxyHint}</span>
                  </div>
                  <Badge variant={{ color: isProxyRunning ? "green" : "gray" }}>
                    {isProxyRunning ? t.proxyRunning(proxyStatus.port) : t.proxyStopped}
                  </Badge>
                </div>

                <div className="flex items-center justify-between gap-3 p-4 bg-base-200/50 rounded-xl border border-base-300/30">
                  <div className="flex flex-col min-w-0">
                    <span className="font-bold text-sm">{t.remoteTitle}</span>
                    <span className="text-xs text-base-content/55 mt-1">{t.remoteDesc}</span>
                  </div>
                  <StatusToggle
                    label={hosts.allow_remote_access ? t.remoteOn : t.remoteOff}
                    checked={hosts.allow_remote_access}
                    onChange={(checked) => void handleRemoteToggle(checked)}
                    loading={remoteSaving || hostsLoading}
                  />
                </div>

                <div className="flex items-center justify-between gap-3 p-4 bg-base-200/50 rounded-xl border border-base-300/30">
                  <div className="flex flex-col min-w-0">
                    <span className="font-bold text-sm">{t.lanTitle}</span>
                    <span className="text-xs text-base-content/55 mt-1">{t.lanHint}</span>
                  </div>
                  {hostsLoading ? (
                    <Loader2Icon className="w-5 h-5 text-primary animate-spin shrink-0" />
                  ) : hosts.lan_ips.length > 0 ? (
                    <span className="font-mono text-sm font-bold text-success bg-success/10 px-3 py-1 rounded-lg border border-success/20">
                      {hosts.lan_ips.join(", ")}
                    </span>
                  ) : (
                    <span className="text-xs font-medium text-base-content/55">{t.lanEmpty}</span>
                  )}
                </div>

                <div className="flex items-center justify-between gap-3 p-4 bg-base-200/50 rounded-xl border border-base-300/30">
                  <div className="flex flex-col min-w-0">
                    <span className="font-bold text-sm">{t.tailscaleTitle}</span>
                    <span className="text-xs text-base-content/55 mt-1">{t.tailscaleHint}</span>
                  </div>
                  {hostsLoading ? (
                    <Loader2Icon className="w-5 h-5 text-primary animate-spin shrink-0" />
                  ) : hosts.tailscale_ip ? (
                    <span className="font-mono text-sm font-bold text-success bg-success/10 px-3 py-1 rounded-lg border border-success/20">
                      {hosts.tailscale_ip}
                    </span>
                  ) : (
                    <span className="text-xs font-medium text-base-content/55">{t.tailscaleMissing}</span>
                  )}
                </div>
              </div>
            </Section>

            <Section
              title={
                <>
                  <Wifi className="w-4 h-4 text-primary shrink-0" />
                  {t.tunnelTitle}
                </>
              }
              desc={t.tunnelDesc}
            >
              <div className="flex items-center justify-between gap-3 p-4 bg-base-200/50 rounded-xl border border-base-300/30">
                <div className="flex flex-col min-w-0">
                  <span className="font-bold text-sm">{t.tunnelStatus}</span>
                  <span className="text-xs text-base-content/55 font-mono break-all mt-1">
                    {tunnelActive && tunnelUrl ? tunnelUrl : t.tunnelStandby}
                  </span>
                </div>
                <StatusToggle
                  label=""
                  checked={tunnelActive}
                  onChange={handleToggleTunnel}
                  loading={tunnelLoading}
                  disabled={!isProxyRunning}
                />
              </div>
              {tunnelError && (
                <div className="p-4 bg-error/10 border border-error/20 rounded-xl text-error text-xs font-mono break-all">
                  {tunnelError}
                </div>
              )}
              {tunnelError?.toLowerCase().includes("cloudflared") && (
                <div className="space-y-3">
                  <div>
                    <p className="font-bold text-sm">{t.cloudflaredTitle}</p>
                    <p className="text-xs text-base-content/55 mt-1">{t.cloudflaredDesc}</p>
                  </div>
                  <div className="grid grid-cols-1 @min-[28rem]:grid-cols-2 gap-3">
                    <CommandCard
                      label="Windows"
                      command="winget install Cloudflare.cloudflared"
                      copyLabel={t.copyCommand}
                      onCopy={copyCommand}
                    />
                    <CommandCard
                      label="macOS"
                      command="brew install cloudflared"
                      copyLabel={t.copyCommand}
                      onCopy={copyCommand}
                    />
                  </div>
                  <a
                    href="https://github.com/cloudflare/cloudflared/releases"
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary hover:underline font-medium"
                  >
                    {t.manualDownload}
                  </a>
                </div>
              )}
            </Section>
          </div>

          <div className="flex flex-col gap-4 @min-[36rem]:gap-6">
            <Section
              title={
                <>
                  <QrCode className="w-4 h-4 text-primary shrink-0" />
                  {t.qrTitle}
                </>
              }
              cardClassName="flex flex-col items-center text-center"
            >
              {connectUrl ? (
                <div className="flex flex-col items-center gap-5 w-full">
                  <div className="p-4 bg-white rounded-2xl shadow-lg border border-base-300/20">
                    <QRCodeSVG value={connectUrl} size={220} />
                  </div>
                  <div className="bg-base-200/50 p-3 rounded-lg border border-base-300/30 font-mono text-[10px] break-all w-full select-all">
                    {connectUrl}
                  </div>
                  <P className="text-xs text-base-content/55 leading-relaxed">{t.qrHint}</P>
                  {!hosts.allow_remote_access && (
                    <P className="text-xs text-warning leading-relaxed">{t.qrNeedRemote}</P>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-base-content/40 w-full border-2 border-dashed border-base-300 rounded-2xl">
                  <QrCode className="w-16 h-16 opacity-40" />
                  <span className="text-sm font-medium">{t.qrEmpty}</span>
                </div>
              )}
            </Section>

            {(lanConnect || tailscaleConnect) && (
              <Section title={t.directAddress}>
                <ul className="space-y-2 text-xs font-mono break-all text-base-content/70">
                  {lanConnect && <li>{lanConnect}</li>}
                  {tailscaleConnect && <li>{tailscaleConnect}</li>}
                </ul>
              </Section>
            )}

            <Section title={t.stepsTitle}>
              <ul className="space-y-3 text-xs leading-relaxed text-base-content/70">
                {[t.step1, t.step2, t.step3, t.step4].map((step, index) => (
                  <li key={step} className="flex gap-2">
                    <span className="font-bold text-primary shrink-0">{index + 1}.</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ul>
            </Section>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 @min-[36rem]:grid-cols-3 gap-4 @min-[36rem]:gap-8 items-start">
          <div className="@min-[36rem]:col-span-2 flex flex-col gap-4 @min-[36rem]:gap-6">
            <Section
              title={
                <>
                  <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
                  {t.adbTitle}
                </>
              }
              titleExtra={
                <button
                  type="button"
                  onClick={() => void fetchAdbStatus()}
                  disabled={adbLoading}
                  className="p-1.5 bg-base-200 hover:bg-base-300 border border-base-300 rounded-lg text-base-content/70 hover:text-base-content transition-all disabled:opacity-50 shrink-0"
                  title={t.refresh}
                >
                  <RefreshCw className={`w-4 h-4 ${adbLoading ? "animate-spin" : ""}`} />
                </button>
              }
            >
              {adbLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2Icon className="w-8 h-8 text-primary animate-spin" />
                </div>
              ) : adbStatus ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3 p-4 bg-base-200/50 rounded-xl border border-base-300/30">
                    <div className="flex flex-col min-w-0">
                      <span className="font-bold text-sm">{t.adbInstall}</span>
                      <span className="text-xs text-base-content/55 mt-1 font-mono break-all pr-4">
                        {adbStatus.found ? t.adbDetected(adbStatus.path || "") : t.adbNotInstalled}
                      </span>
                    </div>
                    <Badge variant={{ color: adbStatus.found ? "green" : "red" }}>
                      {adbStatus.found ? t.adbReady : t.adbMissing}
                    </Badge>
                  </div>
                  <div className="p-4 bg-base-200/50 rounded-xl border border-base-300/30">
                    <span className="font-bold text-sm block mb-2">{t.devicesTitle}</span>
                    {adbStatus.devices.length > 0 ? (
                      <div className="space-y-2 mt-2">
                        {adbStatus.devices.map((device) => (
                          <div
                            key={device}
                            className="flex items-center gap-2 p-2 bg-success/5 border border-success/15 rounded-lg text-success text-xs font-mono"
                          >
                            <CheckCircle2 className="w-4 h-4 shrink-0 text-success" />
                            <span>{device}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 p-3 bg-warning/5 border border-warning/15 rounded-lg text-warning text-xs mt-2">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span>{t.noDevices}</span>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-error/10 border border-error/20 rounded-xl text-error text-xs font-mono">
                  {usbError || t.adbLoadFailed}
                </div>
              )}

              {!adbLoading && adbStatus && !adbStatus.found && (
                <div className="space-y-3 text-warning">
                  <div className="flex gap-3">
                    <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                    <div className="text-sm leading-relaxed">
                      <p className="font-bold mb-1">{t.adbRequiredTitle}</p>
                      <p className="text-base-content/70">{t.adbRequiredDesc}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 @min-[28rem]:grid-cols-2 gap-3">
                    <CommandCard
                      label="Windows"
                      command="choco install adb"
                      copyLabel={t.copyCommandShort}
                      onCopy={copyCommand}
                    />
                    <CommandCard
                      label="macOS"
                      command="brew install --cask android-platform-tools"
                      copyLabel={t.copyCommandShort}
                      onCopy={copyCommand}
                    />
                  </div>
                </div>
              )}
            </Section>

            <Section
              title={
                <>
                  <Usb className="w-4 h-4 text-primary shrink-0" />
                  {t.usbTunnelTitle}
                </>
              }
              desc={t.usbTunnelDesc(proxyPort)}
            >
              <div className="flex items-center justify-between gap-3 p-4 bg-base-200/50 rounded-xl border border-base-300/30">
                <div className="flex flex-col">
                  <span className="font-bold text-sm">{t.usbTunnelStatus}</span>
                  <span className="text-xs text-base-content/55 font-mono mt-1">
                    {usbTunnelActive ? t.usbTunnelActive(proxyPort) : t.usbTunnelInactive}
                  </span>
                </div>
                <StatusToggle
                  label=""
                  checked={usbTunnelActive}
                  onChange={handleToggleUsbTunnel}
                  loading={usbTunnelLoading}
                  disabled={!isProxyRunning || !adbStatus?.found || adbStatus.devices.length === 0}
                />
              </div>
              {usbError && adbStatus && (
                <div className="p-4 bg-error/10 border border-error/20 rounded-xl text-error text-xs font-mono break-all">
                  {usbError}
                </div>
              )}
            </Section>
          </div>

          <div className="flex flex-col gap-4 @min-[36rem]:gap-6">
            <Section title={t.usbStepsTitle}>
              <ul className="space-y-4 text-xs leading-relaxed text-base-content/70">
                <li className="flex gap-2">
                  <span className="font-bold text-primary shrink-0">1.</span>
                  <div>
                    <span className="font-bold block text-base-content">{t.usbStep1Title}</span>
                    <span>{t.usbStep1}</span>
                  </div>
                </li>
                <li className="flex gap-2">
                  <span className="font-bold text-primary shrink-0">2.</span>
                  <div>
                    <span className="font-bold block text-base-content">{t.usbStep2Title}</span>
                    <span>{t.usbStep2}</span>
                  </div>
                </li>
                <li className="flex gap-2">
                  <span className="font-bold text-primary shrink-0">3.</span>
                  <div>
                    <span className="font-bold block text-base-content">{t.usbStep3Title}</span>
                    <span>{t.usbStep3}</span>
                  </div>
                </li>
              </ul>
            </Section>
            <Card className="p-4 border border-warning/20 bg-warning/5 text-warning">
              <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">{t.iosTitle}</h2>
              <P className="text-xs leading-relaxed text-base-content/70">{t.iosDesc}</P>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function CommandCard({
  label,
  command,
  copyLabel,
  onCopy,
}: {
  label: string;
  command: string;
  copyLabel: string;
  onCopy: (command: string) => void;
}) {
  return (
    <div className="p-3 bg-base-200/60 rounded-lg flex flex-col justify-between">
      <div>
        <span className="text-[10px] font-medium text-base-content/50">{label}</span>
        <p className="text-xs font-mono mt-1 text-primary font-bold break-all">{command}</p>
      </div>
      <button
        type="button"
        onClick={() => onCopy(command)}
        className="mt-3 text-[11px] bg-base-100 hover:bg-base-200 border border-base-300 py-1.5 rounded-md font-medium text-base-content"
      >
        {copyLabel}
      </button>
    </div>
  );
}
