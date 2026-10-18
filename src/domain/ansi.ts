/** The ESC control character, written as an escape sequence so no raw control byte ends up in the source. */
export const ESC = "\u001B";

/** SGR (color/style) escape sequences shared by `hop ls` and the picker. */
export const SGR = {
  bold: `${ESC}[1m`,
  dim: `${ESC}[2m`,
  inverse: `${ESC}[7m`,
  red: `${ESC}[31m`,
  green: `${ESC}[32m`,
  yellow: `${ESC}[33m`,
  magenta: `${ESC}[35m`,
  cyan: `${ESC}[36m`,
} as const;

export const SGR_RESET = `${ESC}[0m`;
