/** The ESC control character, written as an escape sequence so no raw control byte ends up in the source. */
export const ESC = "\u001B";

/** Whether SGR color codes should be written to `stream`: it is a terminal, and NO_COLOR (any non-empty value, per the convention) is unset. */
export const colorEnabled = (stream: { readonly isTTY?: boolean }): boolean =>
  stream.isTTY === true && (process.env["NO_COLOR"] ?? "") === "";
