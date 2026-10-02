import clsx from "clsx";
import { Check, Sparkles } from "lucide-react";
import { AVATAR_COLORS } from "@/entities/app";
import { Button } from "@/shared/ui/button/Button";
import { Input } from "@/shared/ui/input/Input";

export interface UserProfileSetupViewProps {
  tempName: string;
  tempRole: string;
  tempColor: string;
  lang: "ko" | "en";
  initials: string;
  onTempNameChange: (value: string) => void;
  onTempRoleChange: (value: string) => void;
  onTempColorChange: (value: string) => void;
  onLangChange: (lang: "ko" | "en") => void;
  onSave: () => void;
}

export function UserProfileSetupView({
  tempName,
  tempRole,
  tempColor,
  lang,
  initials,
  onTempNameChange,
  onTempRoleChange,
  onTempColorChange,
  onLangChange,
  onSave,
}: UserProfileSetupViewProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-base-200/80 backdrop-blur-md">
      <div className="bg-base-100 border border-base-300/30 rounded-3xl overflow-hidden w-full max-w-md shadow-2xl flex flex-col mx-4 animate-in zoom-in-95 duration-500 text-base-content">
        <div className="relative h-32 bg-base-200 flex items-center justify-center overflow-hidden shrink-0">
          <div className={`absolute inset-0 opacity-20 ${tempColor}`} />
          <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10 mix-blend-overlay" />

          <div className="absolute -bottom-10">
            <div
              className={clsx(
                "w-20 h-20 rounded-2xl border-4 border-base-100 flex items-center justify-center text-3xl font-black text-white shadow-xl transition-all duration-500 rotate-3 hover:rotate-0",
                tempColor,
              )}
            >
              {initials}
            </div>
          </div>
        </div>

        <div className="pt-16 pb-8 px-8 flex flex-col gap-6">
          <div className="text-center flex flex-col gap-1">
            <h2 className="text-2xl font-black text-base-content flex items-center justify-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              Welcome to Horizon Gateway
            </h2>
            <p className="text-sm text-base-content/60">How should we address you?</p>
          </div>

          <div className="flex flex-col gap-5 mt-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="setup-name" className="text-xs font-bold uppercase tracking-wider text-base-content/50">
                Name / Nickname
              </label>
              <Input
                id="setup-name"
                placeholder="e.g. Alex"
                value={tempName}
                onChange={(e) => onTempNameChange(e.target.value)}
                maxLength={20}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    onSave();
                  }
                }}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="setup-role" className="text-xs font-bold uppercase tracking-wider text-base-content/50">
                Role (Optional)
              </label>
              <Input
                id="setup-role"
                placeholder="e.g. Developer, Administrator"
                value={tempRole}
                onChange={(e) => onTempRoleChange(e.target.value)}
                maxLength={30}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    onSave();
                  }
                }}
              />
            </div>

            <div className="flex flex-col gap-1.5 mt-2">
              <span className="text-xs font-bold uppercase tracking-wider text-base-content/50">Avatar Theme</span>
              <div className="flex items-center gap-2 flex-wrap">
                {AVATAR_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => onTempColorChange(c)}
                    className={clsx(
                      "w-8 h-8 rounded-full border-2 transition-transform hover:scale-110 flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                      c,
                      tempColor === c ? "border-base-content scale-110 shadow-md" : "border-transparent",
                    )}
                  >
                    {tempColor === c && <Check className="w-4 h-4 text-white" />}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5 mt-2">
              <span className="text-xs font-bold uppercase tracking-wider text-base-content/50">Language</span>
              <div className="flex gap-2 bg-base-200 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => onLangChange("en")}
                  className={clsx(
                    "flex-1 py-1.5 rounded-lg text-sm font-bold transition-all cursor-pointer",
                    lang === "en"
                      ? "bg-base-100 text-primary shadow-sm"
                      : "text-base-content/60 hover:text-base-content",
                  )}
                >
                  English
                </button>
                <button
                  type="button"
                  onClick={() => onLangChange("ko")}
                  className={clsx(
                    "flex-1 py-1.5 rounded-lg text-sm font-bold transition-all cursor-pointer",
                    lang === "ko"
                      ? "bg-base-100 text-primary shadow-sm"
                      : "text-base-content/60 hover:text-base-content",
                  )}
                >
                  한국어
                </button>
              </div>
            </div>
          </div>

          <Button
            type="button"
            variant="primary"
            onClick={onSave}
            disabled={!tempName.trim()}
            className="w-full mt-4 h-12 text-base font-bold shadow-lg shadow-primary/20"
          >
            Start Exploring
          </Button>
        </div>
      </div>
    </div>
  );
}
