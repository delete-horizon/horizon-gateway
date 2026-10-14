export interface GithubIdentityInfo {
  githubId: string | null;
  githubLogin: string | null;
}

/**
 * GitHub id and login used to match Sponsors webhooks.
 * Reads the GitHub auth identity only. `user_metadata` is editable by the
 * user and must not be copied onto `profiles`.
 */
export function extractGithubIdentity(user: {
  identities?: Array<{
    provider?: string;
    provider_id?: unknown;
    identity_data?: object | null;
  }> | null;
}): GithubIdentityInfo {
  const identity = user.identities?.find((item) => item.provider === "github");
  const data = identity?.identity_data;
  const resolvedId =
    githubId(identity?.provider_id) ?? githubId(readField(data, "provider_id")) ?? githubId(readField(data, "sub"));
  const resolvedLogin = githubLogin(readField(data, "user_name")) ?? githubLogin(readField(data, "preferred_username"));
  return { githubId: resolvedId, githubLogin: resolvedLogin };
}

function readField(data: object | null | undefined, key: string): unknown {
  if (!data || !(key in data)) {
    return undefined;
  }
  return (data as Record<string, unknown>)[key];
}

function githubId(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    const text = String(value);
    return /^[0-9]{1,12}$/.test(text) ? text : null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return /^[0-9]{1,12}$/.test(trimmed) ? trimmed : null;
}

function githubLogin(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return /^[A-Za-z0-9-]{1,39}$/.test(trimmed) ? trimmed : null;
}
