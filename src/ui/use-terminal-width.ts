import { useEffect, useState } from "react";
import { DEFAULT_TERMINAL_HEIGHT } from "./picker-viewport.ts";

const DEFAULT_TERMINAL_WIDTH = 80;

/**
 * Live-updated terminal width (in columns) of the given stream, used to
 * decide whether the action panel fits as a side column (see
 * picker-layout.ts's isNarrowTerminal) or must fall back to stacking below
 * the list. Reads `stream.columns` directly — the same value ink's own
 * layout engine uses for the stream passed to `render()` — rather than
 * introducing a second measurement mechanism.
 */
export const useTerminalWidth = (stream: NodeJS.WriteStream): number => {
  const [width, setWidth] = useState(() => stream.columns ?? DEFAULT_TERMINAL_WIDTH);

  useEffect(() => {
    const handleResize = (): void => {
      setWidth(stream.columns ?? DEFAULT_TERMINAL_WIDTH);
    };
    stream.on("resize", handleResize);
    return () => {
      stream.off("resize", handleResize);
    };
  }, [stream]);

  return width;
};

/**
 * Live-updated terminal height (in rows) of the given stream — the other
 * half of `useTerminalWidth`, used by picker-viewport.ts's `rowBudget` to
 * decide how many candidate rows fit on screen. Falls back to
 * DEFAULT_TERMINAL_HEIGHT (see picker-viewport.ts) when `stream.rows` is
 * unavailable (not a TTY, or an early resize event before the terminal
 * reports a size).
 */
export const useTerminalHeight = (stream: NodeJS.WriteStream): number => {
  const [height, setHeight] = useState(() => stream.rows ?? DEFAULT_TERMINAL_HEIGHT);

  useEffect(() => {
    const handleResize = (): void => {
      setHeight(stream.rows ?? DEFAULT_TERMINAL_HEIGHT);
    };
    stream.on("resize", handleResize);
    return () => {
      stream.off("resize", handleResize);
    };
  }, [stream]);

  return height;
};
