/**
 * 极简 ZIP 读写
 *
 * 为什么不用现成的库：
 *  · 备份里可能塞着几百 MB 甚至上 GB 的书文件，jszip 那种「全量进内存」的写法会直接把主进程撑爆。
 *  · 这里写、读都是流式的：一个文件一个文件处理，内存占用只跟单个文件有关。
 *
 * 支持范围（够用就好，不求完整实现 ZIP 规范）：
 *  · 写：store / deflate，UTF-8 文件名，data descriptor（未知大小也能写入）
 *  · 读：store / deflate，ZIP64 目录，UTF-8 与 GBK 文件名（Windows 自带压缩常用 GBK）
 *  · 不支持：加密包、分卷包、非 deflate 的压缩算法（遇到就报一句人话）
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import iconv from 'iconv-lite';

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const DESCRIPTOR_SIG = 0x08074b50;
const MAX32 = 0xffffffff;

/** 已经压缩过的格式，再 deflate 一遍只是白烧 CPU */
const STORE_EXT = new Set([
  '.epub', '.mobi', '.azw', '.azw3', '.pdf', '.zip', '.7z', '.rar',
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp3', '.mp4', '.m4a', '.woff', '.woff2',
]);

export class ZipError extends Error {}

export class ZipTooLargeError extends ZipError {
  constructor() {
    super('备份超过 4GB，建议取消勾选「连书一起打包」后重试');
  }
}

// ───────────────────────────── CRC32 ─────────────────────────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32Update(crc: number, buf: Buffer): number {
  let c = crc ^ -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// ───────────────────────────── 写入 ─────────────────────────────

export interface ZipWriteEntry {
  /** 存档内路径，统一用 / 分隔 */
  name: string;
  /** 源文件绝对路径（与 data 二选一） */
  file?: string;
  /** 内存内容（清单、说明这类小文件） */
  data?: Buffer;
  size?: number;
}

export interface ZipWriteProgress {
  done: number;
  total: number;
  name: string;
  bytes: number;
}

function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** 写一个 zip。先写 .part，成功后才改名，中途失败不会留下半个压缩包。 */
export async function writeZipArchive(
  target: string,
  entries: ZipWriteEntry[],
  onProgress?: (p: ZipWriteProgress) => void
): Promise<{ bytes: number; entries: number }> {
  if (entries.length > 0xffff) throw new ZipError('文件数量太多，压缩包装不下');

  const part = `${target}.part`;
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  const fh = await fs.promises.open(part, 'w');
  const central: Buffer[] = [];
  const { time, date } = dosDateTime(new Date());
  let offset = 0;

  const write = async (buf: Buffer): Promise<void> => {
    if (offset + buf.length > MAX32) throw new ZipTooLargeError();
    let written = 0;
    while (written < buf.length) {
      const { bytesWritten } = await fh.write(buf, written, buf.length - written);
      if (!bytesWritten) throw new ZipError('写入失败，磁盘可能已满');
      written += bytesWritten;
    }
    offset += buf.length;
  };

  try {
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      const nameBuf = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8');
      const method = STORE_EXT.has(path.extname(entry.name).toLowerCase()) ? 0 : 8;
      const localOffset = offset;

      const header = Buffer.alloc(30);
      header.writeUInt32LE(LOCAL_SIG, 0);
      header.writeUInt16LE(20, 4);
      // bit 3 = 大小与 crc 写在数据后面的 descriptor 里；bit 11 = 文件名是 UTF-8
      header.writeUInt16LE(0x0808, 6);
      header.writeUInt16LE(method, 8);
      header.writeUInt16LE(time, 10);
      header.writeUInt16LE(date, 12);
      header.writeUInt16LE(nameBuf.length, 26);
      await write(header);
      await write(nameBuf);

      let crc = 0;
      let usize = 0;
      let csize = 0;

      if (method === 8) {
        const counter = new Transform({
          transform(chunk: Buffer, _enc, cb) {
            crc = crc32Update(crc, chunk);
            usize += chunk.length;
            cb(null, chunk);
          },
        });
        const deflate = zlib.createDeflateRaw({ level: 6 });
        const src = entry.data
          ? Readable.from([entry.data])
          : fs.createReadStream(entry.file!);
        pipeline(src, counter, deflate).catch((err) => deflate.destroy(err));
        for await (const chunk of deflate as AsyncIterable<Buffer>) {
          csize += chunk.length;
          await write(chunk);
        }
      } else if (entry.data) {
        crc = crc32Update(crc, entry.data);
        usize = entry.data.length;
        csize = usize;
        await write(entry.data);
      } else {
        for await (const chunk of fs.createReadStream(entry.file!) as AsyncIterable<Buffer>) {
          crc = crc32Update(crc, chunk);
          usize += chunk.length;
          csize += chunk.length;
          await write(chunk);
        }
      }

      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(DESCRIPTOR_SIG, 0);
      descriptor.writeUInt32LE(crc >>> 0, 4);
      descriptor.writeUInt32LE(csize, 8);
      descriptor.writeUInt32LE(usize, 12);
      await write(descriptor);

      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(CENTRAL_SIG, 0);
      cd.writeUInt16LE(20, 4);
      cd.writeUInt16LE(20, 6);
      cd.writeUInt16LE(0x0808, 8);
      cd.writeUInt16LE(method, 10);
      cd.writeUInt16LE(time, 12);
      cd.writeUInt16LE(date, 14);
      cd.writeUInt32LE(crc >>> 0, 16);
      cd.writeUInt32LE(csize, 20);
      cd.writeUInt32LE(usize, 24);
      cd.writeUInt16LE(nameBuf.length, 28);
      cd.writeUInt32LE(localOffset, 42);
      central.push(cd, nameBuf);

      onProgress?.({ done: i + 1, total: entries.length, name: entry.name, bytes: offset });
    }

    const cdOffset = offset;
    for (const buf of central) await write(buf);
    const cdSize = offset - cdOffset;

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(EOCD_SIG, 0);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(cdSize, 12);
    eocd.writeUInt32LE(cdOffset, 16);
    await write(eocd);

    await fh.close();
    if (fs.existsSync(target)) fs.rmSync(target, { force: true });
    fs.renameSync(part, target);
    return { bytes: offset, entries: entries.length };
  } catch (err) {
    try {
      await fh.close();
    } catch {
      /* ignore */
    }
    try {
      if (fs.existsSync(part)) fs.rmSync(part, { force: true });
    } catch {
      /* ignore */
    }
    throw err;
  }
}

// ───────────────────────────── 读取 ─────────────────────────────

export interface ZipIndexEntry {
  name: string;
  isDir: boolean;
  flags: number;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

function decodeName(buf: Buffer, flags: number): string {
  if (flags & 0x800) return buf.toString('utf8');
  const utf8 = buf.toString('utf8');
  if (Buffer.from(utf8, 'utf8').equals(buf)) return utf8;
  try {
    return iconv.decode(buf, 'gbk');
  } catch {
    return buf.toString('latin1');
  }
}

/** 只读中央目录，拿到文件清单；不解压任何内容 */
export async function readZipIndex(file: string): Promise<ZipIndexEntry[]> {
  const fh = await fs.promises.open(file, 'r');
  try {
    const stat = await fh.stat();
    if (stat.size < 22) throw new ZipError('这不是一个有效的 ZIP 压缩包');

    const tailLen = Math.min(stat.size, 22 + 0xffff + 20);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, stat.size - tailLen);

    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i -= 1) {
      if (tail.readUInt32LE(i) === EOCD_SIG) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new ZipError('压缩包目录损坏，或者不是 ZIP 文件');

    let total = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);

    if (total === 0xffff || cdSize === MAX32 || cdOffset === MAX32) {
      const locatorOffset = stat.size - tailLen + eocd - 20;
      if (locatorOffset >= 0) {
        const loc = Buffer.alloc(20);
        await fh.read(loc, 0, 20, locatorOffset);
        if (loc.readUInt32LE(0) === ZIP64_LOCATOR_SIG) {
          const zOffset = Number(loc.readBigUInt64LE(8));
          const z = Buffer.alloc(56);
          await fh.read(z, 0, 56, zOffset);
          if (z.readUInt32LE(0) === ZIP64_EOCD_SIG) {
            total = Number(z.readBigUInt64LE(32));
            cdSize = Number(z.readBigUInt64LE(40));
            cdOffset = Number(z.readBigUInt64LE(48));
          }
        }
      }
    }

    if (!cdSize || cdOffset > stat.size) throw new ZipError('压缩包目录不完整');

    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdOffset);

    const out: ZipIndexEntry[] = [];
    let pos = 0;
    while (pos + 46 <= cd.length && cd.readUInt32LE(pos) === CENTRAL_SIG) {
      const flags = cd.readUInt16LE(pos + 8);
      const method = cd.readUInt16LE(pos + 10);
      const crc = cd.readUInt32LE(pos + 16);
      let compressedSize = cd.readUInt32LE(pos + 20);
      let uncompressedSize = cd.readUInt32LE(pos + 24);
      const nameLen = cd.readUInt16LE(pos + 28);
      const extraLen = cd.readUInt16LE(pos + 30);
      const commentLen = cd.readUInt16LE(pos + 32);
      let localOffset = cd.readUInt32LE(pos + 42);

      const name = decodeName(cd.subarray(pos + 46, pos + 46 + nameLen), flags);

      if (
        uncompressedSize === MAX32 ||
        compressedSize === MAX32 ||
        localOffset === MAX32
      ) {
        let ep = pos + 46 + nameLen;
        const end = ep + extraLen;
        while (ep + 4 <= end) {
          const id = cd.readUInt16LE(ep);
          const len = cd.readUInt16LE(ep + 2);
          if (id === 0x0001) {
            let p = ep + 4;
            if (uncompressedSize === MAX32) {
              uncompressedSize = Number(cd.readBigUInt64LE(p));
              p += 8;
            }
            if (compressedSize === MAX32) {
              compressedSize = Number(cd.readBigUInt64LE(p));
              p += 8;
            }
            if (localOffset === MAX32) localOffset = Number(cd.readBigUInt64LE(p));
            break;
          }
          ep += 4 + len;
        }
      }

      out.push({
        name,
        isDir: name.endsWith('/'),
        flags,
        method,
        crc,
        compressedSize,
        uncompressedSize,
        localOffset,
      });

      pos += 46 + nameLen + extraLen + commentLen;
      if (out.length > total && total > 0) break;
    }

    if (!out.length) throw new ZipError('压缩包里没有任何文件');
    return out;
  } finally {
    await fh.close();
  }
}

/** 找到某个条目的数据在文件里的起始偏移 */
async function dataOffsetOf(handle: fs.promises.FileHandle, entry: ZipIndexEntry): Promise<number> {
  const lh = Buffer.alloc(30);
  await handle.read(lh, 0, 30, entry.localOffset);
  if (lh.readUInt32LE(0) !== LOCAL_SIG) throw new ZipError('压缩包结构异常，无法读取');
  const nameLen = lh.readUInt16LE(26);
  const extraLen = lh.readUInt16LE(28);
  return entry.localOffset + 30 + nameLen + extraLen;
}

function assertReadable(entry: ZipIndexEntry): void {
  if (entry.flags & 0x1) throw new ZipError('这个压缩包有密码，墨栖打不开');
  if (entry.method !== 0 && entry.method !== 8) {
    throw new ZipError(`不支持这种压缩方式（${entry.method}），请重新用 ZIP 格式导出`);
  }
}

/** 读单个条目到内存：给 json / 说明这类小文件用 */
export async function readZipEntryBuffer(file: string, entry: ZipIndexEntry): Promise<Buffer> {
  assertReadable(entry);
  const fh = await fs.promises.open(file, 'r');
  try {
    const start = await dataOffsetOf(fh, entry);
    if (!entry.compressedSize) return Buffer.alloc(0);
    const buf = Buffer.alloc(entry.compressedSize);
    await fh.read(buf, 0, buf.length, start);
    return entry.method === 8 ? zlib.inflateRawSync(buf) : buf;
  } finally {
    await fh.close();
  }
}

/** 解出单个条目到磁盘：流式，单个书文件再大也不会占满内存 */
export async function extractZipEntry(
  file: string,
  entry: ZipIndexEntry,
  dest: string
): Promise<void> {
  assertReadable(entry);
  const fh = await fs.promises.open(file, 'r');
  try {
    const start = await dataOffsetOf(fh, entry);
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    if (!entry.compressedSize) {
      await fs.promises.writeFile(dest, Buffer.alloc(0));
      return;
    }
    const end = start + entry.compressedSize - 1;
    const src = fs.createReadStream(file, { start, end });
    if (entry.method === 8) {
      await pipeline(src, zlib.createInflateRaw(), fs.createWriteStream(dest));
    } else {
      await pipeline(src, fs.createWriteStream(dest));
    }
  } finally {
    await fh.close();
  }
}

/** 归一化成存档内相对路径：反斜杠转 /，去掉开头的 /，拒绝 ../ 越界 */
export function normalizeEntryName(raw: string): string | null {
  const name = raw.replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!name) return null;
  const parts = name.split('/').filter((p) => p && p !== '.');
  if (parts.some((p) => p === '..')) return null;
  return parts.join('/');
}
