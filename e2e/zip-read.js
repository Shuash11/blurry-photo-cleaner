/**
 * zip-read.js — minimal ZIP reader for the e2e suites (v0.6.0).
 *
 * The app's bundled download (js/ZipWriter.js) emits STORE entries only
 * (photos are already-compressed data — no deflate anywhere), so the tests
 * can verify an archive by walking the central directory and slicing the
 * stored bytes. No compression library needed.
 *
 * Usage: const { parseZip } = require("./zip-read.js");
 *        parseZip(fs.readFileSync(download.path())) →
 *        [{ name, data(Buffer), crc }, …] in central-directory order.
 */

"use strict";

const fs = require("fs");

function readZipEntries(buffer) {
  const dv = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  );
  const view = new DataView(dv);
  const u8 = new Uint8Array(dv);

  // Locate the End Of Central Directory (signature 0x06054b50) — scan the
  // last 64 KB for it (the comment field is nominally empty, but be lenient).
  let eocd = -1;
  const floor = Math.max(0, dv.byteLength - 65557);
  for (let i = dv.byteLength - 22; i >= floor; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) {
    throw new Error("zip-read: End Of Central Directory not found");
  }

  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  const decoder = new TextDecoder();
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error(`zip-read: bad central signature at ${offset}`);
    }
    const method = view.getUint16(offset + 10, true);
    const crc = view.getUint32(offset + 16, true);
    const size = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(u8.slice(offset + 46, offset + 46 + nameLen));

    if (method !== 0) {
      throw new Error(`zip-read: entry "${name}" is not STOREd (method ${method})`);
    }
    const localNameLen = view.getUint16(localOffset + 26, true);
    const extraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + extraLen;
    const data = Buffer.from(u8.slice(dataStart, dataStart + size));

    entries.push({ name, data, crc });
    offset += 46 + nameLen;
  }
  return entries;
}

function parseZip(filePath) {
  return readZipEntries(fs.readFileSync(filePath));
}

module.exports = { parseZip, readZipEntries };
