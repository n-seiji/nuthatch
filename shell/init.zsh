# nuthatch shell integration for zsh.
# Usage: eval "$(hop init zsh)"
#
# This file is a reference copy of the template embedded in
# src/commands/init.ts (renderInit). Keep the two in sync.
hop() {
  if [[ "$1" == "-" ]]; then
    cd - > /dev/null || return $?
    return 0
  fi

  local should_cd=1
  case "$1" in
    ""|ls|rm|clean|init|--*) should_cd=0 ;;
  esac

  local out
  out="$(command hop "$@")"
  local status=$?

  if [[ $status -eq 0 && $should_cd -eq 1 && -n "$out" ]]; then
    cd -- "$out" || return $?
  elif [[ -n "$out" ]]; then
    print -r -- "$out"
  fi

  return $status
}
