import { open } from 'node:fs/promises'
import { inflateRawSync } from 'node:zlib'

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
const MAX_EOCD_SEARCH = 65_557
const ZIP64_SENTINEL_16 = 0xffff
const ZIP64_SENTINEL_32 = 0xffffffff

async function readExactly(handle, length, position) {
  const value = Buffer.alloc(length)
  let offset = 0
  while (offset < length) {
    const { bytesRead } = await handle.read(value, offset, length - offset, position + offset)
    if (bytesRead === 0) throw new Error('ZIP archive ended unexpectedly.')
    offset += bytesRead
  }
  return value
}

function normalizedEntryPath(name, directory) {
  return directory && name.endsWith('/') ? name.slice(0, -1) : name
}

const crcTable = Uint32Array.from({ length: 256 }, (_unused, value) => {
  let current = value
  for (let bit = 0; bit < 8; bit += 1)
    current = (current & 1) === 1 ? 0xedb88320 ^ (current >>> 1) : current >>> 1
  return current >>> 0
})

function crc32(value) {
  let crc = 0xffffffff
  for (const byte of value) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]
  return (crc ^ 0xffffffff) >>> 0
}

function decodeName(value, utf8) {
  const name = value.toString(utf8 ? 'utf8' : 'latin1')
  if (name.includes('\ufffd')) throw new Error('ZIP member name is not valid text.')
  return name
}

function entryKind(name, versionMadeBy, externalAttributes) {
  const hostSystem = versionMadeBy >>> 8
  const unixMode = externalAttributes >>> 16
  if (hostSystem === 3 && (unixMode & 0o170000) === 0o120000) return 'symlink'
  if (name.endsWith('/') || (externalAttributes & 0x10) !== 0) return 'directory'
  return 'file'
}

/**
 * Opens a classic, single-disk ZIP without reading the complete archive into memory.
 * The caller must validate every returned entry before invoking read().
 */
export async function openZipFile(filePath) {
  const handle = await open(filePath, 'r')
  try {
    const archiveStat = await handle.stat()
    if (!Number.isSafeInteger(archiveStat.size) || archiveStat.size < 22)
      throw new Error('ZIP archive size is invalid.')
    const tailLength = Math.min(archiveStat.size, MAX_EOCD_SEARCH)
    const tailOffset = archiveStat.size - tailLength
    const tail = await readExactly(handle, tailLength, tailOffset)
    let eocdTailOffset = -1
    for (let offset = tail.length - 22; offset >= 0; offset -= 1) {
      if (tail.readUInt32LE(offset) !== EOCD_SIGNATURE) continue
      const commentLength = tail.readUInt16LE(offset + 20)
      if (offset + 22 + commentLength === tail.length) {
        eocdTailOffset = offset
        break
      }
    }
    if (eocdTailOffset < 0) throw new Error('ZIP end-of-central-directory record is missing.')
    const disk = tail.readUInt16LE(eocdTailOffset + 4)
    const centralDisk = tail.readUInt16LE(eocdTailOffset + 6)
    const diskEntries = tail.readUInt16LE(eocdTailOffset + 8)
    const entryCount = tail.readUInt16LE(eocdTailOffset + 10)
    const centralBytes = tail.readUInt32LE(eocdTailOffset + 12)
    const centralOffset = tail.readUInt32LE(eocdTailOffset + 16)
    if (disk !== 0 || centralDisk !== 0 || diskEntries !== entryCount)
      throw new Error('Multi-disk ZIP archives are refused.')
    if (
      entryCount === ZIP64_SENTINEL_16 ||
      centralBytes === ZIP64_SENTINEL_32 ||
      centralOffset === ZIP64_SENTINEL_32
    )
      throw new Error('ZIP64 archives require an explicit reviewed decoder.')
    const eocdOffset = tailOffset + eocdTailOffset
    if (centralOffset + centralBytes > eocdOffset)
      throw new Error('ZIP central directory points outside the archive.')
    const central = await readExactly(handle, centralBytes, centralOffset)
    const entries = []
    let cursor = 0
    while (cursor < central.length) {
      if (central.length - cursor < 46 || central.readUInt32LE(cursor) !== CENTRAL_SIGNATURE)
        throw new Error('ZIP central directory is malformed.')
      const versionMadeBy = central.readUInt16LE(cursor + 4)
      const flags = central.readUInt16LE(cursor + 8)
      const method = central.readUInt16LE(cursor + 10)
      const expectedCrc32 = central.readUInt32LE(cursor + 16)
      const compressedBytes = central.readUInt32LE(cursor + 20)
      const expandedBytes = central.readUInt32LE(cursor + 24)
      const nameLength = central.readUInt16LE(cursor + 28)
      const extraLength = central.readUInt16LE(cursor + 30)
      const commentLength = central.readUInt16LE(cursor + 32)
      const diskStart = central.readUInt16LE(cursor + 34)
      const externalAttributes = central.readUInt32LE(cursor + 38)
      const localOffset = central.readUInt32LE(cursor + 42)
      const recordBytes = 46 + nameLength + extraLength + commentLength
      if (cursor + recordBytes > central.length) throw new Error('ZIP member record is truncated.')
      if ((flags & 1) !== 0) throw new Error('Encrypted ZIP members are refused.')
      if (diskStart !== 0) throw new Error('Multi-disk ZIP members are refused.')
      if (
        compressedBytes === ZIP64_SENTINEL_32 ||
        expandedBytes === ZIP64_SENTINEL_32 ||
        localOffset === ZIP64_SENTINEL_32
      )
        throw new Error('ZIP64 members require an explicit reviewed decoder.')
      if (method !== 0 && method !== 8)
        throw new Error(`ZIP compression method ${method} is refused.`)
      const rawName = central.subarray(cursor + 46, cursor + 46 + nameLength)
      const name = decodeName(rawName, (flags & 0x800) !== 0)
      const kind = entryKind(name, versionMadeBy, externalAttributes)
      const path = normalizedEntryPath(name, kind === 'directory')
      const read = async () => {
        if (kind !== 'file') return new Uint8Array()
        const local = await readExactly(handle, 30, localOffset)
        if (local.readUInt32LE(0) !== LOCAL_SIGNATURE)
          throw new Error(`ZIP local header is missing for ${JSON.stringify(path)}.`)
        const localFlags = local.readUInt16LE(6)
        const localMethod = local.readUInt16LE(8)
        const localNameLength = local.readUInt16LE(26)
        const localExtraLength = local.readUInt16LE(28)
        if (localFlags !== flags || localMethod !== method)
          throw new Error(`ZIP header metadata changed for ${JSON.stringify(path)}.`)
        const localName = await readExactly(handle, localNameLength, localOffset + 30)
        if (!localName.equals(rawName))
          throw new Error(`ZIP member name changed for ${JSON.stringify(path)}.`)
        const dataOffset = localOffset + 30 + localNameLength + localExtraLength
        if (dataOffset + compressedBytes > archiveStat.size)
          throw new Error(`ZIP member data is out of bounds for ${JSON.stringify(path)}.`)
        const compressed = await readExactly(handle, compressedBytes, dataOffset)
        const expanded =
          method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: expandedBytes })
        if (expanded.byteLength !== expandedBytes)
          throw new Error(`ZIP member size changed for ${JSON.stringify(path)}.`)
        if (crc32(expanded) !== expectedCrc32)
          throw new Error(`ZIP member CRC failed for ${JSON.stringify(path)}.`)
        return new Uint8Array(expanded.buffer, expanded.byteOffset, expanded.byteLength)
      }
      entries.push({ path, kind, expandedBytes, compressedBytes, read })
      cursor += recordBytes
    }
    if (entries.length !== entryCount)
      throw new Error(
        `ZIP directory declared ${entryCount} entries but contained ${entries.length}.`,
      )
    return {
      archiveBytes: archiveStat.size,
      entries,
      close: () => handle.close(),
    }
  } catch (error) {
    await handle.close()
    throw error
  }
}
