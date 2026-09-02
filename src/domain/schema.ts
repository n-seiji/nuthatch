import * as v from "valibot";

/**
 * Single source of truth for nuthatch's `--json` output contract
 * (docs/design.md: `{schemaVersion, command, data, warnings}`).
 * Types are inferred from these schemas (`v.InferOutput`) rather than
 * hand-declared, so the runtime contract and the compile-time type can
 * never drift apart. valibot has no I/O, so this stays safe to import from
 * domain/ alongside the hand-written pure types.
 */

export const WorktreeKindSchema = v.picklist(["root", "managed", "external"]);
export type WorktreeKind = v.InferOutput<typeof WorktreeKindSchema>;

/** A single worktree as reported by `git worktree list`, plus nuthatch's classification. */
export const WorktreeSchema = v.object({
  path: v.string(),
  head: v.nullable(v.string()),
  branch: v.nullable(v.string()),
  detached: v.boolean(),
  bare: v.boolean(),
  locked: v.boolean(),
  lockReason: v.nullable(v.string()),
  prunable: v.boolean(),
  prunableReason: v.nullable(v.string()),
  kind: WorktreeKindSchema,
});
export type Worktree = v.InferOutput<typeof WorktreeSchema>;

/** `hop ls` per-entry shape: a Worktree plus dirty/ahead-behind status. */
export const LsEntrySchema = v.object({
  ...WorktreeSchema.entries,
  dirty: v.boolean(),
  ahead: v.nullable(v.number()),
  behind: v.nullable(v.number()),
});
export type LsEntry = v.InferOutput<typeof LsEntrySchema>;

/** `hop <branch>` (jump) data shape. */
export const JumpDataSchema = v.object({
  branch: v.string(),
  created: v.boolean(),
});
export type JumpData = v.InferOutput<typeof JumpDataSchema>;

/** `hop rm <branch>` data shape. */
export const RmDataSchema = v.object({
  branch: v.string(),
  path: v.string(),
});
export type RmData = v.InferOutput<typeof RmDataSchema>;

/** Builds the `{schemaVersion:1, command, data, warnings}` envelope schema for a given data shape. */
export const jsonEnvelopeSchema = <TDataSchema extends v.GenericSchema>(dataSchema: TDataSchema) =>
  v.object({
    schemaVersion: v.literal(1),
    command: v.string(),
    data: v.optional(dataSchema),
    warnings: v.array(v.string()),
  });

export const LsEnvelopeSchema = jsonEnvelopeSchema(v.array(LsEntrySchema));
export type LsEnvelope = v.InferOutput<typeof LsEnvelopeSchema>;

export const JumpEnvelopeSchema = jsonEnvelopeSchema(JumpDataSchema);
export type JumpEnvelope = v.InferOutput<typeof JumpEnvelopeSchema>;

export const RmEnvelopeSchema = jsonEnvelopeSchema(RmDataSchema);
export type RmEnvelope = v.InferOutput<typeof RmEnvelopeSchema>;
