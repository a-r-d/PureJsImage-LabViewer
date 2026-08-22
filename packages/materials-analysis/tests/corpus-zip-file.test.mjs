import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { validateArchiveEntries } from '../../test-corpus/src/archive.ts'
import { openZipFile } from '../scripts/corpus/zip-file.mjs'

const temporaryDirectories = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  )
})

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

function storedZip(entries) {
  const locals = []
  const centrals = []
  let localOffset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.path)
    const data = Buffer.from(entry.data)
    const checksum = entry.centralCrc32 ?? crc32(data)
    const local = Buffer.alloc(30 + name.length + data.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc32(data), 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    name.copy(local, 30)
    data.copy(local, 30 + name.length)
    locals.push(local)

    const central = Buffer.alloc(46 + name.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(0x0314, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(localOffset, 42)
    name.copy(central, 46)
    centrals.push(central)
    localOffset += local.length
  }
  const centralBytes = centrals.reduce((total, value) => total + value.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBytes, 12)
  end.writeUInt32LE(localOffset, 16)
  return Buffer.concat([...locals, ...centrals, end])
}

async function fixture(entries) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pji-corpus-zip-'))
  temporaryDirectories.push(directory)
  const file = path.join(directory, 'fixture.zip')
  await writeFile(file, storedZip(entries))
  return file
}

const budgets = {
  maxFiles: 8,
  maxExpandedBytes: 1024,
  maxFileBytes: 512,
  maxCompressionRatio: 20,
  maxPathLength: 160,
}

describe('file-backed corpus ZIP reader', () => {
  it('lists and reads stored members without loading the archive eagerly', async () => {
    const archive = await openZipFile(
      await fixture([
        { path: 'images/a.tif', data: [1, 2, 3] },
        { path: 'masks/a.tif', data: [4, 5] },
      ]),
    )
    try {
      expect(validateArchiveEntries(archive.entries, budgets)).toEqual([])
      expect(archive.entries.map(({ path: entryPath }) => entryPath)).toEqual([
        'images/a.tif',
        'masks/a.tif',
      ])
      await expect(archive.entries[0].read()).resolves.toEqual(new Uint8Array([1, 2, 3]))
    } finally {
      await archive.close()
    }
  })

  it('leaves traversal refusal to the shared complete-directory validator', async () => {
    const archive = await openZipFile(await fixture([{ path: '../outside.tif', data: [1] }]))
    try {
      expect(validateArchiveEntries(archive.entries, budgets).join(' ')).toContain(
        'Unsafe archive path',
      )
    } finally {
      await archive.close()
    }
  })

  it('verifies member CRC before returning bytes', async () => {
    const archive = await openZipFile(
      await fixture([{ path: 'images/a.tif', data: [1, 2, 3], centralCrc32: 0 }]),
    )
    try {
      await expect(archive.entries[0].read()).rejects.toThrow('CRC failed')
    } finally {
      await archive.close()
    }
  })
})
