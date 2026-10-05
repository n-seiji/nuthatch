/**
 * Package managers that keep their own copy of a compiled hop binary (or, for
 * Homebrew and Nix, of the npm package). Swapping the file in place behind
 * their back leaves their bookkeeping describing a version that is no longer
 * there (and the Nix store is read-only), so hop leaves such an install to the
 * manager that owns it. Detection is by the path the install really lives at —
 * paths are POSIX, hop only ships for darwin/linux — and errs on the side of
 * refusing.
 */

interface ManagerRoot {
  /** Path segments that only occur inside the manager's own install tree. */
  readonly markers: readonly string[];
  readonly manager: string;
  /** What to tell the user to run or use instead, ready to follow "update it with". */
  readonly update: string;
  /**
   * Whether an npm global prefix inside this tree is the manager's too: a
   * Homebrew formula's `std_npm_args` installs its package under the keg's
   * `libexec`, and a Nix package is a store path. aqua and proto only keep
   * release binaries — a node they manage puts its globals in a prefix the
   * user owns, which is an ordinary npm install.
   */
  readonly ownsNpmPrefix: boolean;
}

const MANAGER_ROOTS: readonly ManagerRoot[] = [
  {
    markers: ["/Cellar/", "/Caskroom/"],
    manager: "Homebrew",
    update: '"brew upgrade"',
    ownsNpmPrefix: true,
  },
  {
    markers: ["/nix/store/"],
    manager: "Nix",
    update: "Nix (the store is read-only)",
    ownsNpmPrefix: true,
  },
  {
    markers: ["/aquaproj-aqua/", "/aqua/pkgs/"],
    manager: "aqua",
    update: "aqua",
    ownsNpmPrefix: false,
  },
  { markers: ["/.proto/tools/"], manager: "proto", update: "proto", ownsNpmPrefix: false },
];

const reasonWithin = (path: string, roots: readonly ManagerRoot[]): string | null => {
  const root = roots.find(({ markers }) => markers.some((marker) => path.includes(marker)));
  return root === undefined
    ? null
    : `installed by ${root.manager} (${path}); update it with ${root.update}`;
};

/**
 * Why a compiled binary at `binaryPath` is not hop's to replace, naming the
 * manager that owns it; null when it is in none of their install trees.
 */
export const managerRootReason = (binaryPath: string): string | null =>
  reasonWithin(binaryPath, MANAGER_ROOTS);

/**
 * Why an npm global prefix (already verified to hold hop) is not one hop may
 * `npm install -g` into, naming the manager whose tree it is; null for any
 * prefix a user would have chosen — Homebrew's shared `/opt/homebrew`
 * included, which is not inside a keg.
 */
export const managerNpmPrefixReason = (prefix: string): string | null =>
  reasonWithin(
    prefix,
    MANAGER_ROOTS.filter(({ ownsNpmPrefix }) => ownsNpmPrefix),
  );
