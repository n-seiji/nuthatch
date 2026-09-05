import { useEffect, useState } from "react";

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
