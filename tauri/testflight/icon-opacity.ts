/*
 * How many of a PNG's pixels are at each opacity, which the TestFlight upload reads in an App Store icon before the
 * build, since App Store Connect refuses one with a pixel that is not fully opaque only after it (upload.ts, native.ts).
 */
import { inflateSync } from 'node:zlib';

/** Each colour type's samples per pixel: grey, colour, palette, grey with alpha, colour with alpha. */
const PNG_CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
/** Adam7's seven passes over an interlaced image: the first column and row of each, and its steps across and down. */
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] as const;

/**
 * How many of a PNG's pixels are at each opacity, from 0 (see-through) to 255 (opaque), a 16-bit alpha rounded down so
 * only a full one counts as 255; null when the bytes are not a PNG whose first chunk is its header, or its image data
 * cannot be read. An image with no alpha channel and no transparency chunk is opaque without being decoded; any other is
 * decoded whole: every colour type, bit depth, row filter and Adam7's interlacing, so a transparency only an unused
 * palette entry or colour carries counts for nothing, as on the phone.
 */
export function pngOpacities(bytes: Uint8Array): number[] | null {
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (view.length < 33 || !view.subarray(0, 8).equals(signature) || view.toString('latin1', 12, 16) !== 'IHDR') return null;
  const [width, height, depth, colourType, interlace] = [view.readUInt32BE(16), view.readUInt32BE(20), view[24]!, view[25]!, view[28]!];
  const channels = PNG_CHANNELS[colourType];
  if (!channels || !width || !height || ![1, 2, 4, 8, 16].includes(depth) || interlace > 1) return null;
  let transparency: Buffer | undefined;
  const data: Buffer[] = [];
  for (let at = 8; at + 12 <= view.length; ) {
    const length = view.readUInt32BE(at);
    const type = view.toString('latin1', at + 4, at + 8);
    const body = view.subarray(at + 8, at + 8 + length);
    if (type === 'tRNS') transparency = body;
    if (type === 'IDAT') data.push(body);
    if (type === 'IEND') break;
    at += 12 + length;
  }
  // A colour key holds a two-byte value for each channel; one cut short cannot say which colour it makes see-through.
  if (transparency && (colourType === 0 || colourType === 2) && transparency.length < channels * 2) return null;
  const counts = Array.from({ length: 256 }, () => 0);
  if (colourType !== 4 && colourType !== 6 && !transparency) {
    counts[255] = width * height;
    return counts;
  }
  let pixels: Buffer;
  try {
    pixels = inflateSync(Buffer.concat(data));
  } catch {
    return null;
  }
  const max = (1 << depth) - 1;
  const bits = channels * depth;
  const step = Math.max(1, bits >> 3);
  const sample = (row: Buffer, x: number, channel: number) => {
    if (depth === 16) return row.readUInt16BE((x * channels + channel) * 2);
    if (depth === 8) return row[x * channels + channel]!;
    const bit = (x * channels + channel) * depth;
    return (row[bit >> 3]! >> (8 - depth - (bit & 7))) & max;
  };
  const key = transparency && (colourType === 0 || colourType === 2) ? Array.from({ length: channels }, (_, at) => transparency.readUInt16BE(at * 2)) : null;
  const opacity = (row: Buffer, x: number): number => {
    if (colourType === 4 || colourType === 6) {
      const alpha = sample(row, x, channels - 1);
      return depth === 16 ? Math.floor(alpha / 257) : alpha;
    }
    if (colourType === 3) return transparency![sample(row, x, 0)] ?? 255;
    return key!.every((value, channel) => sample(row, x, channel) === value) ? 0 : 255;
  };
  let at = 0;
  for (const [left, top, across, down] of interlace ? ADAM7 : [[0, 0, 1, 1] as const]) {
    const passWidth = Math.ceil((width - left) / across);
    const passHeight = Math.ceil((height - top) / down);
    if (passWidth <= 0 || passHeight <= 0) continue;
    const rowBytes = Math.ceil((passWidth * bits) / 8);
    let previous = Buffer.alloc(rowBytes);
    for (let y = 0; y < passHeight; y++, at += 1 + rowBytes) {
      if (at + 1 + rowBytes > pixels.length) return null;
      const filter = pixels[at]!;
      const row = Buffer.from(pixels.subarray(at + 1, at + 1 + rowBytes));
      for (let i = 0; i < rowBytes; i++) {
        const leftByte = i >= step ? row[i - step]! : 0;
        const up = previous[i]!;
        const upLeft = i >= step ? previous[i - step]! : 0;
        if (filter === 1) row[i] = row[i]! + leftByte;
        else if (filter === 2) row[i] = row[i]! + up;
        else if (filter === 3) row[i] = row[i]! + ((leftByte + up) >> 1);
        else if (filter === 4) {
          const guess = leftByte + up - upLeft;
          const [toLeft, toUp, toUpLeft] = [Math.abs(guess - leftByte), Math.abs(guess - up), Math.abs(guess - upLeft)];
          row[i] = row[i]! + (toLeft <= toUp && toLeft <= toUpLeft ? leftByte : toUp <= toUpLeft ? up : upLeft);
        } else if (filter !== 0) return null;
      }
      for (let x = 0; x < passWidth; x++) counts[opacity(row, x)]!++;
      previous = row;
    }
  }
  return counts;
}
