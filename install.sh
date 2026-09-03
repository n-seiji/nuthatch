#!/bin/sh
# Installs the `hop` binary from nuthatch's GitHub Releases into
# ~/.local/bin. See docs/design.md and README.md for what hop does.
set -eu

REPO="n-seiji/nuthatch"
INSTALL_DIR="${HOP_INSTALL_DIR:-$HOME/.local/bin}"

log() {
  printf 'install.sh: %s\n' "$1" >&2
}

fail() {
  log "$1"
  exit 1
}

download() {
  url=$1
  output=$2
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$output"
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$url" -O "$output"
  else
    fail "Neither curl nor wget is available."
  fi
}

sha256_digest() {
  path=$1
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$path" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$path" | awk '{print $1}'
  else
    fail "Neither sha256sum nor shasum is available."
  fi
}

cleanup() {
  if [ -n "${tmp:-}" ]; then
    rm -f "$tmp"
  fi
  if [ -n "${checksum_tmp:-}" ]; then
    rm -f "$checksum_tmp"
  fi
}

detect_os() {
  case "$(uname -s)" in
    Darwin) echo "darwin" ;;
    Linux) echo "linux" ;;
    *) fail "Unsupported OS: $(uname -s). See README.md for other install options." ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    arm64 | aarch64) echo "arm64" ;;
    x86_64 | amd64) echo "x64" ;;
    *) fail "Unsupported architecture: $(uname -m)." ;;
  esac
}

main() {
  os=$(detect_os)
  arch=$(detect_arch)
  target="${os}-${arch}"

  if [ "$target" = "linux-arm64" ]; then
    fail "No prebuilt binary for linux-arm64 yet. Use 'npm i -g @n-seiji/nuthatch' instead."
  fi

  asset="hop-${target}"
  version="${HOP_VERSION:-latest}"
  if [ "$version" = "latest" ]; then
    url="https://github.com/${REPO}/releases/latest/download/${asset}"
  else
    url="https://github.com/${REPO}/releases/download/${version}/${asset}"
  fi
  checksum_url="${url}.sha256"

  mkdir -p "$INSTALL_DIR"
  dest="${INSTALL_DIR}/hop"
  tmp="${dest}.tmp.$$"
  checksum_tmp="${tmp}.sha256"
  trap cleanup EXIT
  trap 'exit 1' HUP INT TERM

  log "Downloading ${asset} (${version}) from ${url}"
  download "$url" "$tmp"
  download "$checksum_url" "$checksum_tmp"

  expected_checksum=$(awk 'NF { print $1; exit }' "$checksum_tmp")
  actual_checksum=$(sha256_digest "$tmp")
  if [ -z "$expected_checksum" ] || [ "$expected_checksum" != "$actual_checksum" ]; then
    fail "Checksum verification failed for ${asset}."
  fi

  chmod +x "$tmp"
  mv "$tmp" "$dest"
  tmp=""
  checksum_tmp=""
  log "Installed hop to ${dest}"

  case ":$PATH:" in
    *":${INSTALL_DIR}:"*) ;;
    *) log "Note: ${INSTALL_DIR} is not on your PATH. Add it, e.g. in ~/.zshrc:
  export PATH=\"${INSTALL_DIR}:\$PATH\"" ;;
  esac

  log "Run 'hop init zsh' for shell integration instructions."
}

main "$@"
