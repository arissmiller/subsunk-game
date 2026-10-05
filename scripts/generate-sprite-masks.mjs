import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

// Build masks from the same PNGs that the renderer loads. Keep alpha > 0 pixels.
const files = { player: 'player', 'enemy-sub': 'enemy', boat: 'enemy_ship', mine: 'mine' };
const masks = {};
for (const [kind, file] of Object.entries(files)) {
  const png = readFileSync(new URL(`../public/sprites/${file}.png`, import.meta.url));
  let width, height;
  const chunks = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) throw new Error(`${file}.png must be a non-interlaced 8-bit RGBA PNG`);
    }
    if (type === 'IDAT') chunks.push(data);
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  let previous = new Uint8Array(stride);
  const runs = [];
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? row[i - 4] : 0;
      const b = previous[i];
      const c = i >= 4 ? previous[i - 4] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const prediction = [0, a, b, Math.floor((a + b) / 2), pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      if (prediction === undefined) throw new Error('Invalid PNG filter');
      row[i] = (row[i] + prediction) & 255;
    }
    for (let x = 0; x < width;) {
      if (!row[x * 4 + 3]) { x++; continue; }
      const start = x;
      while (x < width && row[x * 4 + 3]) x++;
      runs.push([start, y, x - start]);
    }
    previous = row;
  }
  if (!runs.length) throw new Error(`${file}.png contains no visible pixels`);
  masks[kind] = { width, height, runs };
}
writeFileSync(new URL('../src/radar/spriteMasks.json', import.meta.url), JSON.stringify(masks) + '\n');
