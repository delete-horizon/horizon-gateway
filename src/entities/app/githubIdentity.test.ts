import { describe, expect, it } from "vitest";
import { extractGithubIdentity } from "./githubIdentity";

describe("extractGithubIdentity", () => {
  it("reads the GitHub provider id and login from the auth identity", () => {
    expect(
      extractGithubIdentity({
        identities: [
          {
            provider: "github",
            provider_id: "12345",
            identity_data: { user_name: "octocat", sub: "999" },
          },
        ],
      }),
    ).toEqual({ githubId: "12345", githubLogin: "octocat" });
  });

  it("ignores editable user metadata and non-GitHub identities", () => {
    const user = {
      identities: [{ provider: "email", provider_id: "111", identity_data: { provider_id: "111" } }],
      user_metadata: { provider_id: "42", user_name: "hacker" },
    };
    expect(extractGithubIdentity(user)).toEqual({ githubId: null, githubLogin: null });
  });

  it("rejects ids and logins that are not GitHub-shaped", () => {
    expect(
      extractGithubIdentity({
        identities: [
          {
            provider: "github",
            provider_id: "not-a-number",
            identity_data: { sub: "123", user_name: "bad login", preferred_username: "ok-name" },
          },
        ],
      }),
    ).toEqual({ githubId: "123", githubLogin: "ok-name" });
  });
});
