import { Link } from "@tanstack/react-router";
import { AlertCircle, Camera, Check, ChevronRight, ExternalLink, Globe, Plus, Save, X } from "lucide-react";
import type { CapturedElement } from "@/entities/inspector";
import { useIsEmbeddedPage } from "@/shared/lib/tauri/useEmbedMode";
import { Button } from "@/shared/ui/button/Button";
import { Card } from "@/shared/ui/card/card";
import { Input } from "@/shared/ui/input/Input";
import { H1, P } from "@/shared/ui/typography/typography";
import type { InspectorPanelCopy } from "../useInspectorPanel";

export interface InspectorPanelProps {
  t: InspectorPanelCopy;
  isProxyRunning: boolean;
  injectionDomains: string[];
  newDomain: string;
  captured: CapturedElement | null;
  role: string;
  description: string;
  lastSavedId: string | null;
  onNewDomainChange: (value: string) => void;
  onAddDomain: (e: React.KeyboardEvent) => void;
  onRemoveDomain: (domain: string) => void;
  onRoleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onSaveAnnotation: () => void;
  onDismissCapture: () => void;
}

export function InspectorPanel({
  t,
  isProxyRunning,
  injectionDomains,
  newDomain,
  captured,
  role,
  description,
  lastSavedId,
  onNewDomainChange,
  onAddDomain,
  onRemoveDomain,
  onRoleChange,
  onDescriptionChange,
  onSaveAnnotation,
  onDismissCapture,
}: InspectorPanelProps) {
  const isEmbedded = useIsEmbeddedPage();

  return (
    <div
      className={`flex flex-col gap-4 overflow-hidden ${isEmbedded ? "h-full min-h-0" : "gap-8 pb-20 max-w-4xl mx-auto"}`}
    >
      {!isEmbedded && (
        <header>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 bg-primary/20 rounded-xl text-primary">
              <Camera className="w-6 h-6" />
            </div>
            <H1 className="text-3xl font-black tracking-tight">{t.title}</H1>
          </div>
          <P className="text-base-content/60 ml-1">{t.subtitle}</P>
        </header>
      )}

      <section className="space-y-2 min-w-0">
        <h2 className="text-sm font-semibold text-base-content flex items-center gap-2">
          <ExternalLink className="w-4 h-4 text-primary shrink-0" />
          {t.injectionSettings}
        </h2>
        <Card className="p-6 border-none bg-base-100 shadow-sm ring-1 ring-base-300">
          <P className="text-xs text-base-content/55 leading-relaxed mb-6">{t.injectionDomainsDesc}</P>

          <div className="pt-0">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-black uppercase text-base-content/40 tracking-widest px-1">
                  {t.injectionDomainsLabel}
                </label>
              </div>

              <div className="flex flex-wrap gap-2 mb-2">
                {injectionDomains.map((domain) => (
                  <div
                    key={domain}
                    className="group flex items-center gap-1.5 bg-base-200 hover:bg-base-300 px-3 py-1.5 rounded-xl border border-base-300 transition-colors"
                  >
                    <Globe className="w-3 h-3 text-base-content/40" />
                    <span className="text-xs font-bold font-mono">{domain}</span>
                    <button
                      type="button"
                      onClick={() => onRemoveDomain(domain)}
                      className="p-0.5 hover:text-error transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <div className="relative flex-1 min-w-[200px]">
                  <Input
                    value={newDomain}
                    onChange={(e) => onNewDomainChange(e.target.value)}
                    onKeyDown={onAddDomain}
                    placeholder={t.addDomainPlaceholder}
                    className="h-9 text-xs font-mono"
                  />
                  <Plus className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-base-content/30" />
                </div>
              </div>
            </div>
          </div>
        </Card>
      </section>

      {!isProxyRunning && (
        <Card className="p-6 border-none bg-error/10 shadow-sm ring-1 ring-error/20">
          <div className="flex items-center gap-5">
            <div className="p-3.5 bg-error/20 rounded-2xl text-error border border-error/20">
              <AlertCircle className="w-7 h-7" />
            </div>
            <div className="flex flex-col gap-1.5">
              <h3 className="font-bold text-xl text-error">{t.statusInactive}</h3>
              <P className="text-sm text-error/70 leading-relaxed">{t.proxyInactiveDetail}</P>
            </div>
          </div>
        </Card>
      )}

      {captured ? (
        <Card className="p-6 border-2 border-primary/50 animate-in zoom-in-95 duration-300 shadow-2xl bg-base-100 ring-4 ring-primary/5">
          <div className="flex justify-between items-start mb-6">
            <h2 className="text-2xl font-bold flex items-center gap-3 text-primary">
              <Camera className="w-6 h-6" />
              {t.capturedTitle}
            </h2>
            <button
              type="button"
              onClick={onDismissCapture}
              className="p-2 rounded-full hover:bg-base-200 text-base-content/40 hover:text-base-content transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-base-200/50 rounded-2xl overflow-hidden flex items-center justify-center p-6 border border-base-300/50 relative group">
              <img
                src={captured.thumbnail}
                alt="Captured element"
                className="max-w-full max-h-[320px] shadow-2xl rounded-lg"
              />
              <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full text-[10px] text-white font-bold flex items-center gap-2">
                <Globe className="w-3 h-3" />
                {captured.domain}
              </div>
            </div>

            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="captured-selector"
                  className="text-xs font-bold text-base-content/40 uppercase tracking-widest px-1"
                >
                  {t.selector}
                </label>
                <code
                  id="captured-selector"
                  className="text-[11px] bg-base-200 p-3 rounded-xl block break-all whitespace-pre-wrap font-mono border border-base-300/30 text-base-content/80"
                >
                  {captured.selector}
                </code>
              </div>

              <div className="flex flex-col gap-4">
                <Input
                  placeholder={t.rolePlaceholder}
                  value={role}
                  onChange={(e) => onRoleChange(e.target.value)}
                  className="font-bold text-lg h-12"
                />
                <textarea
                  placeholder={t.descPlaceholder}
                  value={description}
                  onChange={(e) => onDescriptionChange(e.target.value)}
                  className="textarea textarea-bordered w-full h-28 bg-base-200/30 focus:outline-primary rounded-xl"
                />
                <Button
                  variant="primary"
                  className="w-full h-12 gap-2 text-lg font-bold"
                  onClick={onSaveAnnotation}
                  disabled={!role}
                >
                  <Save className="w-5 h-5" />
                  {t.saveBtn}
                </Button>
              </div>
            </div>
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {lastSavedId && (
            <Card className="p-6 bg-success/10 border-none ring-1 ring-success/20 animate-in fade-in slide-in-from-top-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-2 bg-success/20 rounded-lg text-success">
                    <Check className="w-5 h-5" />
                  </div>
                  <span className="font-bold text-success">{t.saveSuccess}</span>
                </div>
                <Link to="/ux/policies">
                  <Button variant="ghost" size="sm" className="gap-2 text-success hover:bg-success/10">
                    {t.viewList}
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </Link>
              </div>
            </Card>
          )}

          <div className="py-32 flex flex-col items-center justify-center border-2 border-dashed border-base-300 rounded-3xl bg-base-100/50 text-base-content/20">
            <div className="relative mb-6">
              <Camera className="w-20 h-16 opacity-10" />
              <div className="absolute -top-2 -right-2 w-6 h-6 bg-primary rounded-full animate-ping opacity-20" />
              <div className="absolute -top-2 -right-2 w-6 h-6 bg-primary rounded-full flex items-center justify-center">
                <div className="w-2 h-2 bg-white rounded-full" />
              </div>
            </div>
            <h3 className="text-2xl font-black text-base-content/40 mb-2">{t.waitingCapture}</h3>
            <P className="text-sm text-base-content/30">{t.waitingCaptureDesc}</P>
          </div>
        </div>
      )}
    </div>
  );
}
