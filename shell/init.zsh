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
    ""|ls|rm|clean|init) should_cd=0 ;;
    --) ;; # "hop -- <branch>" escapes a reserved word; still a jump, so cd.
    --*) should_cd=0 ;;
  esac

  # "status" is a zsh read-only special parameter (mirrors $?); using it as a
  # local name fails with "read-only variable: status". Use "rc" instead, and
  # declare it before the command substitution so the exit code isn't
  # clobbered by "local"'s own exit status.
  local out rc
  out="$(command hop "$@")"
  rc=$?

  if [[ $rc -eq 0 && $should_cd -eq 1 && -n "$out" ]]; then
    cd -- "$out" || return $?
  elif [[ -n "$out" ]]; then
    print -r -- "$out"
  fi

  return $rc
}
