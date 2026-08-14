export function utf8Bytes(value: string): Uint8Array {
  const output: number[] = []
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint === undefined) continue
    if (codePoint <= 0x7f) output.push(codePoint)
    else if (codePoint <= 0x7ff) output.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f))
    else if (codePoint <= 0xffff)
      output.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      )
    else
      output.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      )
  }
  return Uint8Array.from(output)
}

export function utf8ByteLength(value: string): number {
  return utf8Bytes(value).byteLength
}
