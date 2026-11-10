/**
 * ZipWriter — a minimal, dependency-free ZIP (STORE) packer for the bundled
 * photo download (v0.6.0, plan §11: "downloaded it will become in a folder
 * … not 1 at a time download").
 *
 * Why in-house: the app is dependency-free by decision (design-spec §14.1 —
 * no build step, no CDN, CSP connect-src 'none'), and photos are ALREADY
 * compressed data (PNG/JPEG/WebP), so the ZIP STORE method (no deflate)
 * loses nothing: the archive is entry bytes + ~200 bytes of structure per
 * file. A vendored zip library would be tens of KB for zero gain.
 *
 * Structure (every unzipper agrees on this): one 30-byte local file header
 * + name + stored bytes per entry, one 46-byte central-directory record per
 * entry, one 22-byte end-of-central-directory record. Names are UTF-8 (flag
 * 0x0800) so band folder names ("Needs review/") and photo filenames with
 * any unicode survive. Entry data is byte-identical — extractors verify the
 * CRC-32 (IEEE, reflected) this module computes.
 *
 * Exports:
 *   crc32(bytes)            → uint32 checksum (also used by tests)
 *   buildZipBlob(entries)   → Blob (application/zip) ready for an anchor
 *                             download; entries: { name, bytes } with bytes
 *                             a Uint8Array/ArrayBuffer view.
 */

/* CRC-32 (IEEE 802.3, reflected 0xEDB88320, init/xorout 0xFFFFFFFF) — the
   polynomial the ZIP format mandates. Table built once per session. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS date/time (the only timestamp field ZIP guarantees everywhere). */
function dosDateTime(date) {
  const dosTime =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate =
    (((date.getFullYear() - 1980) & 0x7f) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const UTF8_FLAG = 0x0800;
const STORE_METHOD = 0;

/**
 * Build the archive. `entries` is consumed in order; names may contain "/"
 * (the folder the user sees when unzipping — the download feature organizes
 * entries into the review's band folders). All entries are STOREd: sizes
 * equal, CRC-32 over the raw bytes.
 */
export function buildZipBlob(entries, now = new Date()) {
  const encoder = new TextEncoder();
  const { dosTime, dosDate } = dosDateTime(now);

  const chunks = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const data = entry.bytes instanceof Uint8Array ? entry.bytes : new Uint8Array(entry.bytes);
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL_SIG, true);
    lv.setUint16(4, 20, true); // version needed to extract (2.0 — folders/UTF-8)
    lv.setUint16(6, UTF8_FLAG, true);
    lv.setUint16(8, STORE_METHOD, true);
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true); // compressed size == stored size
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true); // no extra field
    local.set(nameBytes, 30);

    chunks.push(local, data);
    central.push({ nameBytes, crc, size: data.length, offset });
    offset += local.length + data.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const record of central) {
    const rec = new Uint8Array(46 + record.nameBytes.length);
    const cv = new DataView(rec.buffer);
    cv.setUint32(0, CENTRAL_SIG, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, UTF8_FLAG, true);
    cv.setUint16(10, STORE_METHOD, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, record.crc, true);
    cv.setUint32(20, record.size, true);
    cv.setUint32(24, record.size, true);
    cv.setUint16(28, record.nameBytes.length, true);
    cv.setUint16(30, 0, true); // no extra
    cv.setUint16(32, 0, true); // no comment
    cv.setUint16(34, 0, true); // disk number start
    cv.setUint16(36, 0, true); // internal attrs
    cv.setUint32(38, 0, true); // external attrs
    cv.setUint32(42, record.offset, true); // local header offset
    rec.set(record.nameBytes, 46);
    chunks.push(rec);
    centralSize += rec.length;
  }

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, EOCD_SIG, true);
  ev.setUint16(8, central.length, true); // entries on this disk
  ev.setUint16(10, central.length, true); // entries total
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralStart, true);
  chunks.push(eocd);

  return new Blob(chunks, { type: "application/zip" });
}

/**
 * Zip-entry names for a download set: band folder + photo filename, with
 * same-named photos suffixed " (2)", " (3)"… so a duplicate never silently
 * overwrites another (the store tolerates duplicate filenames across
 * batches). `folder` is the display label ("Blurry" / "Needs review" /
 * "Sharp") or "" for a skipped/unscored photo → archive root.
 */
export function zipEntryName(folder, filename, seen) {
  const key = `${folder}/${filename}`;
  const n = (seen.get(key) ?? 0) + 1;
  seen.set(key, n);
  const name = n === 1 ? filename : filename.replace(/(\.[^./]*)$/, ` (${n})$1`);
  return folder ? `${folder}/${name}` : name;
}
