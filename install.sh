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

  mkdir -p "$INSTALL_DIR"
  dest="${INSTALL_DIR}/hop"
  tmp="${dest}.tmp.$$"

  log "Downloading ${asset} (${version}) from ${url}"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$tmp"
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$url" -O "$tmp"
  else
    fail "Neither curl nor wget is available."
  fi

  chmod +x "$tmp"
  mv "$tmp" "$dest"
  log "Installed hop to ${dest}"

  case ":$PATH:" in
    *":${INSTALL_DIR}:"*) ;;
    *) log "Note: ${INSTALL_DIR} is not on your PATH. Add it, e.g. in ~/.zshrc:
  export PATH=\"${INSTALL_DIR}:\$PATH\"" ;;
  esac

  log "Run 'hop init zsh' for shell integration instructions."
}

main "$@"
