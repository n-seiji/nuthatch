/**
 * Reading a response body without trusting its size. Whatever answers a
 * request (a hijacked connection, a misbehaving mirror, a wrong URL) could
 * stream without end, and a buffered body is memory hop would hold until the
 * process dies.
 */

const tooLarge = (maxBytes: number): Error =>
  new Error(`the response is larger than ${maxBytes} bytes`);

const concatenate = (chunks: readonly Uint8Array[], total: number): Uint8Array => {
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
};

/**
 * The whole body of `response`, or an error once it is known to exceed
 * `maxBytes`. A `Content-Length` over the cap is refused before a byte is
 * read; the bytes that actually arrive are counted as well, because the header
 * can be missing or wrong, and the stream is cancelled the moment the cap is
 * crossed. The message carries no URL: the caller adds it.
 */
export const readCapped = async (response: Response, maxBytes: number): Promise<Uint8Array> => {
  const declared = Math.trunc(Number(response.headers.get("content-length") ?? ""));
  if (declared > maxBytes) {
    await response.body?.cancel();
    throw tooLarge(maxBytes);
  }
  const chunks: Uint8Array[] = [];
  let received = 0;
  // Leaving the loop by throwing cancels the stream.
  for await (const chunk of response.body ?? []) {
    received += chunk.length;
    if (received > maxBytes) {
      throw tooLarge(maxBytes);
    }
    chunks.push(chunk);
  }
  return concatenate(chunks, received);
};
