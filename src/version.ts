import packageJson from "../package.json" with { type: "json" };

/**
 * The version of this hop. package.json is the single source: the release workflow
 * checks the `vX.Y.Z` tag against it, and the JSON is inlined by `bun build`
 * (for the Node bundle and for `--compile` alike), so it is available when
 * hop runs far away from this repository.
 */
export const VERSION: string = packageJson.version;
