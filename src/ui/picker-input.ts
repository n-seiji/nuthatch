import { type PickerActionKind, availableActions } from "../domain/actions.ts";
import type { PickCandidate } from "../domain/candidates.ts";
import { ACTION_LETTERS } from "./action-panel.tsx";
import {
  type PickerKeyModifiers,
  resolveConfirmKeyAction,
  resolvePanelKeyAction,
  resolvePickerKeyAction,
} from "./picker-keys.ts";
import type { PickerMode } from "./picker-types.ts";

type RunAction = (candidate: PickCandidate, action: PickerActionKind) => void;

interface ConfirmDeleteInputContext {
  readonly runAction: RunAction;
  readonly setMode: (mode: PickerMode) => void;
}

/** Handles a keypress while the y/N delete-confirmation overlay is open. */
export const handleConfirmDeleteInput = (
  input: string,
  key: PickerKeyModifiers,
  confirmMode: Extract<PickerMode, { kind: "confirmDelete" }>,
  ctx: ConfirmDeleteInputContext,
): void => {
  const confirmAction = resolveConfirmKeyAction(input, key);
  if (confirmAction.type === "yes") {
    ctx.runAction(confirmMode.candidate, "delete");
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
        ctx.runAction(panelMode.candidate, chosen);
      }
      break;
    }
    case "letter": {
      const chosen = actions.find((action) => ACTION_LETTERS[action] === panelAction.char);
      if (chosen !== undefined) {
        ctx.runAction(panelMode.candidate, chosen);
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
  readonly onCancel: () => void;
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
      ctx.onCancel();
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
          kind: "confirmDelete",
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
        ctx.runAction(ctx.selectedCandidate, "switchRoot");
      }
      break;
    }
    case "ignore": {
      break;
    }
  }
};
