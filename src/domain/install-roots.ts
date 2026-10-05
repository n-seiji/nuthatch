/**
 * Package managers that keep their own copy of a compiled hop binary. Swapping
 * the file in place behind their back leaves their bookkeeping describing a
 * version that is no longer there (and the Nix store is read-only), so hop
 * leaves such a binary to the manager that owns it. Detection is by the path
 * the binary really lives at — paths are POSIX, hop only ships for
 * darwin/linux — and errs on the side of refusing.
 */

interface ManagerRoot {
  /** Path segments that only occur inside the manager's own install tree. */
  readonly markers: readonly string[];
  readonly manager: string;
  /** What to tell the user to run or use instead, ready to follow "update it with". */
  readonly update: string;
}

const MANAGER_ROOTS: readonly ManagerRoot[] = [
  { markers: ["/Cellar/"], manager: "Homebrew", update: '"brew upgrade"' },
  { markers: ["/nix/store/"], manager: "Nix", update: "Nix (the store is read-only)" },
  { markers: ["/aquaproj-aqua/", "/aqua/pkgs/"], manager: "aqua", update: "aqua" },
  { markers: ["/.proto/tools/"], manager: "proto", update: "proto" },
];

/**
 * Why a compiled binary at `binaryPath` is not hop's to replace, naming the
 * manager that owns it; null when it is in none of their install trees.
 */
export const managerRootReason = (binaryPath: string): string | null => {
  const root = MANAGER_ROOTS.find(({ markers }) =>
    markers.some((marker) => binaryPath.includes(marker)),
  );
  return root === undefined
    ? null
    : `installed by ${root.manager} (${binaryPath}); update it with ${root.update}`;
};
