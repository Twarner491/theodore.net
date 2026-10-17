// Animated GIF of a drop countdown, for email (functions/api/countdown.js). The look is the
// product page's .pe-countdown field, pre-rendered as grayscale bitmaps by
// scripts/build_countdown_art.py (a Worker has no canvas). Here we only place digit tiles and
// encode frames. The palette is 256 grays, so a pixel's gray level IS its palette index.
//
// The GIF plays once: about a minute of seconds ticking from the moment it was requested, the
// first tick landing on the same whole-second boundary as the page's countdown. If the drop
// opens during that minute, the last frame switches to the open state ("Order now").
import ART from "./countdown-art.js";

const FRAMES = 60;
const DAY = 86400, HOUR = 3600, MINUTE = 60;

let artPromise = null;
async function inflate(b64) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
function loadArt() {
  if (!artPromise) {
    artPromise = Promise.all([inflate(ART.countdown), inflate(ART.open), Promise.all(ART.digits.map(inflate))])
      .then(([countdown, open, digits]) => ({ countdown, open, digits }))
      .catch((error) => { artPromise = null; throw error; });
  }
  return artPromise;
}

// the eight digits on screen, matching store.js: whole seconds rounded up, so 00s lands exactly
// at launch; days cap at 99 (two digit slots)
export function countdownDigits(ms) {
  let s = Math.max(0, Math.ceil(ms / 1000));
  const d = Math.min(99, Math.floor(s / DAY)); s -= Math.floor(s / DAY) * DAY;
  const h = Math.floor(s / HOUR); s -= h * HOUR;
  const m = Math.floor(s / MINUTE); s -= m * MINUTE;
  return [d, h, m, s].flatMap((n) => [Math.floor(n / 10), n % 10]);
}

function blit(frame, art, digits, only) {
  const { width, tileWidth: tw, tileHeight: th, cells } = ART;
  digits.forEach((n, i) => {
    if (only && !only[i]) return;
    const [x, y] = cells[i], tile = art.digits[n];
    for (let row = 0; row < th; row++) frame.set(tile.subarray(row * tw, row * tw + tw), (y + row) * width + x);
  });
}

class Bytes {
  constructor(size = 1 << 15) { this.buf = new Uint8Array(size); this.len = 0; }
  byte(b) {
    if (this.len === this.buf.length) { const next = new Uint8Array(this.buf.length * 2); next.set(this.buf); this.buf = next; }
    this.buf[this.len++] = b;
  }
  word(w) { this.byte(w & 255); this.byte((w >> 8) & 255); }
  bytes(list) { for (let i = 0; i < list.length; i++) this.byte(list[i]); }
  result() { return this.buf.subarray(0, this.len); }
}

// GIF LZW with 8-bit pixels (variable 9-12 bit codes, clear on a full table); same code-size
// schedule as the widely used gif.js / Poskanzer encoder. The dictionary is a dense
// prefix*256+pixel table, emptied entry-by-entry on each clear.
const dict = new Uint16Array(4096 * 256);
const usedKeys = new Int32Array(4096);
function lzw(pixels, out) {
  const CLEAR = 256, EOI = 257;
  let nBits = 9, maxCode = 511, free = 258, clearFlag = false, acc = 0, bits = 0, nUsed = 0;
  const data = new Bytes(pixels.length >> 2);
  const emit = (code) => {
    acc |= code << bits; bits += nBits;
    while (bits >= 8) { data.byte(acc & 255); acc >>>= 8; bits -= 8; }
    if (free > maxCode || clearFlag) {
      if (clearFlag) { nBits = 9; maxCode = 511; clearFlag = false; }
      else { nBits++; maxCode = nBits === 12 ? 4096 : (1 << nBits) - 1; }
    }
  };
  const reset = () => { for (let i = 0; i < nUsed; i++) dict[usedKeys[i]] = 0; nUsed = 0; };
  emit(CLEAR);
  let ent = pixels[0];
  for (let i = 1; i < pixels.length; i++) {
    const c = pixels[i], key = (ent << 8) | c, code = dict[key];
    if (code) { ent = code; continue; }
    emit(ent);
    ent = c;
    if (free < 4096) { dict[key] = free++; usedKeys[nUsed++] = key; }
    else { reset(); free = 258; clearFlag = true; emit(CLEAR); }
  }
  emit(ent); emit(EOI);
  if (bits > 0) data.byte(acc & 255);
  reset();
  const body = data.result();
  out.byte(8);                                   // LZW minimum code size
  for (let i = 0; i < body.length; i += 255) { const n = Math.min(255, body.length - i); out.byte(n); out.bytes(body.subarray(i, i + n)); }
  out.byte(0);
}

function image(out, frame, x, y, w, h, delayCs) {
  out.bytes([0x21, 0xf9, 4, 0x04]);              // graphic control: disposal 1 (keep), no transparency
  out.word(delayCs); out.byte(0); out.byte(0);
  out.byte(0x2c); out.word(x); out.word(y); out.word(w); out.word(h); out.byte(0);
  const px = new Uint8Array(w * h);
  for (let row = 0; row < h; row++) px.set(frame.subarray((y + row) * ART.width + x, (y + row) * ART.width + x + w), row * w);
  lzw(px, out);
}

// A one-second tick usually redraws only the seconds' last digit; cache those sub-frames per
// isolate (keyed by the region and its digits) so a warm request is mostly a byte copy.
const subframes = new Map();
function tick(out, frame, prev, next, delayCs) {
  let lo = 8, hi = -1;
  next.forEach((n, i) => { if (n !== prev[i]) { lo = Math.min(lo, i); hi = Math.max(hi, i); } });
  if (hi < 0) return false;
  const x = ART.cells[lo][0], y = ART.cells[lo][1];
  const w = ART.cells[hi][0] + ART.tileWidth - x, h = ART.tileHeight;
  const key = lo + ":" + hi + ":" + next.slice(lo, hi + 1).join("") + ":" + delayCs;
  let bytes = subframes.get(key);
  if (!bytes) {
    const part = new Bytes(4096);
    image(part, frame, x, y, w, h, delayCs);
    bytes = part.result().slice();
    if (subframes.size >= 600) subframes.clear();
    subframes.set(key, bytes);
  }
  out.bytes(bytes);
  return true;
}

export async function countdownGif(launchAt, now) {
  const art = await loadArt();
  const { width: W, height: H } = ART;
  const out = new Bytes();
  out.bytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);   // GIF89a
  out.word(W); out.word(H); out.bytes([0xf7, 255, 0]); // 256-entry global table, white background
  for (let g = 0; g < 256; g++) out.bytes([g, g, g]);
  const frame = new Uint8Array(W * H);
  const zeros = new Array(8).fill(0);
  let left = launchAt - now;
  if (left <= 0) {
    frame.set(art.open); blit(frame, art, zeros);
    image(out, frame, 0, 0, W, H, 0);
    out.byte(0x3b);
    return out.result();
  }
  // first frame: until the next whole-second boundary (skip a sliver too short to show)
  let first = left % 1000 || 1000;
  if (first < 20) { left -= first; first = 1000; }
  let digits = countdownDigits(left);
  frame.set(art.countdown); blit(frame, art, digits);
  image(out, frame, 0, 0, W, H, Math.round(first / 10));
  left -= first;
  for (let k = 1; k < FRAMES && left >= 0; k++, left -= 1000) {
    if (left <= 0) {                               // opened mid-animation: show the open state
      frame.set(art.open); blit(frame, art, zeros);
      image(out, frame, 0, 0, W, H, 100);
      break;
    }
    const next = countdownDigits(left);
    blit(frame, art, next, next.map((n, i) => n !== digits[i]));
    tick(out, frame, digits, next, 100);
    digits = next;
  }
  out.byte(0x3b);
  return out.result();
}
