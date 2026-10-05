/**
 * The outcome of an operation that may reject, as a value: self-update has
 * many small steps that each map their own failure to a message and an exit
 * code, and a `let` assigned inside a `try` is the alternative.
 */
export type Attempt<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: unknown };

export const attempt = async <T>(run: () => Promise<T>): Promise<Attempt<T>> => {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, error };
  }
};
