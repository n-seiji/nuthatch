import {
  type PickerActionKind,
  availableActions,
  requiresDeleteConfirmation,
  requiresSwitchRootConfirmation,
} from "../domain/actions.ts";
import type { PickCandidate } from "../domain/candidates.ts";
import { ACTION_LETTERS } from "./side-panel.ts";
import {
  type PickerCancelReason,
  type PickerKeyModifiers,
  resolveConfirmKeyAction,
  resolvePanelKeyAction,
  resolvePickerKeyAction,
} from "./picker-keys.ts";
import type { PickerMode } from "./picker-types.ts";

type RunAction = (candidate: PickCandidate, action: PickerActionKind) => void;

/** Whether `action` on `candidate` must go through the y/N confirm overlay before running. */
const requiresConfirmation = (candidate: PickCandidate, action: PickerActionKind): boolean => {
  if (action === "delete") {
    return requiresDeleteConfirmation(candidate);
  }
  if (action === "switchRoot") {
    return requiresSwitchRootConfirmation(candidate);
  }
  return false;
};

interface ConfirmInputContext {
  readonly runAction: RunAction;
  readonly setMode: (mode: PickerMode) => void;
}

/** Handles a keypress while the y/N confirmation overlay (delete or switchRoot) is open. */
export const handleConfirmInput = (
  input: string,
  key: PickerKeyModifiers,
  confirmMode: Extract<PickerMode, { kind: "confirm" }>,
  ctx: ConfirmInputContext,
): void => {
  const confirmAction = resolveConfirmKeyAction(input, key);
  if (confirmAction.type === "yes") {
    ctx.runAction(confirmMode.candidate, confirmMode.action);
  } else {
    ctx.setMode({ kind: "list" });
  }
};

interface PanelInputContext {
  readonly panelIndex: number;
  readonly runAction: RunAction;
  readonly setPanelIndex: (updater: (current: number) => number) => void;
  readonly setMode: (mode: PickerMode) => void;
}

/**
 * Runs a panel-selected action, unless it's a delete or switchRoot that
 * requires confirmation (external worktrees) — in that case it opens the
 * same y/N overlay the list-mode shortcuts use, instead of running
 * immediately.
 */
const runOrConfirm = (
  candidate: PickCandidate,
  action: PickerActionKind,
  ctx: PanelInputContext,
): void => {
  if ((action === "delete" || action === "switchRoot") && requiresConfirmation(candidate, action)) {
    ctx.setMode({ kind: "confirm", action, candidate, error: null });
    return;
  }
  ctx.runAction(candidate, action);
};

/** Handles a keypress while the action panel is open. */
export const handlePanelInput = (
  input: string,
  key: PickerKeyModifiers,
  panelMode: Extract<PickerMode, { kind: "panel" }>,
  ctx: PanelInputContext,
): void => {
  const actions = availableActions(panelMode.candidate);
  const panelAction = resolvePanelKeyAction(input, key);
  switch (panelAction.type) {
    case "close": {
      ctx.setMode({ kind: "list" });
      break;
    }
    case "up": {
      ctx.setPanelIndex((current) => Math.max(0, current - 1));
      break;
    }
    case "down": {
      ctx.setPanelIndex((current) => Math.min(actions.length - 1, current + 1));
      break;
    }
    case "confirm": {
      const chosen = actions[Math.min(ctx.panelIndex, actions.length - 1)];
      if (chosen !== undefined) {
        runOrConfirm(panelMode.candidate, chosen, ctx);
      }
      break;
    }
    case "letter": {
      const chosen = actions.find((action) => ACTION_LETTERS[action] === panelAction.char);
      if (chosen !== undefined) {
        runOrConfirm(panelMode.candidate, chosen, ctx);
      }
      break;
    }
    case "ignore": {
      break;
    }
  }
};

interface ListInputContext {
  readonly selectedCandidate: PickCandidate | undefined;
  readonly filteredLength: number;
  readonly runAction: RunAction;
  readonly onCancel: (reason: PickerCancelReason) => void;
  readonly setIndex: (updater: (current: number) => number) => void;
  readonly setQuery: (updater: (current: string) => string) => void;
  readonly setPanelIndex: (index: number) => void;
  readonly setMode: (mode: PickerMode) => void;
}

/** Handles a keypress in the plain candidate list (the default mode). */
export const handleListInput = (
  input: string,
  key: PickerKeyModifiers,
  ctx: ListInputContext,
): void => {
  const action = resolvePickerKeyAction(input, key);
  switch (action.type) {
    case "cancel": {
      ctx.onCancel(action.reason);
      break;
    }
    case "select": {
      if (ctx.selectedCandidate !== undefined) {
        ctx.runAction(ctx.selectedCandidate, "cd");
      }
      break;
    }
    case "up": {
      ctx.setIndex((current) => Math.max(0, current - 1));
      break;
    }
    case "down": {
      ctx.setIndex((current) => Math.min(ctx.filteredLength - 1, current + 1));
      break;
    }
    case "clear": {
      ctx.setQuery(() => "");
      ctx.setIndex(() => 0);
      break;
    }
    case "backspace": {
      ctx.setQuery((current) => current.slice(0, -1));
      ctx.setIndex(() => 0);
      break;
    }
    case "char": {
      ctx.setQuery((current) => current + action.char);
      ctx.setIndex(() => 0);
      break;
    }
    case "openPanel": {
      if (ctx.selectedCandidate !== undefined) {
        ctx.setPanelIndex(0);
        ctx.setMode({
          kind: "panel",
          candidate: ctx.selectedCandidate,
          error: null,
        });
      }
      break;
    }
    case "deleteShortcut": {
      if (
        ctx.selectedCandidate !== undefined &&
        availableActions(ctx.selectedCandidate).includes("delete")
      ) {
        ctx.setMode({
          kind: "confirm",
          action: "delete",
          candidate: ctx.selectedCandidate,
          error: null,
        });
      }
      break;
    }
    case "rootSwitchShortcut": {
      if (
        ctx.selectedCandidate !== undefined &&
        availableActions(ctx.selectedCandidate).includes("switchRoot")
      ) {
        if (requiresSwitchRootConfirmation(ctx.selectedCandidate)) {
          ctx.setMode({
            kind: "confirm",
            action: "switchRoot",
            candidate: ctx.selectedCandidate,
            error: null,
          });
        } else {
          ctx.runAction(ctx.selectedCandidate, "switchRoot");
        }
      }
      break;
    }
    case "ignore": {
      break;
    }
  }
};
