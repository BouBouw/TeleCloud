import fs from 'fs'
import type { Writable } from 'stream'

/**
 * Minimal streaming ZIP writer — store-only (no compression), ZIP64-aware.
 *
 * Audio and cover art are already compressed, so deflating them would burn CPU
 * for ~0 gain; storing them lets us stream straight from disk to the socket
 * without ever holding an archive in memory or on disk.
 *
 * Each file is read twice: once to compute its CRC32, once to emit its bytes.
 * That avoids data descriptors, which some ZIP readers (notably Windows
 * Explorer, on ZIP64 archives) handle poorly.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

class Crc32 {
  private c = 0xffffffff
  update(buf: Buffer): void {
    let c = this.c
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
    this.c = c >>> 0
  }
  get value(): number {
    return (this.c ^ 0xffffffff) >>> 0
  }
}

const U32_MAX = 0xffffffff

function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear())
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

/** Strips anything that would make the entry escape the archive root. */
export function sanitizeZipName(name: string): string {
  return name
    .replace(/\\/g, '/')
    .split('/')
    .map(seg => seg.replace(/[\x00-\x1f<>:"|?*]/g, '_').replace(/^\.+$/, '_').trim())
    .filter(Boolean)
    .join('/')
}

interface Entry {
  nameBuf: Buffer
  crc: number
  size: number
  offset: number
  time: number
  date: number
  zip64: boolean
}

export class ZipStream {
  private offset = 0
  private entries: Entry[] = []
  private used = new Set<string>()

  constructor(private out: Writable) {}

  /** Returns a collision-free entry name (appends " (2)", " (3)", … before the extension). */
  uniqueName(name: string): string {
    const clean = sanitizeZipName(name) || 'file'
    if (!this.used.has(clean.toLowerCase())) { this.used.add(clean.toLowerCase()); return clean }
    const dot = clean.lastIndexOf('.')
    const base = dot > 0 ? clean.slice(0, dot) : clean
    const ext  = dot > 0 ? clean.slice(dot) : ''
    for (let i = 2; ; i++) {
      const candidate = `${base} (${i})${ext}`
      if (!this.used.has(candidate.toLowerCase())) { this.used.add(candidate.toLowerCase()); return candidate }
    }
  }

  private async write(buf: Buffer): Promise<void> {
    this.offset += buf.length
    if (this.out.write(buf)) return
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        this.out.removeListener('drain', onDrain)
        this.out.removeListener('error', onError)
        this.out.removeListener('close', onClose)
      }
      const onDrain = () => { cleanup(); resolve() }
      const onError = (e: Error) => { cleanup(); reject(e) }
      const onClose = () => { cleanup(); reject(new Error('Output stream closed')) }
      this.out.once('drain', onDrain)
      this.out.once('error', onError)
      this.out.once('close', onClose)
    })
  }

  private async writeEntryHeader(name: string, crc: number, size: number, mtime: Date): Promise<Entry> {
    const nameBuf = Buffer.from(name, 'utf8')
    const { time, date } = dosDateTime(mtime)
    const zip64 = size >= U32_MAX

    const extra = zip64 ? Buffer.alloc(20) : Buffer.alloc(0)
    if (zip64) {
      extra.writeUInt16LE(0x0001, 0)
      extra.writeUInt16LE(16, 2)
      extra.writeBigUInt64LE(BigInt(size), 4)
      extra.writeBigUInt64LE(BigInt(size), 12)
    }

    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(zip64 ? 45 : 20, 4)   // version needed
    header.writeUInt16LE(0x0800, 6)            // UTF-8 filenames
    header.writeUInt16LE(0, 8)                 // method: store
    header.writeUInt16LE(time, 10)
    header.writeUInt16LE(date, 12)
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(zip64 ? U32_MAX : size, 18)
    header.writeUInt32LE(zip64 ? U32_MAX : size, 22)
    header.writeUInt16LE(nameBuf.length, 26)
    header.writeUInt16LE(extra.length, 28)

    const entry: Entry = { nameBuf, crc, size, offset: this.offset, time, date, zip64 }
    await this.write(Buffer.concat([header, nameBuf, extra]))
    this.entries.push(entry)
    return entry
  }

  async addBuffer(name: string, data: Buffer, mtime = new Date()): Promise<void> {
    const crc = new Crc32()
    crc.update(data)
    await this.writeEntryHeader(this.uniqueName(name), crc.value, data.length, mtime)
    await this.write(data)
  }

  async addFile(name: string, absPath: string, mtime?: Date): Promise<void> {
    const stat = await fs.promises.stat(absPath)

    const crc = new Crc32()
    for await (const chunk of fs.createReadStream(absPath)) crc.update(chunk as Buffer)

    await this.writeEntryHeader(this.uniqueName(name), crc.value, stat.size, mtime ?? stat.mtime)

    let written = 0
    for await (const chunk of fs.createReadStream(absPath)) {
      const buf = chunk as Buffer
      // The file changed under us mid-read — truncate/pad so the declared size holds.
      if (written + buf.length > stat.size) {
        await this.write(buf.subarray(0, stat.size - written))
        written = stat.size
        break
      }
      await this.write(buf)
      written += buf.length
    }
    if (written < stat.size) await this.write(Buffer.alloc(stat.size - written))
  }

  /** Writes the central directory + end-of-central-directory records. */
  async finalize(): Promise<void> {
    const cdStart = this.offset
    let needsZip64 = this.entries.length > 0xffff || cdStart >= U32_MAX

    for (const e of this.entries) {
      const bigOffset = e.offset >= U32_MAX
      const useZip64  = e.zip64 || bigOffset
      if (useZip64) needsZip64 = true

      // When ZIP64 is needed the three overflow-prone fields are emitted together,
      // in the order the spec mandates: uncompressed, compressed, local offset.
      const extra = useZip64 ? Buffer.alloc(28) : Buffer.alloc(0)
      if (useZip64) {
        extra.writeUInt16LE(0x0001, 0)
        extra.writeUInt16LE(24, 2)
        extra.writeBigUInt64LE(BigInt(e.size), 4)
        extra.writeBigUInt64LE(BigInt(e.size), 12)
        extra.writeBigUInt64LE(BigInt(e.offset), 20)
      }

      const cd = Buffer.alloc(46)
      cd.writeUInt32LE(0x02014b50, 0)
      cd.writeUInt16LE(useZip64 ? 45 : 20, 4)   // version made by
      cd.writeUInt16LE(useZip64 ? 45 : 20, 6)   // version needed
      cd.writeUInt16LE(0x0800, 8)
      cd.writeUInt16LE(0, 10)                   // method: store
      cd.writeUInt16LE(e.time, 12)
      cd.writeUInt16LE(e.date, 14)
      cd.writeUInt32LE(e.crc, 16)
      cd.writeUInt32LE(useZip64 ? U32_MAX : e.size, 20)
      cd.writeUInt32LE(useZip64 ? U32_MAX : e.size, 24)
      cd.writeUInt16LE(e.nameBuf.length, 28)
      cd.writeUInt16LE(extra.length, 30)
      cd.writeUInt16LE(0, 32)                   // comment length
      cd.writeUInt16LE(0, 34)                   // disk number start
      cd.writeUInt16LE(0, 36)                   // internal attributes
      cd.writeUInt32LE(0, 38)                   // external attributes
      cd.writeUInt32LE(useZip64 ? U32_MAX : e.offset, 42)

      await this.write(Buffer.concat([cd, e.nameBuf, extra]))
    }

    const cdSize = this.offset - cdStart
    if (cdSize >= U32_MAX) needsZip64 = true

    if (needsZip64) {
      const zip64Eocd = Buffer.alloc(56)
      zip64Eocd.writeUInt32LE(0x06064b50, 0)
      zip64Eocd.writeBigUInt64LE(BigInt(44), 4)         // size of this record - 12
      zip64Eocd.writeUInt16LE(45, 12)                   // version made by
      zip64Eocd.writeUInt16LE(45, 14)                   // version needed
      zip64Eocd.writeUInt32LE(0, 16)                    // this disk
      zip64Eocd.writeUInt32LE(0, 20)                    // disk with CD start
      zip64Eocd.writeBigUInt64LE(BigInt(this.entries.length), 24)
      zip64Eocd.writeBigUInt64LE(BigInt(this.entries.length), 32)
      zip64Eocd.writeBigUInt64LE(BigInt(cdSize), 40)
      zip64Eocd.writeBigUInt64LE(BigInt(cdStart), 48)

      const zip64EocdOffset = this.offset
      await this.write(zip64Eocd)

      const locator = Buffer.alloc(20)
      locator.writeUInt32LE(0x07064b50, 0)
      locator.writeUInt32LE(0, 4)
      locator.writeBigUInt64LE(BigInt(zip64EocdOffset), 8)
      locator.writeUInt32LE(1, 16)
      await this.write(locator)
    }

    const count = Math.min(this.entries.length, 0xffff)
    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(0x06054b50, 0)
    eocd.writeUInt16LE(0, 4)
    eocd.writeUInt16LE(0, 6)
    eocd.writeUInt16LE(count, 8)
    eocd.writeUInt16LE(count, 10)
    eocd.writeUInt32LE(cdSize >= U32_MAX ? U32_MAX : cdSize, 12)
    eocd.writeUInt32LE(cdStart >= U32_MAX ? U32_MAX : cdStart, 16)
    eocd.writeUInt16LE(0, 20)
    await this.write(eocd)
  }
}
