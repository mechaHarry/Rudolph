/**
 * Generate PNG icons for the Chrome extension.
 * Run once: node generate-icons.js
 * Requires no dependencies — uses the built-in OffscreenCanvas polyfill via a
 * minimal PNG encoder written in pure Node.js.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function setPixel(pixels, size, x, y, r, g, b, a) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || x >= size || y < 0 || y >= size) return;
  const idx = (y * size + x) * 4;
  const srcA = a / 255;
  const dstA = pixels[idx + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA === 0) return;
  pixels[idx]     = Math.round((r * srcA + pixels[idx]     * dstA * (1 - srcA)) / outA);
  pixels[idx + 1] = Math.round((g * srcA + pixels[idx + 1] * dstA * (1 - srcA)) / outA);
  pixels[idx + 2] = Math.round((b * srcA + pixels[idx + 2] * dstA * (1 - srcA)) / outA);
  pixels[idx + 3] = Math.round(outA * 255);
}

function fillDot(pixels, size, cx, cy, radius, r, g, b, a) {
  var r2 = radius * radius;
  for (var y = Math.floor(cy - radius - 1); y <= Math.ceil(cy + radius + 1); y++) {
    for (var x = Math.floor(cx - radius - 1); x <= Math.ceil(cx + radius + 1); x++) {
      var dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r2) setPixel(pixels, size, x, y, r, g, b, a);
    }
  }
}

function strokeCircle(pixels, size, cx, cy, radius, thickness, r, g, b, a) {
  var outer2 = (radius + thickness / 2) * (radius + thickness / 2);
  var inner2 = (radius - thickness / 2) * (radius - thickness / 2);
  for (var y = Math.floor(cy - radius - thickness); y <= Math.ceil(cy + radius + thickness); y++) {
    for (var x = Math.floor(cx - radius - thickness); x <= Math.ceil(cx + radius + thickness); x++) {
      var dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
      if (d2 <= outer2 && d2 >= inner2) setPixel(pixels, size, x, y, r, g, b, a);
    }
  }
}

function drawLine(pixels, size, x0, y0, x1, y1, thickness, r, g, b, a) {
  var dx = x1 - x0, dy = y1 - y0;
  var steps = Math.ceil(Math.sqrt(dx * dx + dy * dy) * 2);
  for (var i = 0; i <= steps; i++) {
    var t = i / steps;
    fillDot(pixels, size, x0 + dx * t, y0 + dy * t, thickness / 2, r, g, b, a);
  }
}

function cubicBezier(p0, p1, p2, p3, t) {
  var u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

function drawBezier(pixels, size, x0, y0, x1, y1, x2, y2, x3, y3, thickness, r, g, b, a) {
  var steps = Math.ceil(size * 1.5);
  for (var i = 0; i <= steps; i++) {
    var t = i / steps;
    var px = cubicBezier(x0, x1, x2, x3, t);
    var py = cubicBezier(y0, y1, y2, y3, t);
    fillDot(pixels, size, px, py, thickness / 2, r, g, b, a);
  }
}

function createPNG(size) {
  var red = [231, 76, 60];
  var wh = [255, 255, 255];

  var pixels = Buffer.alloc(size * size * 4);

  var s = size / 48;
  var lw = Math.max(1, 4.5 * s);

  drawBezier(pixels, size,
    4*s, 44*s, 2*s, 48*s, 36*s, 30*s, 33*s, 12*s,
    lw, wh[0], wh[1], wh[2], 255);
  drawBezier(pixels, size,
    4*s, 27*s, 6*s, 29*s, 28*s, 14*s, 33*s, 12*s,
    lw, wh[0], wh[1], wh[2], 255);

  strokeCircle(pixels, size, 36*s, 9*s, 5*s, lw, red[0], red[1], red[2], 255);

  return encodePNG(size, size, pixels);
}

function encodePNG(w, h, pixels) {
  // Build raw image data with filter byte (0 = None) per row
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0; // filter: none
    pixels.copy(raw, y * (1 + w * 4) + 1, y * w * 4, (y + 1) * w * 4);
  }

  const compressed = zlib.deflateSync(raw);

  // PNG signature
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const ihdrChunk = makeChunk('IHDR', ihdr);

  // IDAT chunk
  const idatChunk = makeChunk('IDAT', compressed);

  // IEND chunk
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeB = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeB, data]);
  const crc = crc32(crcData);
  const crcB = Buffer.alloc(4);
  crcB.writeUInt32BE(crc >>> 0, 0);
  return Buffer.concat([len, typeB, data, crcB]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return crc ^ 0xFFFFFFFF;
}

// Generate icons
const iconsDir = path.join(__dirname, 'public', 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

[16, 48, 128].forEach(function(size) {
  const png = createPNG(size);
  const out = path.join(iconsDir, 'icon' + size + '.png');
  fs.writeFileSync(out, png);
  console.log('Created ' + out + ' (' + png.length + ' bytes)');
});

console.log('Done! Icons generated in public/icons/');
