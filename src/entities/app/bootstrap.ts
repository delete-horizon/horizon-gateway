import { listen } from "@tauri-apps/api/event";
import { useSetAtom } from "jotai";
import { useCallback, useEffect } from "react";
import { domainsAtom, fetchDomains } from "@/entities/domain";
import { apiLoggingLinksAtom, fetchApiLoggingLinks } from "@/entities/domain-api-logging";
import { savedPipelinesAtom } from "@/entities/pipeline";
import { fetchProxyStatus, proxyStatusAtom } from "@/entities/proxy";
import {
  migrateSandboxLibrariesFromLocalStorage,
  savedCryptoPresetsAtom,
  savedJsonSchemasAtom,
} from "@/entities/sandbox";
import type { ProxyStatusPayload } from "@/shared/api";
import {
  bootstrapDevMockAuth,
  createDevMockProfile,
  createDevMockSession,
  isDevMockAuthEnabled,
} from "@/shared/api/devMockAuth";
import { isDevLocalPasswordAuthEnabled, signInDevLocalUser } from "@/shared/api/localAuth";
import { supabase } from "@/shared/api/supabase";
import { HUB_DATA_CHANGED } from "@/shared/lib/tauri/hubEvents";
import { toastError, toastSuccess } from "@/shared/ui/toast";
import { shouldConsumeSessionHandoff, takeSessionHandoff } from "./sessionHandoff";
import { appStatusLoadedAtom, appStatusLoadingAtom, backendUnavailableAtom } from "./status/store";
import { type DBProfile, supabaseProfileAtom, supabaseSessionAtom } from "./user/store";

interface GithubIdentityInfo {
  githubId: string | null;
  githubLogin: string | null;
}

/**
 * Extracts a stable GitHub id/login from a Supabase session user so `profiles` can be
 * matched by the GitHub Sponsors webhook. Prefers `user_metadata`, falls back to scanning
 * `identities` for the `github` provider.
 */
function extractGithubIdentity(user: {
  user_metadata?: Record<string, unknown> | null;
  identities?: Array<{ provider?: string; id?: string }> | null;
}): GithubIdentityInfo {
  const meta = user.user_metadata ?? {};
  const githubLogin = (meta.user_name as string | undefined) || (meta.preferred_username as string | undefined) || null;

  let githubId: string | null = meta.provider_id ? String(meta.provider_id) : null;
  if (!githubId) {
    const githubIdentity = user.identities?.find((identity) => identity.provider === "github");
    if (githubIdentity?.id) {
      githubId = String(githubIdentity.id);
    }
  }

  return { githubId, githubLogin };
}

export function useAppBootstrap() {
  const setDomains = useSetAtom(domainsAtom);
  const setApiLoggingLinks = useSetAtom(apiLoggingLinksAtom);
  const setProxyStatus = useSetAtom(proxyStatusAtom);
  const setSavedPipelines = useSetAtom(savedPipelinesAtom);
  const setSavedJsonSchemas = useSetAtom(savedJsonSchemasAtom);
  const setSavedCryptoPresets = useSetAtom(savedCryptoPresetsAtom);
  const setLoading = useSetAtom(appStatusLoadingAtom);
  const setLoaded = useSetAtom(appStatusLoadedAtom);
  const setBackendUnavailable = useSetAtom(backendUnavailableAtom);
  const setSession = useSetAtom(supabaseSessionAtom);
  const setSupaProfile = useSetAtom(supabaseProfileAtom);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [domains, links, proxy, sandboxLibs] = await Promise.all([
        fetchDomains(),
        fetchApiLoggingLinks(),
        fetchProxyStatus(),
        migrateSandboxLibrariesFromLocalStorage(),
      ]);
      setDomains(domains);
      setApiLoggingLinks(links);
      setProxyStatus(proxy);
      setSavedPipelines(
        sandboxLibs.pipelines.map((p) => ({
          ...p,
          createdAt: p.createdAt ?? 0,
          updatedAt: p.updatedAt ?? 0,
        })),
      );
      setSavedJsonSchemas(
        sandboxLibs.schemas.map((s) => ({
          ...s,
          createdAt: s.createdAt ?? 0,
          updatedAt: s.updatedAt ?? 0,
        })),
      );
      setSavedCryptoPresets(
        sandboxLibs.presets.map((p) => ({
          ...p,
          action: p.action as import("@/entities/sandbox").CryptoAction,
          createdAt: p.createdAt ?? 0,
          updatedAt: p.updatedAt ?? 0,
        })),
      );
      setLoaded(true);
      setBackendUnavailable(null);
    } catch (e) {
      console.error("useAppBootstrap:", e);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [
    setDomains,
    setApiLoggingLinks,
    setProxyStatus,
    setSavedPipelines,
    setSavedJsonSchemas,
    setSavedCryptoPresets,
    setLoading,
    setLoaded,
    setBackendUnavailable,
  ]);

  useEffect(() => {
    let cancelled = false;
    const attemptInitialRefresh = async (retryCount = 0) => {
      try {
        await refresh();
      } catch {
        if (!cancelled && retryCount < 3) {
          const delay = Math.min(500 * 2 ** retryCount, 2000);
          setTimeout(() => {
            if (!cancelled) {
              void attemptInitialRefresh(retryCount + 1);
            }
          }, delay);
        }
      }
    };
    void attemptInitialRefresh();

    const unlistenServeReady = listen("serve-ready", () => {
      setBackendUnavailable(null);
      void refresh().catch(() => {});
    });

    const unlistenProxy = listen<ProxyStatusPayload>("proxy-status-changed", (event) => {
      if (event.payload) {
        setProxyStatus(event.payload);
      }
    });

    const unlistenHub = listen(HUB_DATA_CHANGED, () => {
      void refresh().catch(() => {});
    });

    const unlistenBackend = listen<string>("backend-unavailable", (event) => {
      setBackendUnavailable(event.payload ?? "serve backend unavailable");
    });

    const unlistenHandoff = shouldConsumeSessionHandoff()
      ? listen("session-handoff", async () => {
          try {
            const tokens = await takeSessionHandoff();
            if (cancelled || !tokens) {
              return;
            }
            const { error } = await supabase.auth.setSession({
              access_token: tokens.accessToken,
              refresh_token: tokens.refreshToken,
            });
            if (error) {
              console.error("[session-handoff] setSession failed:", error.message);
            }
          } catch (error) {
            console.warn("[session-handoff] take skipped", error);
          }
        })
      : Promise.resolve(() => {});

    // Prefer real local password auth (local Supabase) over deprecated atom mocks.
    const localPasswordAuth = isDevLocalPasswordAuthEnabled();
    const mockAuth = !localPasswordAuth && isDevMockAuthEnabled();
    const hasRefreshToken = Boolean(
      typeof import.meta.env.VITE_DEV_MOCK_REFRESH_TOKEN === "string" &&
        import.meta.env.VITE_DEV_MOCK_REFRESH_TOKEN.trim().length > 0,
    );
    // Without a real refresh token, only Jotai atoms are mocked — Supabase RLS
    // still sees no auth.uid(), so workspace create/list will fail.
    const atomsOnlyMock = mockAuth && !hasRefreshToken;

    if (shouldConsumeSessionHandoff()) {
      void (async () => {
        try {
          const tokens = await takeSessionHandoff();
          if (cancelled) {
            return;
          }
          if (tokens) {
            const { error } = await supabase.auth.setSession({
              access_token: tokens.accessToken,
              refresh_token: tokens.refreshToken,
            });
            if (!error) {
              return;
            }
            console.error("[session-handoff] setSession failed:", error.message);
          }
        } catch (error) {
          console.warn("[session-handoff] take skipped", error);
        }
        if (cancelled || !localPasswordAuth) {
          return;
        }
        const err = await signInDevLocalUser();
        if (!cancelled && err) {
          console.error("[dev] local password sign-in failed:", err);
          toastError(`로컬 로그인 실패: ${err}`);
        }
      })();
    } else if (localPasswordAuth) {
      void signInDevLocalUser().then((err) => {
        if (cancelled) {
          return;
        }
        if (err) {
          console.error("[dev] local password sign-in failed:", err);
          toastError(`로컬 로그인 실패: ${err}`);
        }
      });
    } else if (atomsOnlyMock) {
      const mockSession = createDevMockSession();
      setSession(mockSession);
      setSupaProfile(createDevMockProfile(mockSession));
      console.warn(
        "[dev] deprecated VITE_DEV_MOCK_AUTH atoms-only — prefer local Supabase + VITE_DEV_LOCAL_*",
        mockSession.user.id,
      );
    } else if (mockAuth && hasRefreshToken) {
      void bootstrapDevMockAuth().then((result) => {
        if (cancelled) {
          return;
        }
        setSession(result.session);
        if (result.mode === "atoms-only") {
          setSupaProfile(result.profile);
          console.warn("[dev] refreshSession failed; fell back to atoms-only mock");
        } else {
          console.info("[dev] mock auth via refreshSession for", result.session.user.id);
        }
      });
    }

    const skipLiveAuth = atomsOnlyMock;

    const unlistenDeepLink = skipLiveAuth
      ? Promise.resolve(() => {})
      : listen<string>("deep-link-received", async (event) => {
          const urlStr = event.payload;
          if (!urlStr?.startsWith("horizon-gateway://")) {
            return;
          }

          // Prefer query for PKCE (`?code=`), hash for legacy implicit (`#access_token=`).
          let hashParams = "";
          let queryParams = "";
          const hashIdx = urlStr.indexOf("#");
          const queryIdx = urlStr.indexOf("?");
          if (hashIdx >= 0) {
            hashParams = urlStr.slice(hashIdx + 1);
          }
          if (queryIdx >= 0) {
            const end = hashIdx > queryIdx ? hashIdx : urlStr.length;
            queryParams = urlStr.slice(queryIdx + 1, end);
          }

          const fromHash = new URLSearchParams(hashParams);
          const fromQuery = new URLSearchParams(queryParams);
          const code = fromQuery.get("code") ?? fromHash.get("code");
          const accessToken = fromHash.get("access_token") ?? fromQuery.get("access_token");
          const refreshToken = fromHash.get("refresh_token") ?? fromQuery.get("refresh_token");
          const authError =
            fromQuery.get("error_description") ??
            fromHash.get("error_description") ??
            fromQuery.get("error") ??
            fromHash.get("error");

          if (authError) {
            console.error("OAuth deep link error:", authError);
            toastError(`GitHub 로그인 실패: ${authError}`);
            return;
          }

          if (code) {
            // External-browser OAuth + custom scheme: Supabase JS defaults to PKCE.
            const { error } = await supabase.auth.exchangeCodeForSession(code);
            if (error) {
              console.error("Failed to exchange OAuth code from deep link:", error.message);
              toastError(`로그인 코드 교환 실패: ${error.message}`);
            } else {
              console.log("Supabase session established from OAuth code deep link");
              toastSuccess("GitHub 로그인 완료");
            }
            return;
          }

          if (accessToken && refreshToken) {
            const { error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            if (error) {
              console.error("Failed to set session from deep link:", error.message);
              toastError(`세션 설정 실패: ${error.message}`);
            } else {
              console.log("Supabase session established successfully from deep link!");
              toastSuccess("GitHub 로그인 완료");
            }
            return;
          }

          console.warn(
            "Auth deep link had no code/tokens (is horizon-gateway://auth-callback allowlisted in Supabase?):",
            urlStr.split(/[?#]/)[0],
          );
          toastError(
            "로그인 콜백에 code가 없습니다. Supabase Redirect URLs에 horizon-gateway://auth-callback 이 있는지 확인하세요.",
          );
        });

    let unsubscribeAuth = () => {};
    if (!skipLiveAuth) {
      const {
        data: { subscription: authSubscription },
      } = supabase.auth.onAuthStateChange(async (_event, session) => {
        setSession(session);
        console.log("Supabase AuthStateChange triggered. Session User:", session?.user?.id);
        if (session?.user) {
          const metaName =
            session.user.user_metadata?.full_name ||
            session.user.user_metadata?.name ||
            session.user.user_metadata?.user_name ||
            null;
          const metaAvatar = session.user.user_metadata?.avatar_url || null;
          const { githubId, githubLogin } = extractGithubIdentity(session.user);
          console.log("GitHub Auth User Metadata:", { metaName, metaAvatar, githubId, githubLogin });

          const { data, error } = await supabase.from("profiles").select("*").eq("id", session.user.id).single();

          let currentProfile: DBProfile | null = null;

          if (!error && data) {
            currentProfile = data as DBProfile;
            console.log("Existing Profile loaded from database:", currentProfile);
            if (
              !currentProfile.display_name ||
              !currentProfile.avatar_url ||
              (!currentProfile.github_id && githubId) ||
              (!currentProfile.github_login && githubLogin)
            ) {
              const updatedFields: Partial<DBProfile> = {};
              if (!currentProfile.display_name && metaName) {
                updatedFields.display_name = metaName;
              }
              if (!currentProfile.avatar_url && metaAvatar) {
                updatedFields.avatar_url = metaAvatar;
              }
              if (!currentProfile.github_id && githubId) {
                updatedFields.github_id = githubId;
              }
              if (!currentProfile.github_login && githubLogin) {
                updatedFields.github_login = githubLogin;
              }

              if (Object.keys(updatedFields).length > 0) {
                console.log("Attempting to sync missing fields in database profile:", updatedFields);
                const { data: updatedData, error: updateError } = await supabase
                  .from("profiles")
                  .update(updatedFields)
                  .eq("id", session.user.id)
                  .select()
                  .single();
                if (updateError) {
                  console.error(
                    "Database profile update FAILED (check RLS policies?):",
                    updateError.message,
                    updateError.details,
                  );
                } else if (updatedData) {
                  console.log("Database profile successfully updated from GitHub Metadata!", updatedData);
                  currentProfile = updatedData as DBProfile;
                }
              }
            }
            setSupaProfile(currentProfile);
          } else if (error && (error as { code?: string }).code === "PGRST116") {
            console.log("No profile row found. Creating a new profile for user:", session.user.id);
            const newProfile = {
              id: session.user.id,
              email: session.user.email || "",
              display_name: metaName,
              avatar_url: metaAvatar,
              is_sponsor: false,
              github_id: githubId,
              github_login: githubLogin,
            };
            const { data: createdData, error: createError } = await supabase
              .from("profiles")
              .upsert(newProfile)
              .select()
              .single();
            if (createError) {
              console.error("Failed to create new profile (check insert RLS?):", createError.message);
            } else if (createdData) {
              console.log("Successfully created database profile:", createdData);
              currentProfile = createdData as DBProfile;
              setSupaProfile(currentProfile);
            }
          } else if (error) {
            console.error("Failed to fetch profiles table:", error.message);
          }
        } else {
          setSupaProfile(null);
        }
      });
      unsubscribeAuth = () => authSubscription.unsubscribe();
    }

    const interval = setInterval(() => {
      void refresh();
    }, 60_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      unsubscribeAuth();
      void unlistenServeReady.then((fn) => fn());
      void unlistenProxy.then((fn) => fn());
      void unlistenHub.then((fn) => fn());
      void unlistenBackend.then((fn) => fn());
      void unlistenDeepLink.then((fn) => fn());
      void unlistenHandoff.then((fn) => fn());
    };
  }, [refresh, setProxyStatus, setSession, setSupaProfile, setBackendUnavailable]);

  return { refresh };
}
