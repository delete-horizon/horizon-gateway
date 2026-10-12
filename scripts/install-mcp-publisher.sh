#!/usr/bin/env bash
# Download the latest mcp-publisher release for this runner.
# Older binaries fail GitHub OIDC login with "invalid audience".
# When the release publishes registry_<version>_checksums.txt, verify the tarball.
set -euo pipefail

api="https://api.github.com/repos/modelcontextprotocol/registry/releases/latest"
auth=()
token="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
if [[ -n "$token" ]]; then
  auth=(-H "Authorization: Bearer ${token}")
fi

meta="$(curl -fsSL "${auth[@]}" -H "Accept: application/vnd.github+json" "$api")"
tag="$(jq -er '.tag_name' <<<"$meta")"
version="${tag#v}"
os_name="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')"
asset="mcp-publisher_${os_name}_${arch}.tar.gz"
base="https://github.com/modelcontextprotocol/registry/releases/download/${tag}"

echo "mcp-publisher release ${tag} asset ${asset}"
curl -fsSL -o "$asset" "${base}/${asset}"

checksum_name="registry_${version}_checksums.txt"
if jq -e --arg name "$checksum_name" '.assets[] | select(.name == $name)' <<<"$meta" >/dev/null; then
  curl -fsSL -o "$checksum_name" "${base}/${checksum_name}"
  line="$(grep -E "^[0-9a-f]{64}  ${asset}$" "$checksum_name" || true)"
  if [[ -z "$line" ]]; then
    echo "checksum file ${checksum_name} has no entry for ${asset}" >&2
    exit 1
  fi
  printf '%s\n' "$line" | sha256sum -c -
else
  echo "release ${tag} has no ${checksum_name}; checksum skipped" >&2
fi

tar -xzf "$asset" mcp-publisher
chmod +x mcp-publisher
./mcp-publisher --version || ./mcp-publisher --help
