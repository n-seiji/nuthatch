import {
  type GenericSchema,
  type InferOutput,
  array,
  boolean,
  literal,
  nullable,
  number,
  object,
  optional,
  picklist,
  string,
  variant,
} from "valibot";

/**
 * Single source of truth for nuthatch's `--json` output contract
 * (docs/design.md: `{schemaVersion, command, data, warnings}`).
 * Types are inferred from these schemas (`InferOutput`) rather than
 * hand-declared, so the runtime contract and the compile-time type can
 * never drift apart. valibot has no I/O, so this stays safe to import from
 * domain/ alongside the hand-written pure types.
 */

export const WorktreeKindSchema = picklist(["root", "managed", "external"]);
export type WorktreeKind = InferOutput<typeof WorktreeKindSchema>;

/** A single worktree as reported by `git worktree list`, plus nuthatch's classification. */
export const WorktreeSchema = object({
  path: string(),
  head: nullable(string()),
  branch: nullable(string()),
  detached: boolean(),
  bare: boolean(),
  locked: boolean(),
  lockReason: nullable(string()),
  prunable: boolean(),
  prunableReason: nullable(string()),
  kind: WorktreeKindSchema,
});
export type Worktree = InferOutput<typeof WorktreeSchema>;

/** `hop ls` per-entry shape: a Worktree plus dirty/ahead-behind status. */
export const LsEntrySchema = object({
  ...WorktreeSchema.entries,
  dirty: boolean(),
  ahead: nullable(number()),
  behind: nullable(number()),
});
export type LsEntry = InferOutput<typeof LsEntrySchema>;

/** `hop <branch>` (jump) data shape. */
export const JumpDataSchema = object({
  branch: string(),
  created: boolean(),
});
export type JumpData = InferOutput<typeof JumpDataSchema>;

/** `hop rm <branch>` data shape. */
export const RmDataSchema = object({
  branch: string(),
  path: string(),
});
export type RmData = InferOutput<typeof RmDataSchema>;

const PickSourceSchema = picklist(["local", "remote"]);
const NullableBooleanSchema = nullable(boolean());

/** A candidate for the interactive `hop` picker. */
export const PickCandidateSchema = variant("kind", [
  object({
    kind: literal("worktree"),
    worktree: WorktreeSchema,
    dirty: NullableBooleanSchema,
  }),
  object({
    kind: literal("creatable"),
    branch: string(),
    source: PickSourceSchema,
  }),
]);
export type PickCandidate = InferOutput<typeof PickCandidateSchema>;

/** `hop` picker data shape. */
export const PickDataSchema = object({
  candidates: array(PickCandidateSchema),
});
export type PickData = InferOutput<typeof PickDataSchema>;

/** Builds the `{schemaVersion:1, command, data, warnings}` envelope schema for a given data shape. */
export const jsonEnvelopeSchema = <TDataSchema extends GenericSchema>(dataSchema: TDataSchema) =>
  object({
    schemaVersion: literal(1),
    command: string(),
    data: optional(dataSchema),
    warnings: array(string()),
  });

export const LsEnvelopeSchema = jsonEnvelopeSchema(array(LsEntrySchema));
export type LsEnvelope = InferOutput<typeof LsEnvelopeSchema>;

export const JumpEnvelopeSchema = jsonEnvelopeSchema(JumpDataSchema);
export type JumpEnvelope = InferOutput<typeof JumpEnvelopeSchema>;

export const RmEnvelopeSchema = jsonEnvelopeSchema(RmDataSchema);
export type RmEnvelope = InferOutput<typeof RmEnvelopeSchema>;

const NullableStringSchema = nullable(string());

/** `hop root [<branch>|-]` data shape. */
export const RootDataSchema = object({
  branch: NullableStringSchema,
  switched: boolean(),
  /** Path of a worktree this switch detached HEAD on to free up the branch, if any. */
  detachedHolder: optional(NullableStringSchema),
});
export type RootData = InferOutput<typeof RootDataSchema>;

export const RootEnvelopeSchema = jsonEnvelopeSchema(RootDataSchema);
export type RootEnvelope = InferOutput<typeof RootEnvelopeSchema>;

export const GarbageReasonSchema = picklist(["prunable", "merged", "gone"]);
export type GarbageReason = InferOutput<typeof GarbageReasonSchema>;

/** A single `hop clean` candidate: a managed (or, with --ext, external) worktree safe to remove. */
export const CleanCandidateSchema = object({
  branch: string(),
  path: string(),
  reason: GarbageReasonSchema,
});
export type CleanCandidate = InferOutput<typeof CleanCandidateSchema>;

const RemovedBranchesSchema = array(string());

/** `hop clean` data shape. `removed` is omitted for --dry-run (candidates only, nothing executed). */
export const CleanDataSchema = object({
  candidates: array(CleanCandidateSchema),
  removed: optional(RemovedBranchesSchema),
});
export type CleanData = InferOutput<typeof CleanDataSchema>;

export const CleanEnvelopeSchema = jsonEnvelopeSchema(CleanDataSchema);
export type CleanEnvelope = InferOutput<typeof CleanEnvelopeSchema>;

/** One uncommitted change in `hop status`: git's two-letter porcelain `XY` code and the path, relative to the worktree. */
export const StatusChangeSchema = object({
  status: string(),
  path: string(),
});
export type StatusChange = InferOutput<typeof StatusChangeSchema>;

/** The commit a worktree's HEAD points at. `date` is the committer date, ISO 8601. */
export const StatusCommitSchema = object({
  sha: string(),
  subject: string(),
  date: string(),
});
export type StatusCommit = InferOutput<typeof StatusCommitSchema>;

/**
 * `hop status [<branch>]` data shape: everything `hop ls` reports for one
 * worktree, plus what an agent needs to judge it without running git itself.
 * `changes` is empty when there is no working tree to inspect (bare,
 * prunable, or its directory is gone). `cleanReason` is the reason
 * `hop clean` would give for this worktree (null: not garbage) — computed for
 * every kind, though `hop clean` only removes managed ones by default.
 */
export const StatusDataSchema = object({
  ...LsEntrySchema.entries,
  upstream: NullableStringSchema,
  lastCommit: nullable(StatusCommitSchema),
  changes: array(StatusChangeSchema),
  cleanReason: nullable(GarbageReasonSchema),
});
export type StatusData = InferOutput<typeof StatusDataSchema>;

export const StatusEnvelopeSchema = jsonEnvelopeSchema(StatusDataSchema);
export type StatusEnvelope = InferOutput<typeof StatusEnvelopeSchema>;

/**
 * `hop mcp install <client>` data shape. `method` is how the client is
 * configured: `cli` (claude / codex: hop runs the client's own `mcp add`,
 * `command` is that argv, `configPath` null) or `file` (cursor / opencode:
 * hop edits the client's user-level JSON config at `configPath`, `command`
 * null). `ran` is whether hop ran the command or wrote the file — false for
 * `--dry-run`, and for a file that already registers hop exactly so.
 */
const McpCommandSchema = array(string());
export const McpInstallDataSchema = object({
  client: picklist(["claude", "codex", "cursor", "opencode"]),
  method: picklist(["cli", "file"]),
  command: nullable(McpCommandSchema),
  configPath: NullableStringSchema,
  ran: boolean(),
});
export type McpInstallData = InferOutput<typeof McpInstallDataSchema>;

export const McpInstallEnvelopeSchema = jsonEnvelopeSchema(McpInstallDataSchema);
export type McpInstallEnvelope = InferOutput<typeof McpInstallEnvelopeSchema>;

/** `hop mcp config` data shape: an `mcpServers` entry for clients configured by a JSON file. */
const McpServerEntrySchema = object({
  command: string(),
  args: array(string()),
});
const McpServersSchema = object({ hop: McpServerEntrySchema });
export const McpConfigDataSchema = object({ mcpServers: McpServersSchema });
export type McpConfigData = InferOutput<typeof McpConfigDataSchema>;

export const McpConfigEnvelopeSchema = jsonEnvelopeSchema(McpConfigDataSchema);
export type McpConfigEnvelope = InferOutput<typeof McpConfigEnvelopeSchema>;

export const PickEnvelopeSchema = jsonEnvelopeSchema(PickDataSchema);
export type PickEnvelope = InferOutput<typeof PickEnvelopeSchema>;

const UpdateCommandSchema = array(string());

/**
 * `hop --update` data shape. `updateAvailable` is `latest > current`.
 * `action` is what hop itself did: `none` (already up to date, `--check`, or
 * mise answering, before `mise upgrade` ran, that it would not upgrade hop —
 * `updateAvailable` is still true then, and a warning says why), `replaced`
 * (the standalone binary was swapped), or `delegated` (the package manager's
 * own upgrade command ran and exited 0). For `delegated`, hop only knows the
 * command succeeded — the package manager may still decide not to move.
 * `command` is the package manager argv that ran (`delegated`) or that would
 * run (`--check` with an update available on mise/npm/bun); otherwise null,
 * always for standalone.
 */
export const UpdateDataSchema = object({
  current: string(),
  latest: string(),
  updateAvailable: boolean(),
  method: picklist(["standalone", "mise", "npm", "bun"]),
  action: picklist(["none", "replaced", "delegated"]),
  command: nullable(UpdateCommandSchema),
});
export type UpdateData = InferOutput<typeof UpdateDataSchema>;

export const UpdateEnvelopeSchema = jsonEnvelopeSchema(UpdateDataSchema);
export type UpdateEnvelope = InferOutput<typeof UpdateEnvelopeSchema>;
