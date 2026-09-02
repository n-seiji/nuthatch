const ZSH_TEMPLATE = `# nuthatch shell integration for zsh.
# Usage: eval "$(hop init zsh)"
hop() {
  if [[ "$1" == "-" ]]; then
    cd - > /dev/null || return $?
    return 0
  fi

  local should_cd=1
  case "$1" in
    ls|rm|clean|init) should_cd=0 ;;
    --) ;; # "hop -- <branch>" escapes a reserved word; still a jump, so cd.
    "")
      # Bare "hop": picker on a real terminal (cd on success), ls fallback
      # otherwise (prints a listing, not a path — don't cd). fd 2/0 are what
      # the child inherits unchanged; fd 1 is about to become the capture
      # pipe below, so it can't be checked here — this mirrors hop's own
      # isTTY() check (stderr + stdin), not stdout.
      if [[ -t 2 && -t 0 ]]; then
        should_cd=1
      else
        should_cd=0
      fi
      ;;
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
`;

export interface InitOptions {
  readonly shell: "zsh";
}

/** Returns the shell function template for `hop init <shell>`. Pure and static for now. */
export const renderInit = (options: InitOptions): string => {
  switch (options.shell) {
    case "zsh": {
      return ZSH_TEMPLATE;
    }
    default: {
      return ZSH_TEMPLATE;
    }
  }
};
