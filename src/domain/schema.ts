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

export const PickEnvelopeSchema = jsonEnvelopeSchema(PickDataSchema);
export type PickEnvelope = InferOutput<typeof PickEnvelopeSchema>;
