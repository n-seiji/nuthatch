const ZSH_TEMPLATE = `# nuthatch shell integration for zsh.
# Usage: eval "$(hop init zsh)"
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
`;

export interface InitOptions {
  readonly shell: "zsh";
}

/** Returns the shell function template for `hop init <shell>`. Pure and static for now. */
export const renderInit = (options: InitOptions): string => {
  switch (options.shell) {
    case "zsh":
      return ZSH_TEMPLATE;
    default:
      return ZSH_TEMPLATE;
  }
};
