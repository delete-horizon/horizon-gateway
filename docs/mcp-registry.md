# MCP Registry

`hgc mcp` is published to the official MCP Registry as one MCPB file on the GitHub Release. Nothing in this repository publishes by itself until the `MCP_REGISTRY_PUBLISH` Actions variable is set to `true`.

## Name

`io.github.delete-horizon/horizon-gateway`

GitHub authentication is what grants that namespace. `mcp-publisher login github-oidc` in this repository receives `io.github.delete-horizon/*`, because the OIDC token's `repository_owner` is `delete-horizon`. A person using `mcp-publisher login github` can publish under the organization namespace only as an **Owner** of the `delete-horizon` organization.

MCPB does not use `mcpName`. That field is how the registry checks npm `package.json` ownership. For `registryType: mcpb` the registry checks:

- `identifier` is an `https://github.com/<owner>/<repo>/releases/download/<tag>/<file>` URL
- the URL contains `mcp` (the `.mcpb` suffix is enough)
- `fileSha256` is present
- the URL is publicly reachable (`HEAD` returns 200, or a redirect with a `Location` header)

Clients check `fileSha256` before install. The registry does not.

Do not set `registryBaseUrl` on an MCPB package.

## Bundle

The release builds standalone `hgc` for Windows x64, macOS arm64, macOS x64, and Linux x64 as part of the desktop build. One bundle, `horizon-gateway.mcpb`, contains the Windows x64 and Linux x64 binaries. The manifest runs the bundled binary with argument `mcp` only, so the server is read-only. The free Horizon Gateway desktop app has to be running; the bundle does not start it.

macOS is not in the bundle. Those `hgc` binaries are unsigned and not notarized, so Gatekeeper can block a copy extracted from a zip. The MCPB manifest also has no per-architecture key, only `darwin`, `win32`, and `linux`. On macOS, use the `hgc` that ships inside the Horizon Gateway app and run `hgc mcp`.

`compatibility.platforms` is `["win32", "linux"]`.

## server.json

The file at the repository root is the template. It has the release URL and no `fileSha256`, because the hash does not exist until the bundle is built. The release job runs `scripts/pack-hgc-mcpb.mjs`, writes `dist/server.json` with the hash, and `mcp-publisher publish` uploads that file. The shape is:

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.delete-horizon/horizon-gateway",
  "title": "Horizon Gateway",
  "description": "Read-only local proxy tools. The free Horizon Gateway app must be running.",
  "version": "2.8.15",
  "packages": [
    {
      "registryType": "mcpb",
      "identifier": "https://github.com/delete-horizon/horizon-gateway/releases/download/v2.8.15/horizon-gateway.mcpb",
      "version": "2.8.15",
      "fileSha256": "<64 lowercase hex characters of horizon-gateway.mcpb>",
      "transport": {
        "type": "stdio"
      }
    }
  ]
}
```

`SHA256SUMS` on the same release includes `horizon-gateway.mcpb`.

## Publish from a machine

The GitHub Release must already be public. Draft asset URLs fail the registry's `HEAD` check.

Install a current `mcp-publisher` from the latest GitHub Release of `modelcontextprotocol/registry`. Older binaries fail `login github-oidc` with `invalid audience`. The same current binary is what `login github` uses.

```bash
mcp-publisher login github
mcp-publisher publish dist/server.json
```

`login github` opens a browser. For an organization namespace the signed-in user must be an Owner of `delete-horizon`. A classic PAT used with `--token` needs the `read:org` scope and no repository scopes. Generate `dist/server.json` from the release `.mcpb` with `scripts/pack-hgc-mcpb.mjs` so `fileSha256` matches the uploaded file. Do not publish the template in the repository root; it has no hash.

## Publish from the release workflow

`.github/workflows/release.yml` runs on `push` of `v*` tags only. It does not run on `pull_request` or `pull_request_target`.

The registry job is the only job with `id-token: write`. Its other permission is `contents: read`. It downloads the latest `mcp-publisher` tarball at run time and, when that release includes `registry_<version>_checksums.txt`, checks the tarball against that file. Then:

```bash
./mcp-publisher login github-oidc
./mcp-publisher publish dist/server.json
```

The job runs only when the repository Actions variable `MCP_REGISTRY_PUBLISH` is exactly `true` (Settings → Secrets and variables → Actions → Variables). Leave it unset until a release should be registered.

When that variable is `true`, the same workflow also marks the GitHub Release as not a draft after `SHA256SUMS` is uploaded, so the `.mcpb` URL is public before `mcp-publisher publish`. When the variable is not `true`, the release stays a draft and the registry job is skipped.
