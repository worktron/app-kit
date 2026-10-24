// Chrome's native messaging framing: each message is a 4-byte little-endian
// length followed by that many bytes of UTF-8 JSON.

export function frame(message: unknown): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(message))
  const out = new Uint8Array(4 + body.length)
  new DataView(out.buffer).setUint32(0, body.length, true)
  out.set(body, 4)
  return out
}

/** Collects bytes as they arrive and hands back each complete message. */
export class Unframer {
  private buffer = new Uint8Array(0)

  push(chunk: Uint8Array): unknown[] {
    const joined = new Uint8Array(this.buffer.length + chunk.length)
    joined.set(this.buffer)
    joined.set(chunk, this.buffer.length)
    this.buffer = joined
    const messages: unknown[] = []
    while (this.buffer.length >= 4) {
      const length = new DataView(this.buffer.buffer, this.buffer.byteOffset).getUint32(0, true)
      if (this.buffer.length < 4 + length) break
      messages.push(JSON.parse(new TextDecoder().decode(this.buffer.subarray(4, 4 + length))))
      this.buffer = this.buffer.slice(4 + length)
    }
    return messages
  }
}
