"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod2, isNodeMode, target) => (target = mod2 != null ? __create(__getProtoOf(mod2)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod2 || !mod2.__esModule ? __defProp(target, "default", { value: mod2, enumerable: true }) : target,
  mod2
));

var import_crypto4 = require("crypto");

var nc = __toESM(require("node:crypto"), 1);
var crypto = nc && typeof nc === "object" && "webcrypto" in nc ? nc.webcrypto : nc && typeof nc === "object" && "randomBytes" in nc ? nc : void 0;

function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
}
function anumber(n) {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new Error("positive integer expected, got " + n);
}
function abytes(b, ...lengths) {
  if (!isBytes(b))
    throw new Error("Uint8Array expected");
  if (lengths.length > 0 && !lengths.includes(b.length))
    throw new Error("Uint8Array expected of length " + lengths + ", got length=" + b.length);
}
function aexists(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("Hash instance has been destroyed");
  if (checkFinished && instance.finished)
    throw new Error("Hash#digest() has already been called");
}
function aoutput(out, instance) {
  abytes(out);
  const min = instance.outputLen;
  if (out.length < min) {
    throw new Error("digestInto() expects output buffer of length at least " + min);
  }
}
function clean(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function createView(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
var hasHexBuiltin = /* @__PURE__ */ (() => (
  // @ts-ignore
  typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function"
))();
var hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
function bytesToHex(bytes) {
  abytes(bytes);
  if (hasHexBuiltin)
    return bytes.toHex();
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += hexes[bytes[i]];
  }
  return hex;
}
var asciis = { _0: 48, _9: 57, A: 65, F: 70, a: 97, f: 102 };
function asciiToBase16(ch) {
  if (ch >= asciis._0 && ch <= asciis._9)
    return ch - asciis._0;
  if (ch >= asciis.A && ch <= asciis.F)
    return ch - (asciis.A - 10);
  if (ch >= asciis.a && ch <= asciis.f)
    return ch - (asciis.a - 10);
  return;
}
function hexToBytes(hex) {
  if (typeof hex !== "string")
    throw new Error("hex string expected, got " + typeof hex);
  if (hasHexBuiltin)
    return Uint8Array.fromHex(hex);
  const hl = hex.length;
  const al = hl / 2;
  if (hl % 2)
    throw new Error("hex string expected, got unpadded hex of length " + hl);
  const array = new Uint8Array(al);
  for (let ai = 0, hi = 0; ai < al; ai++, hi += 2) {
    const n1 = asciiToBase16(hex.charCodeAt(hi));
    const n2 = asciiToBase16(hex.charCodeAt(hi + 1));
    if (n1 === void 0 || n2 === void 0) {
      const char = hex[hi] + hex[hi + 1];
      throw new Error('hex string expected, got non-hex character "' + char + '" at index ' + hi);
    }
    array[ai] = n1 * 16 + n2;
  }
  return array;
}
function utf8ToBytes(str) {
  if (typeof str !== "string")
    throw new Error("string expected");
  return new Uint8Array(new TextEncoder().encode(str));
}
function toBytes(data) {
  if (typeof data === "string")
    data = utf8ToBytes(data);
  abytes(data);
  return data;
}
function concatBytes(...arrays) {
  let sum = 0;
  for (let i = 0; i < arrays.length; i++) {
    const a = arrays[i];
    abytes(a);
    sum += a.length;
  }
  const res = new Uint8Array(sum);
  for (let i = 0, pad = 0; i < arrays.length; i++) {
    const a = arrays[i];
    res.set(a, pad);
    pad += a.length;
  }
  return res;
}
var Hash = class {
};
function createHasher(hashCons) {
  const hashC = (msg) => hashCons().update(toBytes(msg)).digest();
  const tmp = hashCons();
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.create = () => hashCons();
  return hashC;
}
function randomBytes(bytesLength = 32) {
  if (crypto && typeof crypto.getRandomValues === "function") {
    return crypto.getRandomValues(new Uint8Array(bytesLength));
  }
  if (crypto && typeof crypto.randomBytes === "function") {
    return Uint8Array.from(crypto.randomBytes(bytesLength));
  }
  throw new Error("crypto.getRandomValues must be defined");
}

function setBigUint64(view, byteOffset, value, isLE) {
  if (typeof view.setBigUint64 === "function")
    return view.setBigUint64(byteOffset, value, isLE);
  const _32n2 = BigInt(32);
  const _u32_max = BigInt(4294967295);
  const wh = Number(value >> _32n2 & _u32_max);
  const wl = Number(value & _u32_max);
  const h = isLE ? 4 : 0;
  const l = isLE ? 0 : 4;
  view.setUint32(byteOffset + h, wh, isLE);
  view.setUint32(byteOffset + l, wl, isLE);
}
var HashMD = class extends Hash {
  constructor(blockLen, outputLen, padOffset, isLE) {
    super();
    this.finished = false;
    this.length = 0;
    this.pos = 0;
    this.destroyed = false;
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.padOffset = padOffset;
    this.isLE = isLE;
    this.buffer = new Uint8Array(blockLen);
    this.view = createView(this.buffer);
  }
  update(data) {
    aexists(this);
    data = toBytes(data);
    abytes(data);
    const { view, buffer, blockLen } = this;
    const len = data.length;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        const dataView = createView(data);
        for (; blockLen <= len - pos; pos += blockLen)
          this.process(dataView, pos);
        continue;
      }
      buffer.set(data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      pos += take;
      if (this.pos === blockLen) {
        this.process(view, 0);
        this.pos = 0;
      }
    }
    this.length += data.length;
    this.roundClean();
    return this;
  }
  digestInto(out) {
    aexists(this);
    aoutput(out, this);
    this.finished = true;
    const { buffer, view, blockLen, isLE } = this;
    let { pos } = this;
    buffer[pos++] = 128;
    clean(this.buffer.subarray(pos));
    if (this.padOffset > blockLen - pos) {
      this.process(view, 0);
      pos = 0;
    }
    for (let i = pos; i < blockLen; i++)
      buffer[i] = 0;
    setBigUint64(view, blockLen - 8, BigInt(this.length * 8), isLE);
    this.process(view, 0);
    const oview = createView(out);
    const len = this.outputLen;
    if (len % 4)
      throw new Error("_sha2: outputLen should be aligned to 32bit");
    const outLen = len / 4;
    const state = this.get();
    if (outLen > state.length)
      throw new Error("_sha2: outputLen bigger than state");
    for (let i = 0; i < outLen; i++)
      oview.setUint32(4 * i, state[i], isLE);
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneInto(to) {
    to || (to = new this.constructor());
    to.set(...this.get());
    const { blockLen, buffer, length, finished, destroyed, pos } = this;
    to.destroyed = destroyed;
    to.finished = finished;
    to.length = length;
    to.pos = pos;
    if (length % blockLen)
      to.buffer.set(buffer);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
};
var SHA512_IV = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  4089235720,
  3144134277,
  2227873595,
  1013904242,
  4271175723,
  2773480762,
  1595750129,
  1359893119,
  2917565137,
  2600822924,
  725511199,
  528734635,
  4215389547,
  1541459225,
  327033209
]);

var U32_MASK64 = /* @__PURE__ */ BigInt(2 ** 32 - 1);
var _32n = /* @__PURE__ */ BigInt(32);
function fromBig(n, le = false) {
  if (le)
    return { h: Number(n & U32_MASK64), l: Number(n >> _32n & U32_MASK64) };
  return { h: Number(n >> _32n & U32_MASK64) | 0, l: Number(n & U32_MASK64) | 0 };
}
function split(lst, le = false) {
  const len = lst.length;
  let Ah = new Uint32Array(len);
  let Al = new Uint32Array(len);
  for (let i = 0; i < len; i++) {
    const { h, l } = fromBig(lst[i], le);
    [Ah[i], Al[i]] = [h, l];
  }
  return [Ah, Al];
}
var shrSH = (h, _l, s) => h >>> s;
var shrSL = (h, l, s) => h << 32 - s | l >>> s;
var rotrSH = (h, l, s) => h >>> s | l << 32 - s;
var rotrSL = (h, l, s) => h << 32 - s | l >>> s;
var rotrBH = (h, l, s) => h << 64 - s | l >>> s - 32;
var rotrBL = (h, l, s) => h >>> s - 32 | l << 64 - s;
function add(Ah, Al, Bh, Bl) {
  const l = (Al >>> 0) + (Bl >>> 0);
  return { h: Ah + Bh + (l / 2 ** 32 | 0) | 0, l: l | 0 };
}
var add3L = (Al, Bl, Cl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0);
var add3H = (low, Ah, Bh, Ch) => Ah + Bh + Ch + (low / 2 ** 32 | 0) | 0;
var add4L = (Al, Bl, Cl, Dl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0);
var add4H = (low, Ah, Bh, Ch, Dh) => Ah + Bh + Ch + Dh + (low / 2 ** 32 | 0) | 0;
var add5L = (Al, Bl, Cl, Dl, El) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0) + (El >>> 0);
var add5H = (low, Ah, Bh, Ch, Dh, Eh) => Ah + Bh + Ch + Dh + Eh + (low / 2 ** 32 | 0) | 0;

var K512 = /* @__PURE__ */ (() => split([
  "0x428a2f98d728ae22",
  "0x7137449123ef65cd",
  "0xb5c0fbcfec4d3b2f",
  "0xe9b5dba58189dbbc",
  "0x3956c25bf348b538",
  "0x59f111f1b605d019",
  "0x923f82a4af194f9b",
  "0xab1c5ed5da6d8118",
  "0xd807aa98a3030242",
  "0x12835b0145706fbe",
  "0x243185be4ee4b28c",
  "0x550c7dc3d5ffb4e2",
  "0x72be5d74f27b896f",
  "0x80deb1fe3b1696b1",
  "0x9bdc06a725c71235",
  "0xc19bf174cf692694",
  "0xe49b69c19ef14ad2",
  "0xefbe4786384f25e3",
  "0x0fc19dc68b8cd5b5",
  "0x240ca1cc77ac9c65",
  "0x2de92c6f592b0275",
  "0x4a7484aa6ea6e483",
  "0x5cb0a9dcbd41fbd4",
  "0x76f988da831153b5",
  "0x983e5152ee66dfab",
  "0xa831c66d2db43210",
  "0xb00327c898fb213f",
  "0xbf597fc7beef0ee4",
  "0xc6e00bf33da88fc2",
  "0xd5a79147930aa725",
  "0x06ca6351e003826f",
  "0x142929670a0e6e70",
  "0x27b70a8546d22ffc",
  "0x2e1b21385c26c926",
  "0x4d2c6dfc5ac42aed",
  "0x53380d139d95b3df",
  "0x650a73548baf63de",
  "0x766a0abb3c77b2a8",
  "0x81c2c92e47edaee6",
  "0x92722c851482353b",
  "0xa2bfe8a14cf10364",
  "0xa81a664bbc423001",
  "0xc24b8b70d0f89791",
  "0xc76c51a30654be30",
  "0xd192e819d6ef5218",
  "0xd69906245565a910",
  "0xf40e35855771202a",
  "0x106aa07032bbd1b8",
  "0x19a4c116b8d2d0c8",
  "0x1e376c085141ab53",
  "0x2748774cdf8eeb99",
  "0x34b0bcb5e19b48a8",
  "0x391c0cb3c5c95a63",
  "0x4ed8aa4ae3418acb",
  "0x5b9cca4f7763e373",
  "0x682e6ff3d6b2b8a3",
  "0x748f82ee5defb2fc",
  "0x78a5636f43172f60",
  "0x84c87814a1f0ab72",
  "0x8cc702081a6439ec",
  "0x90befffa23631e28",
  "0xa4506cebde82bde9",
  "0xbef9a3f7b2c67915",
  "0xc67178f2e372532b",
  "0xca273eceea26619c",
  "0xd186b8c721c0c207",
  "0xeada7dd6cde0eb1e",
  "0xf57d4f7fee6ed178",
  "0x06f067aa72176fba",
  "0x0a637dc5a2c898a6",
  "0x113f9804bef90dae",
  "0x1b710b35131c471b",
  "0x28db77f523047d84",
  "0x32caab7b40c72493",
  "0x3c9ebe0a15c9bebc",
  "0x431d67c49c100d4c",
  "0x4cc5d4becb3e42b6",
  "0x597f299cfc657e2a",
  "0x5fcb6fab3ad6faec",
  "0x6c44198c4a475817"
].map((n) => BigInt(n))))();
var SHA512_Kh = /* @__PURE__ */ (() => K512[0])();
var SHA512_Kl = /* @__PURE__ */ (() => K512[1])();
var SHA512_W_H = /* @__PURE__ */ new Uint32Array(80);
var SHA512_W_L = /* @__PURE__ */ new Uint32Array(80);
var SHA512 = class extends HashMD {
  constructor(outputLen = 64) {
    super(128, outputLen, 16, false);
    this.Ah = SHA512_IV[0] | 0;
    this.Al = SHA512_IV[1] | 0;
    this.Bh = SHA512_IV[2] | 0;
    this.Bl = SHA512_IV[3] | 0;
    this.Ch = SHA512_IV[4] | 0;
    this.Cl = SHA512_IV[5] | 0;
    this.Dh = SHA512_IV[6] | 0;
    this.Dl = SHA512_IV[7] | 0;
    this.Eh = SHA512_IV[8] | 0;
    this.El = SHA512_IV[9] | 0;
    this.Fh = SHA512_IV[10] | 0;
    this.Fl = SHA512_IV[11] | 0;
    this.Gh = SHA512_IV[12] | 0;
    this.Gl = SHA512_IV[13] | 0;
    this.Hh = SHA512_IV[14] | 0;
    this.Hl = SHA512_IV[15] | 0;
  }
  // prettier-ignore
  get() {
    const { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
    return [Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl];
  }
  // prettier-ignore
  set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl) {
    this.Ah = Ah | 0;
    this.Al = Al | 0;
    this.Bh = Bh | 0;
    this.Bl = Bl | 0;
    this.Ch = Ch | 0;
    this.Cl = Cl | 0;
    this.Dh = Dh | 0;
    this.Dl = Dl | 0;
    this.Eh = Eh | 0;
    this.El = El | 0;
    this.Fh = Fh | 0;
    this.Fl = Fl | 0;
    this.Gh = Gh | 0;
    this.Gl = Gl | 0;
    this.Hh = Hh | 0;
    this.Hl = Hl | 0;
  }
  process(view, offset) {
    for (let i = 0; i < 16; i++, offset += 4) {
      SHA512_W_H[i] = view.getUint32(offset);
      SHA512_W_L[i] = view.getUint32(offset += 4);
    }
    for (let i = 16; i < 80; i++) {
      const W15h = SHA512_W_H[i - 15] | 0;
      const W15l = SHA512_W_L[i - 15] | 0;
      const s0h = rotrSH(W15h, W15l, 1) ^ rotrSH(W15h, W15l, 8) ^ shrSH(W15h, W15l, 7);
      const s0l = rotrSL(W15h, W15l, 1) ^ rotrSL(W15h, W15l, 8) ^ shrSL(W15h, W15l, 7);
      const W2h = SHA512_W_H[i - 2] | 0;
      const W2l = SHA512_W_L[i - 2] | 0;
      const s1h = rotrSH(W2h, W2l, 19) ^ rotrBH(W2h, W2l, 61) ^ shrSH(W2h, W2l, 6);
      const s1l = rotrSL(W2h, W2l, 19) ^ rotrBL(W2h, W2l, 61) ^ shrSL(W2h, W2l, 6);
      const SUMl = add4L(s0l, s1l, SHA512_W_L[i - 7], SHA512_W_L[i - 16]);
      const SUMh = add4H(SUMl, s0h, s1h, SHA512_W_H[i - 7], SHA512_W_H[i - 16]);
      SHA512_W_H[i] = SUMh | 0;
      SHA512_W_L[i] = SUMl | 0;
    }
    let { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
    for (let i = 0; i < 80; i++) {
      const sigma1h = rotrSH(Eh, El, 14) ^ rotrSH(Eh, El, 18) ^ rotrBH(Eh, El, 41);
      const sigma1l = rotrSL(Eh, El, 14) ^ rotrSL(Eh, El, 18) ^ rotrBL(Eh, El, 41);
      const CHIh = Eh & Fh ^ ~Eh & Gh;
      const CHIl = El & Fl ^ ~El & Gl;
      const T1ll = add5L(Hl, sigma1l, CHIl, SHA512_Kl[i], SHA512_W_L[i]);
      const T1h = add5H(T1ll, Hh, sigma1h, CHIh, SHA512_Kh[i], SHA512_W_H[i]);
      const T1l = T1ll | 0;
      const sigma0h = rotrSH(Ah, Al, 28) ^ rotrBH(Ah, Al, 34) ^ rotrBH(Ah, Al, 39);
      const sigma0l = rotrSL(Ah, Al, 28) ^ rotrBL(Ah, Al, 34) ^ rotrBL(Ah, Al, 39);
      const MAJh = Ah & Bh ^ Ah & Ch ^ Bh & Ch;
      const MAJl = Al & Bl ^ Al & Cl ^ Bl & Cl;
      Hh = Gh | 0;
      Hl = Gl | 0;
      Gh = Fh | 0;
      Gl = Fl | 0;
      Fh = Eh | 0;
      Fl = El | 0;
      ({ h: Eh, l: El } = add(Dh | 0, Dl | 0, T1h | 0, T1l | 0));
      Dh = Ch | 0;
      Dl = Cl | 0;
      Ch = Bh | 0;
      Cl = Bl | 0;
      Bh = Ah | 0;
      Bl = Al | 0;
      const All = add3L(T1l, sigma0l, MAJl);
      Ah = add3H(All, T1h, sigma0h, MAJh);
      Al = All | 0;
    }
    ({ h: Ah, l: Al } = add(this.Ah | 0, this.Al | 0, Ah | 0, Al | 0));
    ({ h: Bh, l: Bl } = add(this.Bh | 0, this.Bl | 0, Bh | 0, Bl | 0));
    ({ h: Ch, l: Cl } = add(this.Ch | 0, this.Cl | 0, Ch | 0, Cl | 0));
    ({ h: Dh, l: Dl } = add(this.Dh | 0, this.Dl | 0, Dh | 0, Dl | 0));
    ({ h: Eh, l: El } = add(this.Eh | 0, this.El | 0, Eh | 0, El | 0));
    ({ h: Fh, l: Fl } = add(this.Fh | 0, this.Fl | 0, Fh | 0, Fl | 0));
    ({ h: Gh, l: Gl } = add(this.Gh | 0, this.Gl | 0, Gh | 0, Gl | 0));
    ({ h: Hh, l: Hl } = add(this.Hh | 0, this.Hl | 0, Hh | 0, Hl | 0));
    this.set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl);
  }
  roundClean() {
    clean(SHA512_W_H, SHA512_W_L);
  }
  destroy() {
    clean(this.buffer);
    this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  }
};
var sha512 = /* @__PURE__ */ createHasher(() => new SHA512());

var _0n = /* @__PURE__ */ BigInt(0);
var _1n = /* @__PURE__ */ BigInt(1);
function _abool2(value, title = "") {
  if (typeof value !== "boolean") {
    const prefix = title && `"${title}"`;
    throw new Error(prefix + "expected boolean, got type=" + typeof value);
  }
  return value;
}
function _abytes2(value, length, title = "") {
  const bytes = isBytes(value);
  const len = value?.length;
  const needsLen = length !== void 0;
  if (!bytes || needsLen && len !== length) {
    const prefix = title && `"${title}" `;
    const ofLen = needsLen ? ` of length ${length}` : "";
    const got = bytes ? `length=${len}` : `type=${typeof value}`;
    throw new Error(prefix + "expected Uint8Array" + ofLen + ", got " + got);
  }
  return value;
}
function hexToNumber(hex) {
  if (typeof hex !== "string")
    throw new Error("hex string expected, got " + typeof hex);
  return hex === "" ? _0n : BigInt("0x" + hex);
}
function bytesToNumberBE(bytes) {
  return hexToNumber(bytesToHex(bytes));
}
function bytesToNumberLE(bytes) {
  abytes(bytes);
  return hexToNumber(bytesToHex(Uint8Array.from(bytes).reverse()));
}
function numberToBytesBE(n, len) {
  return hexToBytes(n.toString(16).padStart(len * 2, "0"));
}
function numberToBytesLE(n, len) {
  return numberToBytesBE(n, len).reverse();
}
function ensureBytes(title, hex, expectedLength) {
  let res;
  if (typeof hex === "string") {
    try {
      res = hexToBytes(hex);
    } catch (e) {
      throw new Error(title + " must be hex string or Uint8Array, cause: " + e);
    }
  } else if (isBytes(hex)) {
    res = Uint8Array.from(hex);
  } else {
    throw new Error(title + " must be hex string or Uint8Array");
  }
  const len = res.length;
  if (typeof expectedLength === "number" && len !== expectedLength)
    throw new Error(title + " of length " + expectedLength + " expected, got " + len);
  return res;
}
function equalBytes(a, b) {
  if (a.length !== b.length)
    return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++)
    diff |= a[i] ^ b[i];
  return diff === 0;
}
function copyBytes(bytes) {
  return Uint8Array.from(bytes);
}
var isPosBig = (n) => typeof n === "bigint" && _0n <= n;
function inRange(n, min, max) {
  return isPosBig(n) && isPosBig(min) && isPosBig(max) && min <= n && n < max;
}
function aInRange(title, n, min, max) {
  if (!inRange(n, min, max))
    throw new Error("expected valid " + title + ": " + min + " <= n < " + max + ", got " + n);
}
function bitLen(n) {
  let len;
  for (len = 0; n > _0n; n >>= _1n, len += 1)
    ;
  return len;
}
var bitMask = (n) => (_1n << BigInt(n)) - _1n;
function _validateObject(object, fields, optFields = {}) {
  if (!object || typeof object !== "object")
    throw new Error("expected valid options object");
  function checkField(fieldName, expectedType, isOpt) {
    const val = object[fieldName];
    if (isOpt && val === void 0)
      return;
    const current = typeof val;
    if (current !== expectedType || val === null)
      throw new Error(`param "${fieldName}" is invalid: expected ${expectedType}, got ${current}`);
  }
  Object.entries(fields).forEach(([k, v]) => checkField(k, v, false));
  Object.entries(optFields).forEach(([k, v]) => checkField(k, v, true));
}
var notImplemented = () => {
  throw new Error("not implemented");
};
function memoized(fn) {
  const map = /* @__PURE__ */ new WeakMap();
  return (arg, ...args) => {
    const val = map.get(arg);
    if (val !== void 0)
      return val;
    const computed = fn(arg, ...args);
    map.set(arg, computed);
    return computed;
  };
}

var _0n2 = BigInt(0);
var _1n2 = BigInt(1);
var _2n = /* @__PURE__ */ BigInt(2);
var _3n = /* @__PURE__ */ BigInt(3);
var _4n = /* @__PURE__ */ BigInt(4);
var _5n = /* @__PURE__ */ BigInt(5);
var _7n = /* @__PURE__ */ BigInt(7);
var _8n = /* @__PURE__ */ BigInt(8);
var _9n = /* @__PURE__ */ BigInt(9);
var _16n = /* @__PURE__ */ BigInt(16);
function mod(a, b) {
  const result = a % b;
  return result >= _0n2 ? result : b + result;
}
function pow2(x, power, modulo) {
  let res = x;
  while (power-- > _0n2) {
    res *= res;
    res %= modulo;
  }
  return res;
}
function invert(number, modulo) {
  if (number === _0n2)
    throw new Error("invert: expected non-zero number");
  if (modulo <= _0n2)
    throw new Error("invert: expected positive modulus, got " + modulo);
  let a = mod(number, modulo);
  let b = modulo;
  let x = _0n2, y = _1n2, u = _1n2, v = _0n2;
  while (a !== _0n2) {
    const q = b / a;
    const r = b % a;
    const m = x - u * q;
    const n = y - v * q;
    b = a, a = r, x = u, y = v, u = m, v = n;
  }
  const gcd = b;
  if (gcd !== _1n2)
    throw new Error("invert: does not exist");
  return mod(x, modulo);
}
function assertIsSquare(Fp2, root, n) {
  if (!Fp2.eql(Fp2.sqr(root), n))
    throw new Error("Cannot find square root");
}
function sqrt3mod4(Fp2, n) {
  const p1div4 = (Fp2.ORDER + _1n2) / _4n;
  const root = Fp2.pow(n, p1div4);
  assertIsSquare(Fp2, root, n);
  return root;
}
function sqrt5mod8(Fp2, n) {
  const p5div8 = (Fp2.ORDER - _5n) / _8n;
  const n2 = Fp2.mul(n, _2n);
  const v = Fp2.pow(n2, p5div8);
  const nv = Fp2.mul(n, v);
  const i = Fp2.mul(Fp2.mul(nv, _2n), v);
  const root = Fp2.mul(nv, Fp2.sub(i, Fp2.ONE));
  assertIsSquare(Fp2, root, n);
  return root;
}
function sqrt9mod16(P) {
  const Fp_ = Field(P);
  const tn = tonelliShanks(P);
  const c1 = tn(Fp_, Fp_.neg(Fp_.ONE));
  const c2 = tn(Fp_, c1);
  const c3 = tn(Fp_, Fp_.neg(c1));
  const c4 = (P + _7n) / _16n;
  return (Fp2, n) => {
    let tv1 = Fp2.pow(n, c4);
    let tv2 = Fp2.mul(tv1, c1);
    const tv3 = Fp2.mul(tv1, c2);
    const tv4 = Fp2.mul(tv1, c3);
    const e1 = Fp2.eql(Fp2.sqr(tv2), n);
    const e2 = Fp2.eql(Fp2.sqr(tv3), n);
    tv1 = Fp2.cmov(tv1, tv2, e1);
    tv2 = Fp2.cmov(tv4, tv3, e2);
    const e3 = Fp2.eql(Fp2.sqr(tv2), n);
    const root = Fp2.cmov(tv1, tv2, e3);
    assertIsSquare(Fp2, root, n);
    return root;
  };
}
function tonelliShanks(P) {
  if (P < _3n)
    throw new Error("sqrt is not defined for small field");
  let Q = P - _1n2;
  let S = 0;
  while (Q % _2n === _0n2) {
    Q /= _2n;
    S++;
  }
  let Z = _2n;
  const _Fp = Field(P);
  while (FpLegendre(_Fp, Z) === 1) {
    if (Z++ > 1e3)
      throw new Error("Cannot find square root: probably non-prime P");
  }
  if (S === 1)
    return sqrt3mod4;
  let cc = _Fp.pow(Z, Q);
  const Q1div2 = (Q + _1n2) / _2n;
  return function tonelliSlow(Fp2, n) {
    if (Fp2.is0(n))
      return n;
    if (FpLegendre(Fp2, n) !== 1)
      throw new Error("Cannot find square root");
    let M = S;
    let c = Fp2.mul(Fp2.ONE, cc);
    let t = Fp2.pow(n, Q);
    let R = Fp2.pow(n, Q1div2);
    while (!Fp2.eql(t, Fp2.ONE)) {
      if (Fp2.is0(t))
        return Fp2.ZERO;
      let i = 1;
      let t_tmp = Fp2.sqr(t);
      while (!Fp2.eql(t_tmp, Fp2.ONE)) {
        i++;
        t_tmp = Fp2.sqr(t_tmp);
        if (i === M)
          throw new Error("Cannot find square root");
      }
      const exponent = _1n2 << BigInt(M - i - 1);
      const b = Fp2.pow(c, exponent);
      M = i;
      c = Fp2.sqr(b);
      t = Fp2.mul(t, c);
      R = Fp2.mul(R, b);
    }
    return R;
  };
}
function FpSqrt(P) {
  if (P % _4n === _3n)
    return sqrt3mod4;
  if (P % _8n === _5n)
    return sqrt5mod8;
  if (P % _16n === _9n)
    return sqrt9mod16(P);
  return tonelliShanks(P);
}
var isNegativeLE = (num, modulo) => (mod(num, modulo) & _1n2) === _1n2;
var FIELD_FIELDS = [
  "create",
  "isValid",
  "is0",
  "neg",
  "inv",
  "sqrt",
  "sqr",
  "eql",
  "add",
  "sub",
  "mul",
  "pow",
  "div",
  "addN",
  "subN",
  "mulN",
  "sqrN"
];
function validateField(field) {
  const initial = {
    ORDER: "bigint",
    MASK: "bigint",
    BYTES: "number",
    BITS: "number"
  };
  const opts = FIELD_FIELDS.reduce((map, val) => {
    map[val] = "function";
    return map;
  }, initial);
  _validateObject(field, opts);
  return field;
}
function FpPow(Fp2, num, power) {
  if (power < _0n2)
    throw new Error("invalid exponent, negatives unsupported");
  if (power === _0n2)
    return Fp2.ONE;
  if (power === _1n2)
    return num;
  let p = Fp2.ONE;
  let d = num;
  while (power > _0n2) {
    if (power & _1n2)
      p = Fp2.mul(p, d);
    d = Fp2.sqr(d);
    power >>= _1n2;
  }
  return p;
}
function FpInvertBatch(Fp2, nums, passZero = false) {
  const inverted = new Array(nums.length).fill(passZero ? Fp2.ZERO : void 0);
  const multipliedAcc = nums.reduce((acc, num, i) => {
    if (Fp2.is0(num))
      return acc;
    inverted[i] = acc;
    return Fp2.mul(acc, num);
  }, Fp2.ONE);
  const invertedAcc = Fp2.inv(multipliedAcc);
  nums.reduceRight((acc, num, i) => {
    if (Fp2.is0(num))
      return acc;
    inverted[i] = Fp2.mul(acc, inverted[i]);
    return Fp2.mul(acc, num);
  }, invertedAcc);
  return inverted;
}
function FpLegendre(Fp2, n) {
  const p1mod2 = (Fp2.ORDER - _1n2) / _2n;
  const powered = Fp2.pow(n, p1mod2);
  const yes = Fp2.eql(powered, Fp2.ONE);
  const zero = Fp2.eql(powered, Fp2.ZERO);
  const no = Fp2.eql(powered, Fp2.neg(Fp2.ONE));
  if (!yes && !zero && !no)
    throw new Error("invalid Legendre symbol result");
  return yes ? 1 : zero ? 0 : -1;
}
function nLength(n, nBitLength) {
  if (nBitLength !== void 0)
    anumber(nBitLength);
  const _nBitLength = nBitLength !== void 0 ? nBitLength : n.toString(2).length;
  const nByteLength = Math.ceil(_nBitLength / 8);
  return { nBitLength: _nBitLength, nByteLength };
}
function Field(ORDER, bitLenOrOpts, isLE = false, opts = {}) {
  if (ORDER <= _0n2)
    throw new Error("invalid field: expected ORDER > 0, got " + ORDER);
  let _nbitLength = void 0;
  let _sqrt = void 0;
  let modFromBytes = false;
  let allowedLengths = void 0;
  if (typeof bitLenOrOpts === "object" && bitLenOrOpts != null) {
    if (opts.sqrt || isLE)
      throw new Error("cannot specify opts in two arguments");
    const _opts = bitLenOrOpts;
    if (_opts.BITS)
      _nbitLength = _opts.BITS;
    if (_opts.sqrt)
      _sqrt = _opts.sqrt;
    if (typeof _opts.isLE === "boolean")
      isLE = _opts.isLE;
    if (typeof _opts.modFromBytes === "boolean")
      modFromBytes = _opts.modFromBytes;
    allowedLengths = _opts.allowedLengths;
  } else {
    if (typeof bitLenOrOpts === "number")
      _nbitLength = bitLenOrOpts;
    if (opts.sqrt)
      _sqrt = opts.sqrt;
  }
  const { nBitLength: BITS, nByteLength: BYTES } = nLength(ORDER, _nbitLength);
  if (BYTES > 2048)
    throw new Error("invalid field: expected ORDER of <= 2048 bytes");
  let sqrtP;
  const f = Object.freeze({
    ORDER,
    isLE,
    BITS,
    BYTES,
    MASK: bitMask(BITS),
    ZERO: _0n2,
    ONE: _1n2,
    allowedLengths,
    create: (num) => mod(num, ORDER),
    isValid: (num) => {
      if (typeof num !== "bigint")
        throw new Error("invalid field element: expected bigint, got " + typeof num);
      return _0n2 <= num && num < ORDER;
    },
    is0: (num) => num === _0n2,
    // is valid and invertible
    isValidNot0: (num) => !f.is0(num) && f.isValid(num),
    isOdd: (num) => (num & _1n2) === _1n2,
    neg: (num) => mod(-num, ORDER),
    eql: (lhs, rhs) => lhs === rhs,
    sqr: (num) => mod(num * num, ORDER),
    add: (lhs, rhs) => mod(lhs + rhs, ORDER),
    sub: (lhs, rhs) => mod(lhs - rhs, ORDER),
    mul: (lhs, rhs) => mod(lhs * rhs, ORDER),
    pow: (num, power) => FpPow(f, num, power),
    div: (lhs, rhs) => mod(lhs * invert(rhs, ORDER), ORDER),
    // Same as above, but doesn't normalize
    sqrN: (num) => num * num,
    addN: (lhs, rhs) => lhs + rhs,
    subN: (lhs, rhs) => lhs - rhs,
    mulN: (lhs, rhs) => lhs * rhs,
    inv: (num) => invert(num, ORDER),
    sqrt: _sqrt || ((n) => {
      if (!sqrtP)
        sqrtP = FpSqrt(ORDER);
      return sqrtP(f, n);
    }),
    toBytes: (num) => isLE ? numberToBytesLE(num, BYTES) : numberToBytesBE(num, BYTES),
    fromBytes: (bytes, skipValidation = true) => {
      if (allowedLengths) {
        if (!allowedLengths.includes(bytes.length) || bytes.length > BYTES) {
          throw new Error("Field.fromBytes: expected " + allowedLengths + " bytes, got " + bytes.length);
        }
        const padded = new Uint8Array(BYTES);
        padded.set(bytes, isLE ? 0 : padded.length - bytes.length);
        bytes = padded;
      }
      if (bytes.length !== BYTES)
        throw new Error("Field.fromBytes: expected " + BYTES + " bytes, got " + bytes.length);
      let scalar = isLE ? bytesToNumberLE(bytes) : bytesToNumberBE(bytes);
      if (modFromBytes)
        scalar = mod(scalar, ORDER);
      if (!skipValidation) {
        if (!f.isValid(scalar))
          throw new Error("invalid field element: outside of range 0..ORDER");
      }
      return scalar;
    },
    // TODO: we don't need it here, move out to separate fn
    invertBatch: (lst) => FpInvertBatch(f, lst),
    // We can't move this out because Fp6, Fp12 implement it
    // and it's unclear what to return in there.
    cmov: (a, b, c) => c ? b : a
  });
  return Object.freeze(f);
}

var _0n3 = BigInt(0);
var _1n3 = BigInt(1);
function negateCt(condition, item) {
  const neg = item.negate();
  return condition ? neg : item;
}
function normalizeZ(c, points) {
  const invertedZs = FpInvertBatch(c.Fp, points.map((p) => p.Z));
  return points.map((p, i) => c.fromAffine(p.toAffine(invertedZs[i])));
}
function validateW(W, bits) {
  if (!Number.isSafeInteger(W) || W <= 0 || W > bits)
    throw new Error("invalid window size, expected [1.." + bits + "], got W=" + W);
}
function calcWOpts(W, scalarBits) {
  validateW(W, scalarBits);
  const windows = Math.ceil(scalarBits / W) + 1;
  const windowSize = 2 ** (W - 1);
  const maxNumber = 2 ** W;
  const mask = bitMask(W);
  const shiftBy = BigInt(W);
  return { windows, windowSize, mask, maxNumber, shiftBy };
}
function calcOffsets(n, window, wOpts) {
  const { windowSize, mask, maxNumber, shiftBy } = wOpts;
  let wbits = Number(n & mask);
  let nextN = n >> shiftBy;
  if (wbits > windowSize) {
    wbits -= maxNumber;
    nextN += _1n3;
  }
  const offsetStart = window * windowSize;
  const offset = offsetStart + Math.abs(wbits) - 1;
  const isZero = wbits === 0;
  const isNeg = wbits < 0;
  const isNegF = window % 2 !== 0;
  const offsetF = offsetStart;
  return { nextN, offset, isZero, isNeg, isNegF, offsetF };
}
function validateMSMPoints(points, c) {
  if (!Array.isArray(points))
    throw new Error("array expected");
  points.forEach((p, i) => {
    if (!(p instanceof c))
      throw new Error("invalid point at index " + i);
  });
}
function validateMSMScalars(scalars, field) {
  if (!Array.isArray(scalars))
    throw new Error("array of scalars expected");
  scalars.forEach((s, i) => {
    if (!field.isValid(s))
      throw new Error("invalid scalar at index " + i);
  });
}
var pointPrecomputes = /* @__PURE__ */ new WeakMap();
var pointWindowSizes = /* @__PURE__ */ new WeakMap();
function getW(P) {
  return pointWindowSizes.get(P) || 1;
}
function assert0(n) {
  if (n !== _0n3)
    throw new Error("invalid wNAF");
}
var wNAF = class {
  // Parametrized with a given Point class (not individual point)
  constructor(Point2, bits) {
    this.BASE = Point2.BASE;
    this.ZERO = Point2.ZERO;
    this.Fn = Point2.Fn;
    this.bits = bits;
  }
  // non-const time multiplication ladder
  _unsafeLadder(elm, n, p = this.ZERO) {
    let d = elm;
    while (n > _0n3) {
      if (n & _1n3)
        p = p.add(d);
      d = d.double();
      n >>= _1n3;
    }
    return p;
  }
  /**
   * Creates a wNAF precomputation window. Used for caching.
   * Default window size is set by `utils.precompute()` and is equal to 8.
   * Number of precomputed points depends on the curve size:
   * 2^(𝑊−1) * (Math.ceil(𝑛 / 𝑊) + 1), where:
   * - 𝑊 is the window size
   * - 𝑛 is the bitlength of the curve order.
   * For a 256-bit curve and window size 8, the number of precomputed points is 128 * 33 = 4224.
   * @param point Point instance
   * @param W window size
   * @returns precomputed point tables flattened to a single array
   */
  precomputeWindow(point, W) {
    const { windows, windowSize } = calcWOpts(W, this.bits);
    const points = [];
    let p = point;
    let base = p;
    for (let window = 0; window < windows; window++) {
      base = p;
      points.push(base);
      for (let i = 1; i < windowSize; i++) {
        base = base.add(p);
        points.push(base);
      }
      p = base.double();
    }
    return points;
  }
  /**
   * Implements ec multiplication using precomputed tables and w-ary non-adjacent form.
   * More compact implementation:
   * https://github.com/paulmillr/noble-secp256k1/blob/47cb1669b6e506ad66b35fe7d76132ae97465da2/index.ts#L502-L541
   * @returns real and fake (for const-time) points
   */
  wNAF(W, precomputes, n) {
    if (!this.Fn.isValid(n))
      throw new Error("invalid scalar");
    let p = this.ZERO;
    let f = this.BASE;
    const wo = calcWOpts(W, this.bits);
    for (let window = 0; window < wo.windows; window++) {
      const { nextN, offset, isZero, isNeg, isNegF, offsetF } = calcOffsets(n, window, wo);
      n = nextN;
      if (isZero) {
        f = f.add(negateCt(isNegF, precomputes[offsetF]));
      } else {
        p = p.add(negateCt(isNeg, precomputes[offset]));
      }
    }
    assert0(n);
    return { p, f };
  }
  /**
   * Implements ec unsafe (non const-time) multiplication using precomputed tables and w-ary non-adjacent form.
   * @param acc accumulator point to add result of multiplication
   * @returns point
   */
  wNAFUnsafe(W, precomputes, n, acc = this.ZERO) {
    const wo = calcWOpts(W, this.bits);
    for (let window = 0; window < wo.windows; window++) {
      if (n === _0n3)
        break;
      const { nextN, offset, isZero, isNeg } = calcOffsets(n, window, wo);
      n = nextN;
      if (isZero) {
        continue;
      } else {
        const item = precomputes[offset];
        acc = acc.add(isNeg ? item.negate() : item);
      }
    }
    assert0(n);
    return acc;
  }
  getPrecomputes(W, point, transform) {
    let comp = pointPrecomputes.get(point);
    if (!comp) {
      comp = this.precomputeWindow(point, W);
      if (W !== 1) {
        if (typeof transform === "function")
          comp = transform(comp);
        pointPrecomputes.set(point, comp);
      }
    }
    return comp;
  }
  cached(point, scalar, transform) {
    const W = getW(point);
    return this.wNAF(W, this.getPrecomputes(W, point, transform), scalar);
  }
  unsafe(point, scalar, transform, prev) {
    const W = getW(point);
    if (W === 1)
      return this._unsafeLadder(point, scalar, prev);
    return this.wNAFUnsafe(W, this.getPrecomputes(W, point, transform), scalar, prev);
  }
  // We calculate precomputes for elliptic curve point multiplication
  // using windowed method. This specifies window size and
  // stores precomputed values. Usually only base point would be precomputed.
  createCache(P, W) {
    validateW(W, this.bits);
    pointWindowSizes.set(P, W);
    pointPrecomputes.delete(P);
  }
  hasCache(elm) {
    return getW(elm) !== 1;
  }
};
function pippenger(c, fieldN, points, scalars) {
  validateMSMPoints(points, c);
  validateMSMScalars(scalars, fieldN);
  const plength = points.length;
  const slength = scalars.length;
  if (plength !== slength)
    throw new Error("arrays of points and scalars must have equal length");
  const zero = c.ZERO;
  const wbits = bitLen(BigInt(plength));
  let windowSize = 1;
  if (wbits > 12)
    windowSize = wbits - 3;
  else if (wbits > 4)
    windowSize = wbits - 2;
  else if (wbits > 0)
    windowSize = 2;
  const MASK = bitMask(windowSize);
  const buckets = new Array(Number(MASK) + 1).fill(zero);
  const lastBits = Math.floor((fieldN.BITS - 1) / windowSize) * windowSize;
  let sum = zero;
  for (let i = lastBits; i >= 0; i -= windowSize) {
    buckets.fill(zero);
    for (let j = 0; j < slength; j++) {
      const scalar = scalars[j];
      const wbits2 = Number(scalar >> BigInt(i) & MASK);
      buckets[wbits2] = buckets[wbits2].add(points[j]);
    }
    let resI = zero;
    for (let j = buckets.length - 1, sumI = zero; j > 0; j--) {
      sumI = sumI.add(buckets[j]);
      resI = resI.add(sumI);
    }
    sum = sum.add(resI);
    if (i !== 0)
      for (let j = 0; j < windowSize; j++)
        sum = sum.double();
  }
  return sum;
}
function createField(order, field, isLE) {
  if (field) {
    if (field.ORDER !== order)
      throw new Error("Field.ORDER must match order: Fp == p, Fn == n");
    validateField(field);
    return field;
  } else {
    return Field(order, { isLE });
  }
}
function _createCurveFields(type, CURVE, curveOpts = {}, FpFnLE) {
  if (FpFnLE === void 0)
    FpFnLE = type === "edwards";
  if (!CURVE || typeof CURVE !== "object")
    throw new Error(`expected valid ${type} CURVE object`);
  for (const p of ["p", "n", "h"]) {
    const val = CURVE[p];
    if (!(typeof val === "bigint" && val > _0n3))
      throw new Error(`CURVE.${p} must be positive bigint`);
  }
  const Fp2 = createField(CURVE.p, curveOpts.Fp, FpFnLE);
  const Fn2 = createField(CURVE.n, curveOpts.Fn, FpFnLE);
  const _b = type === "weierstrass" ? "b" : "d";
  const params = ["Gx", "Gy", "a", _b];
  for (const p of params) {
    if (!Fp2.isValid(CURVE[p]))
      throw new Error(`CURVE.${p} must be valid field element of CURVE.Fp`);
  }
  CURVE = Object.freeze(Object.assign({}, CURVE));
  return { CURVE, Fp: Fp2, Fn: Fn2 };
}

var _0n4 = BigInt(0);
var _1n4 = BigInt(1);
var _2n2 = BigInt(2);
var _8n2 = BigInt(8);
function isEdValidXY(Fp2, CURVE, x, y) {
  const x2 = Fp2.sqr(x);
  const y2 = Fp2.sqr(y);
  const left = Fp2.add(Fp2.mul(CURVE.a, x2), y2);
  const right = Fp2.add(Fp2.ONE, Fp2.mul(CURVE.d, Fp2.mul(x2, y2)));
  return Fp2.eql(left, right);
}
function edwards(params, extraOpts = {}) {
  const validated = _createCurveFields("edwards", params, extraOpts, extraOpts.FpFnLE);
  const { Fp: Fp2, Fn: Fn2 } = validated;
  let CURVE = validated.CURVE;
  const { h: cofactor } = CURVE;
  _validateObject(extraOpts, {}, { uvRatio: "function" });
  const MASK = _2n2 << BigInt(Fn2.BYTES * 8) - _1n4;
  const modP = (n) => Fp2.create(n);
  const uvRatio2 = extraOpts.uvRatio || ((u, v) => {
    try {
      return { isValid: true, value: Fp2.sqrt(Fp2.div(u, v)) };
    } catch (e) {
      return { isValid: false, value: _0n4 };
    }
  });
  if (!isEdValidXY(Fp2, CURVE, CURVE.Gx, CURVE.Gy))
    throw new Error("bad curve params: generator point");
  function acoord(title, n, banZero = false) {
    const min = banZero ? _1n4 : _0n4;
    aInRange("coordinate " + title, n, min, MASK);
    return n;
  }
  function aextpoint(other) {
    if (!(other instanceof Point2))
      throw new Error("ExtendedPoint expected");
  }
  const toAffineMemo = memoized((p, iz) => {
    const { X, Y, Z } = p;
    const is0 = p.is0();
    if (iz == null)
      iz = is0 ? _8n2 : Fp2.inv(Z);
    const x = modP(X * iz);
    const y = modP(Y * iz);
    const zz = Fp2.mul(Z, iz);
    if (is0)
      return { x: _0n4, y: _1n4 };
    if (zz !== _1n4)
      throw new Error("invZ was invalid");
    return { x, y };
  });
  const assertValidMemo = memoized((p) => {
    const { a, d } = CURVE;
    if (p.is0())
      throw new Error("bad point: ZERO");
    const { X, Y, Z, T } = p;
    const X2 = modP(X * X);
    const Y2 = modP(Y * Y);
    const Z2 = modP(Z * Z);
    const Z4 = modP(Z2 * Z2);
    const aX2 = modP(X2 * a);
    const left = modP(Z2 * modP(aX2 + Y2));
    const right = modP(Z4 + modP(d * modP(X2 * Y2)));
    if (left !== right)
      throw new Error("bad point: equation left != right (1)");
    const XY = modP(X * Y);
    const ZT = modP(Z * T);
    if (XY !== ZT)
      throw new Error("bad point: equation left != right (2)");
    return true;
  });
  class Point2 {
    constructor(X, Y, Z, T) {
      this.X = acoord("x", X);
      this.Y = acoord("y", Y);
      this.Z = acoord("z", Z, true);
      this.T = acoord("t", T);
      Object.freeze(this);
    }
    static CURVE() {
      return CURVE;
    }
    static fromAffine(p) {
      if (p instanceof Point2)
        throw new Error("extended point not allowed");
      const { x, y } = p || {};
      acoord("x", x);
      acoord("y", y);
      return new Point2(x, y, _1n4, modP(x * y));
    }
    // Uses algo from RFC8032 5.1.3.
    static fromBytes(bytes, zip215 = false) {
      const len = Fp2.BYTES;
      const { a, d } = CURVE;
      bytes = copyBytes(_abytes2(bytes, len, "point"));
      _abool2(zip215, "zip215");
      const normed = copyBytes(bytes);
      const lastByte = bytes[len - 1];
      normed[len - 1] = lastByte & ~128;
      const y = bytesToNumberLE(normed);
      const max = zip215 ? MASK : Fp2.ORDER;
      aInRange("point.y", y, _0n4, max);
      const y2 = modP(y * y);
      const u = modP(y2 - _1n4);
      const v = modP(d * y2 - a);
      let { isValid, value: x } = uvRatio2(u, v);
      if (!isValid)
        throw new Error("bad point: invalid y coordinate");
      const isXOdd = (x & _1n4) === _1n4;
      const isLastByteOdd = (lastByte & 128) !== 0;
      if (!zip215 && x === _0n4 && isLastByteOdd)
        throw new Error("bad point: x=0 and x_0=1");
      if (isLastByteOdd !== isXOdd)
        x = modP(-x);
      return Point2.fromAffine({ x, y });
    }
    static fromHex(bytes, zip215 = false) {
      return Point2.fromBytes(ensureBytes("point", bytes), zip215);
    }
    get x() {
      return this.toAffine().x;
    }
    get y() {
      return this.toAffine().y;
    }
    precompute(windowSize = 8, isLazy = true) {
      wnaf.createCache(this, windowSize);
      if (!isLazy)
        this.multiply(_2n2);
      return this;
    }
    // Useful in fromAffine() - not for fromBytes(), which always created valid points.
    assertValidity() {
      assertValidMemo(this);
    }
    // Compare one point to another.
    equals(other) {
      aextpoint(other);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const { X: X2, Y: Y2, Z: Z2 } = other;
      const X1Z2 = modP(X1 * Z2);
      const X2Z1 = modP(X2 * Z1);
      const Y1Z2 = modP(Y1 * Z2);
      const Y2Z1 = modP(Y2 * Z1);
      return X1Z2 === X2Z1 && Y1Z2 === Y2Z1;
    }
    is0() {
      return this.equals(Point2.ZERO);
    }
    negate() {
      return new Point2(modP(-this.X), this.Y, this.Z, modP(-this.T));
    }
    // Fast algo for doubling Extended Point.
    // https://hyperelliptic.org/EFD/g1p/auto-twisted-extended.html#doubling-dbl-2008-hwcd
    // Cost: 4M + 4S + 1*a + 6add + 1*2.
    double() {
      const { a } = CURVE;
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const A = modP(X1 * X1);
      const B = modP(Y1 * Y1);
      const C = modP(_2n2 * modP(Z1 * Z1));
      const D = modP(a * A);
      const x1y1 = X1 + Y1;
      const E = modP(modP(x1y1 * x1y1) - A - B);
      const G = D + B;
      const F = G - C;
      const H = D - B;
      const X3 = modP(E * F);
      const Y3 = modP(G * H);
      const T3 = modP(E * H);
      const Z3 = modP(F * G);
      return new Point2(X3, Y3, Z3, T3);
    }
    // Fast algo for adding 2 Extended Points.
    // https://hyperelliptic.org/EFD/g1p/auto-twisted-extended.html#addition-add-2008-hwcd
    // Cost: 9M + 1*a + 1*d + 7add.
    add(other) {
      aextpoint(other);
      const { a, d } = CURVE;
      const { X: X1, Y: Y1, Z: Z1, T: T1 } = this;
      const { X: X2, Y: Y2, Z: Z2, T: T2 } = other;
      const A = modP(X1 * X2);
      const B = modP(Y1 * Y2);
      const C = modP(T1 * d * T2);
      const D = modP(Z1 * Z2);
      const E = modP((X1 + Y1) * (X2 + Y2) - A - B);
      const F = D - C;
      const G = D + C;
      const H = modP(B - a * A);
      const X3 = modP(E * F);
      const Y3 = modP(G * H);
      const T3 = modP(E * H);
      const Z3 = modP(F * G);
      return new Point2(X3, Y3, Z3, T3);
    }
    subtract(other) {
      return this.add(other.negate());
    }
    // Constant-time multiplication.
    multiply(scalar) {
      if (!Fn2.isValidNot0(scalar))
        throw new Error("invalid scalar: expected 1 <= sc < curve.n");
      const { p, f } = wnaf.cached(this, scalar, (p2) => normalizeZ(Point2, p2));
      return normalizeZ(Point2, [p, f])[0];
    }
    // Non-constant-time multiplication. Uses double-and-add algorithm.
    // It's faster, but should only be used when you don't care about
    // an exposed private key e.g. sig verification.
    // Does NOT allow scalars higher than CURVE.n.
    // Accepts optional accumulator to merge with multiply (important for sparse scalars)
    multiplyUnsafe(scalar, acc = Point2.ZERO) {
      if (!Fn2.isValid(scalar))
        throw new Error("invalid scalar: expected 0 <= sc < curve.n");
      if (scalar === _0n4)
        return Point2.ZERO;
      if (this.is0() || scalar === _1n4)
        return this;
      return wnaf.unsafe(this, scalar, (p) => normalizeZ(Point2, p), acc);
    }
    // Checks if point is of small order.
    // If you add something to small order point, you will have "dirty"
    // point with torsion component.
    // Multiplies point by cofactor and checks if the result is 0.
    isSmallOrder() {
      return this.multiplyUnsafe(cofactor).is0();
    }
    // Multiplies point by curve order and checks if the result is 0.
    // Returns `false` is the point is dirty.
    isTorsionFree() {
      return wnaf.unsafe(this, CURVE.n).is0();
    }
    // Converts Extended point to default (x, y) coordinates.
    // Can accept precomputed Z^-1 - for example, from invertBatch.
    toAffine(invertedZ) {
      return toAffineMemo(this, invertedZ);
    }
    clearCofactor() {
      if (cofactor === _1n4)
        return this;
      return this.multiplyUnsafe(cofactor);
    }
    toBytes() {
      const { x, y } = this.toAffine();
      const bytes = Fp2.toBytes(y);
      bytes[bytes.length - 1] |= x & _1n4 ? 128 : 0;
      return bytes;
    }
    toHex() {
      return bytesToHex(this.toBytes());
    }
    toString() {
      return `<Point ${this.is0() ? "ZERO" : this.toHex()}>`;
    }
    // TODO: remove
    get ex() {
      return this.X;
    }
    get ey() {
      return this.Y;
    }
    get ez() {
      return this.Z;
    }
    get et() {
      return this.T;
    }
    static normalizeZ(points) {
      return normalizeZ(Point2, points);
    }
    static msm(points, scalars) {
      return pippenger(Point2, Fn2, points, scalars);
    }
    _setWindowSize(windowSize) {
      this.precompute(windowSize);
    }
    toRawBytes() {
      return this.toBytes();
    }
  }
  Point2.BASE = new Point2(CURVE.Gx, CURVE.Gy, _1n4, modP(CURVE.Gx * CURVE.Gy));
  Point2.ZERO = new Point2(_0n4, _1n4, _1n4, _0n4);
  Point2.Fp = Fp2;
  Point2.Fn = Fn2;
  const wnaf = new wNAF(Point2, Fn2.BITS);
  Point2.BASE.precompute(8);
  return Point2;
}
var PrimeEdwardsPoint = class {
  constructor(ep) {
    this.ep = ep;
  }
  // Static methods that must be implemented by subclasses
  static fromBytes(_bytes) {
    notImplemented();
  }
  static fromHex(_hex) {
    notImplemented();
  }
  get x() {
    return this.toAffine().x;
  }
  get y() {
    return this.toAffine().y;
  }
  // Common implementations
  clearCofactor() {
    return this;
  }
  assertValidity() {
    this.ep.assertValidity();
  }
  toAffine(invertedZ) {
    return this.ep.toAffine(invertedZ);
  }
  toHex() {
    return bytesToHex(this.toBytes());
  }
  toString() {
    return this.toHex();
  }
  isTorsionFree() {
    return true;
  }
  isSmallOrder() {
    return false;
  }
  add(other) {
    this.assertSame(other);
    return this.init(this.ep.add(other.ep));
  }
  subtract(other) {
    this.assertSame(other);
    return this.init(this.ep.subtract(other.ep));
  }
  multiply(scalar) {
    return this.init(this.ep.multiply(scalar));
  }
  multiplyUnsafe(scalar) {
    return this.init(this.ep.multiplyUnsafe(scalar));
  }
  double() {
    return this.init(this.ep.double());
  }
  negate() {
    return this.init(this.ep.negate());
  }
  precompute(windowSize, isLazy) {
    return this.init(this.ep.precompute(windowSize, isLazy));
  }
  /** @deprecated use `toBytes` */
  toRawBytes() {
    return this.toBytes();
  }
};
function eddsa(Point2, cHash, eddsaOpts = {}) {
  if (typeof cHash !== "function")
    throw new Error('"hash" function param is required');
  _validateObject(eddsaOpts, {}, {
    adjustScalarBytes: "function",
    randomBytes: "function",
    domain: "function",
    prehash: "function",
    mapToCurve: "function"
  });
  const { prehash } = eddsaOpts;
  const { BASE, Fp: Fp2, Fn: Fn2 } = Point2;
  const randomBytes3 = eddsaOpts.randomBytes || randomBytes;
  const adjustScalarBytes2 = eddsaOpts.adjustScalarBytes || ((bytes) => bytes);
  const domain = eddsaOpts.domain || ((data, ctx, phflag) => {
    _abool2(phflag, "phflag");
    if (ctx.length || phflag)
      throw new Error("Contexts/pre-hash are not supported");
    return data;
  });
  function modN_LE(hash) {
    return Fn2.create(bytesToNumberLE(hash));
  }
  function getPrivateScalar(key) {
    const len = lengths.secretKey;
    key = ensureBytes("private key", key, len);
    const hashed = ensureBytes("hashed private key", cHash(key), 2 * len);
    const head = adjustScalarBytes2(hashed.slice(0, len));
    const prefix = hashed.slice(len, 2 * len);
    const scalar = modN_LE(head);
    return { head, prefix, scalar };
  }
  function getExtendedPublicKey(secretKey) {
    const { head, prefix, scalar } = getPrivateScalar(secretKey);
    const point = BASE.multiply(scalar);
    const pointBytes = point.toBytes();
    return { head, prefix, scalar, point, pointBytes };
  }
  function getPublicKey(secretKey) {
    return getExtendedPublicKey(secretKey).pointBytes;
  }
  function hashDomainToScalar(context = Uint8Array.of(), ...msgs) {
    const msg = concatBytes(...msgs);
    return modN_LE(cHash(domain(msg, ensureBytes("context", context), !!prehash)));
  }
  function sign(msg, secretKey, options = {}) {
    msg = ensureBytes("message", msg);
    if (prehash)
      msg = prehash(msg);
    const { prefix, scalar, pointBytes } = getExtendedPublicKey(secretKey);
    const r = hashDomainToScalar(options.context, prefix, msg);
    const R = BASE.multiply(r).toBytes();
    const k = hashDomainToScalar(options.context, R, pointBytes, msg);
    const s = Fn2.create(r + k * scalar);
    if (!Fn2.isValid(s))
      throw new Error("sign failed: invalid s");
    const rs = concatBytes(R, Fn2.toBytes(s));
    return _abytes2(rs, lengths.signature, "result");
  }
  const verifyOpts = { zip215: true };
  function verify(sig, msg, publicKey, options = verifyOpts) {
    const { context, zip215 } = options;
    const len = lengths.signature;
    sig = ensureBytes("signature", sig, len);
    msg = ensureBytes("message", msg);
    publicKey = ensureBytes("publicKey", publicKey, lengths.publicKey);
    if (zip215 !== void 0)
      _abool2(zip215, "zip215");
    if (prehash)
      msg = prehash(msg);
    const mid = len / 2;
    const r = sig.subarray(0, mid);
    const s = bytesToNumberLE(sig.subarray(mid, len));
    let A, R, SB;
    try {
      A = Point2.fromBytes(publicKey, zip215);
      R = Point2.fromBytes(r, zip215);
      SB = BASE.multiplyUnsafe(s);
    } catch (error) {
      return false;
    }
    if (!zip215 && A.isSmallOrder())
      return false;
    const k = hashDomainToScalar(context, R.toBytes(), A.toBytes(), msg);
    const RkA = R.add(A.multiplyUnsafe(k));
    return RkA.subtract(SB).clearCofactor().is0();
  }
  const _size = Fp2.BYTES;
  const lengths = {
    secretKey: _size,
    publicKey: _size,
    signature: 2 * _size,
    seed: _size
  };
  function randomSecretKey(seed = randomBytes3(lengths.seed)) {
    return _abytes2(seed, lengths.seed, "seed");
  }
  function keygen(seed) {
    const secretKey = utils.randomSecretKey(seed);
    return { secretKey, publicKey: getPublicKey(secretKey) };
  }
  function isValidSecretKey(key) {
    return isBytes(key) && key.length === Fn2.BYTES;
  }
  function isValidPublicKey(key, zip215) {
    try {
      return !!Point2.fromBytes(key, zip215);
    } catch (error) {
      return false;
    }
  }
  const utils = {
    getExtendedPublicKey,
    randomSecretKey,
    isValidSecretKey,
    isValidPublicKey,
    /**
     * Converts ed public key to x public key. Uses formula:
     * - ed25519:
     *   - `(u, v) = ((1+y)/(1-y), sqrt(-486664)*u/x)`
     *   - `(x, y) = (sqrt(-486664)*u/v, (u-1)/(u+1))`
     * - ed448:
     *   - `(u, v) = ((y-1)/(y+1), sqrt(156324)*u/x)`
     *   - `(x, y) = (sqrt(156324)*u/v, (1+u)/(1-u))`
     */
    toMontgomery(publicKey) {
      const { y } = Point2.fromBytes(publicKey);
      const size = lengths.publicKey;
      const is25519 = size === 32;
      if (!is25519 && size !== 57)
        throw new Error("only defined for 25519 and 448");
      const u = is25519 ? Fp2.div(_1n4 + y, _1n4 - y) : Fp2.div(y - _1n4, y + _1n4);
      return Fp2.toBytes(u);
    },
    toMontgomerySecret(secretKey) {
      const size = lengths.secretKey;
      _abytes2(secretKey, size);
      const hashed = cHash(secretKey.subarray(0, size));
      return adjustScalarBytes2(hashed).subarray(0, size);
    },
    /** @deprecated */
    randomPrivateKey: randomSecretKey,
    /** @deprecated */
    precompute(windowSize = 8, point = Point2.BASE) {
      return point.precompute(windowSize, false);
    }
  };
  return Object.freeze({
    keygen,
    getPublicKey,
    sign,
    verify,
    utils,
    Point: Point2,
    lengths
  });
}
function _eddsa_legacy_opts_to_new(c) {
  const CURVE = {
    a: c.a,
    d: c.d,
    p: c.Fp.ORDER,
    n: c.n,
    h: c.h,
    Gx: c.Gx,
    Gy: c.Gy
  };
  const Fp2 = c.Fp;
  const Fn2 = Field(CURVE.n, c.nBitLength, true);
  const curveOpts = { Fp: Fp2, Fn: Fn2, uvRatio: c.uvRatio };
  const eddsaOpts = {
    randomBytes: c.randomBytes,
    adjustScalarBytes: c.adjustScalarBytes,
    domain: c.domain,
    prehash: c.prehash,
    mapToCurve: c.mapToCurve
  };
  return { CURVE, curveOpts, hash: c.hash, eddsaOpts };
}
function _eddsa_new_output_to_legacy(c, eddsa2) {
  const Point2 = eddsa2.Point;
  const legacy = Object.assign({}, eddsa2, {
    ExtendedPoint: Point2,
    CURVE: c,
    nBitLength: Point2.Fn.BITS,
    nByteLength: Point2.Fn.BYTES
  });
  return legacy;
}
function twistedEdwards(c) {
  const { CURVE, curveOpts, hash, eddsaOpts } = _eddsa_legacy_opts_to_new(c);
  const Point2 = edwards(CURVE, curveOpts);
  const EDDSA = eddsa(Point2, hash, eddsaOpts);
  return _eddsa_new_output_to_legacy(c, EDDSA);
}

var _0n5 = BigInt(0);
var _1n5 = BigInt(1);
var _2n3 = BigInt(2);
function validateOpts(curve) {
  _validateObject(curve, {
    adjustScalarBytes: "function",
    powPminus2: "function"
  });
  return Object.freeze({ ...curve });
}
function montgomery(curveDef) {
  const CURVE = validateOpts(curveDef);
  const { P, type, adjustScalarBytes: adjustScalarBytes2, powPminus2, randomBytes: rand } = CURVE;
  const is25519 = type === "x25519";
  if (!is25519 && type !== "x448")
    throw new Error("invalid type");
  const randomBytes_ = rand || randomBytes;
  const montgomeryBits = is25519 ? 255 : 448;
  const fieldLen = is25519 ? 32 : 56;
  const Gu = is25519 ? BigInt(9) : BigInt(5);
  const a24 = is25519 ? BigInt(121665) : BigInt(39081);
  const minScalar = is25519 ? _2n3 ** BigInt(254) : _2n3 ** BigInt(447);
  const maxAdded = is25519 ? BigInt(8) * _2n3 ** BigInt(251) - _1n5 : BigInt(4) * _2n3 ** BigInt(445) - _1n5;
  const maxScalar = minScalar + maxAdded + _1n5;
  const modP = (n) => mod(n, P);
  const GuBytes = encodeU(Gu);
  function encodeU(u) {
    return numberToBytesLE(modP(u), fieldLen);
  }
  function decodeU(u) {
    const _u = ensureBytes("u coordinate", u, fieldLen);
    if (is25519)
      _u[31] &= 127;
    return modP(bytesToNumberLE(_u));
  }
  function decodeScalar(scalar) {
    return bytesToNumberLE(adjustScalarBytes2(ensureBytes("scalar", scalar, fieldLen)));
  }
  function scalarMult(scalar, u) {
    const pu = montgomeryLadder(decodeU(u), decodeScalar(scalar));
    if (pu === _0n5)
      throw new Error("invalid private or public key received");
    return encodeU(pu);
  }
  function scalarMultBase(scalar) {
    return scalarMult(scalar, GuBytes);
  }
  function cswap(swap, x_2, x_3) {
    const dummy = modP(swap * (x_2 - x_3));
    x_2 = modP(x_2 - dummy);
    x_3 = modP(x_3 + dummy);
    return { x_2, x_3 };
  }
  function montgomeryLadder(u, scalar) {
    aInRange("u", u, _0n5, P);
    aInRange("scalar", scalar, minScalar, maxScalar);
    const k = scalar;
    const x_1 = u;
    let x_2 = _1n5;
    let z_2 = _0n5;
    let x_3 = u;
    let z_3 = _1n5;
    let swap = _0n5;
    for (let t = BigInt(montgomeryBits - 1); t >= _0n5; t--) {
      const k_t = k >> t & _1n5;
      swap ^= k_t;
      ({ x_2, x_3 } = cswap(swap, x_2, x_3));
      ({ x_2: z_2, x_3: z_3 } = cswap(swap, z_2, z_3));
      swap = k_t;
      const A = x_2 + z_2;
      const AA = modP(A * A);
      const B = x_2 - z_2;
      const BB = modP(B * B);
      const E = AA - BB;
      const C = x_3 + z_3;
      const D = x_3 - z_3;
      const DA = modP(D * A);
      const CB = modP(C * B);
      const dacb = DA + CB;
      const da_cb = DA - CB;
      x_3 = modP(dacb * dacb);
      z_3 = modP(x_1 * modP(da_cb * da_cb));
      x_2 = modP(AA * BB);
      z_2 = modP(E * (AA + modP(a24 * E)));
    }
    ({ x_2, x_3 } = cswap(swap, x_2, x_3));
    ({ x_2: z_2, x_3: z_3 } = cswap(swap, z_2, z_3));
    const z2 = powPminus2(z_2);
    return modP(x_2 * z2);
  }
  const lengths = {
    secretKey: fieldLen,
    publicKey: fieldLen,
    seed: fieldLen
  };
  const randomSecretKey = (seed = randomBytes_(fieldLen)) => {
    abytes(seed, lengths.seed);
    return seed;
  };
  function keygen(seed) {
    const secretKey = randomSecretKey(seed);
    return { secretKey, publicKey: scalarMultBase(secretKey) };
  }
  const utils = {
    randomSecretKey,
    randomPrivateKey: randomSecretKey
  };
  return {
    keygen,
    getSharedSecret: (secretKey, publicKey) => scalarMult(secretKey, publicKey),
    getPublicKey: (secretKey) => scalarMultBase(secretKey),
    scalarMult,
    scalarMultBase,
    utils,
    GuBytes: GuBytes.slice(),
    lengths
  };
}

var _0n6 = /* @__PURE__ */ BigInt(0);
var _1n6 = BigInt(1);
var _2n4 = BigInt(2);
var _3n2 = BigInt(3);
var _5n2 = BigInt(5);
var _8n3 = BigInt(8);
var ed25519_CURVE_p = BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffed");
var ed25519_CURVE = /* @__PURE__ */ (() => ({
  p: ed25519_CURVE_p,
  n: BigInt("0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed"),
  h: _8n3,
  a: BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffec"),
  d: BigInt("0x52036cee2b6ffe738cc740797779e89800700a4d4141d8ab75eb4dca135978a3"),
  Gx: BigInt("0x216936d3cd6e53fec0a4e231fdd6dc5c692cc7609525a7b2c9562d608f25d51a"),
  Gy: BigInt("0x6666666666666666666666666666666666666666666666666666666666666658")
}))();
function ed25519_pow_2_252_3(x) {
  const _10n = BigInt(10), _20n = BigInt(20), _40n = BigInt(40), _80n = BigInt(80);
  const P = ed25519_CURVE_p;
  const x2 = x * x % P;
  const b2 = x2 * x % P;
  const b4 = pow2(b2, _2n4, P) * b2 % P;
  const b5 = pow2(b4, _1n6, P) * x % P;
  const b10 = pow2(b5, _5n2, P) * b5 % P;
  const b20 = pow2(b10, _10n, P) * b10 % P;
  const b40 = pow2(b20, _20n, P) * b20 % P;
  const b80 = pow2(b40, _40n, P) * b40 % P;
  const b160 = pow2(b80, _80n, P) * b80 % P;
  const b240 = pow2(b160, _80n, P) * b80 % P;
  const b250 = pow2(b240, _10n, P) * b10 % P;
  const pow_p_5_8 = pow2(b250, _2n4, P) * x % P;
  return { pow_p_5_8, b2 };
}
function adjustScalarBytes(bytes) {
  bytes[0] &= 248;
  bytes[31] &= 127;
  bytes[31] |= 64;
  return bytes;
}
var ED25519_SQRT_M1 = /* @__PURE__ */ BigInt("19681161376707505956807079304988542015446066515923890162744021073123829784752");
function uvRatio(u, v) {
  const P = ed25519_CURVE_p;
  const v3 = mod(v * v * v, P);
  const v7 = mod(v3 * v3 * v, P);
  const pow = ed25519_pow_2_252_3(u * v7).pow_p_5_8;
  let x = mod(u * v3 * pow, P);
  const vx2 = mod(v * x * x, P);
  const root1 = x;
  const root2 = mod(x * ED25519_SQRT_M1, P);
  const useRoot1 = vx2 === u;
  const useRoot2 = vx2 === mod(-u, P);
  const noRoot = vx2 === mod(-u * ED25519_SQRT_M1, P);
  if (useRoot1)
    x = root1;
  if (useRoot2 || noRoot)
    x = root2;
  if (isNegativeLE(x, P))
    x = mod(-x, P);
  return { isValid: useRoot1 || useRoot2, value: x };
}
var Fp = /* @__PURE__ */ (() => Field(ed25519_CURVE.p, { isLE: true }))();
var Fn = /* @__PURE__ */ (() => Field(ed25519_CURVE.n, { isLE: true }))();
var ed25519Defaults = /* @__PURE__ */ (() => ({
  ...ed25519_CURVE,
  Fp,
  hash: sha512,
  adjustScalarBytes,
  // dom2
  // Ratio of u to v. Allows us to combine inversion and square root. Uses algo from RFC8032 5.1.3.
  // Constant-time, u/√v
  uvRatio
}))();
var ed25519 = /* @__PURE__ */ (() => twistedEdwards(ed25519Defaults))();
var x25519 = /* @__PURE__ */ (() => {
  const P = Fp.ORDER;
  return montgomery({
    P,
    type: "x25519",
    powPminus2: (x) => {
      const { pow_p_5_8, b2 } = ed25519_pow_2_252_3(x);
      return mod(pow2(pow_p_5_8, _3n2, P) * b2, P);
    },
    adjustScalarBytes
  });
})();
var SQRT_M1 = ED25519_SQRT_M1;
var SQRT_AD_MINUS_ONE = /* @__PURE__ */ BigInt("25063068953384623474111414158702152701244531502492656460079210482610430750235");
var INVSQRT_A_MINUS_D = /* @__PURE__ */ BigInt("54469307008909316920995813868745141605393597292927456921205312896311721017578");
var ONE_MINUS_D_SQ = /* @__PURE__ */ BigInt("1159843021668779879193775521855586647937357759715417654439879720876111806838");
var D_MINUS_ONE_SQ = /* @__PURE__ */ BigInt("40440834346308536858101042469323190826248399146238708352240133220865137265952");
var invertSqrt = (number) => uvRatio(_1n6, number);
var MAX_255B = /* @__PURE__ */ BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
var bytes255ToNumberLE = (bytes) => ed25519.Point.Fp.create(bytesToNumberLE(bytes) & MAX_255B);
function calcElligatorRistrettoMap(r0) {
  const { d } = ed25519_CURVE;
  const P = ed25519_CURVE_p;
  const mod2 = (n) => Fp.create(n);
  const r = mod2(SQRT_M1 * r0 * r0);
  const Ns = mod2((r + _1n6) * ONE_MINUS_D_SQ);
  let c = BigInt(-1);
  const D = mod2((c - d * r) * mod2(r + d));
  let { isValid: Ns_D_is_sq, value: s } = uvRatio(Ns, D);
  let s_ = mod2(s * r0);
  if (!isNegativeLE(s_, P))
    s_ = mod2(-s_);
  if (!Ns_D_is_sq)
    s = s_;
  if (!Ns_D_is_sq)
    c = r;
  const Nt = mod2(c * (r - _1n6) * D_MINUS_ONE_SQ - D);
  const s2 = s * s;
  const W0 = mod2((s + s) * D);
  const W1 = mod2(Nt * SQRT_AD_MINUS_ONE);
  const W2 = mod2(_1n6 - s2);
  const W3 = mod2(_1n6 + s2);
  return new ed25519.Point(mod2(W0 * W3), mod2(W2 * W1), mod2(W1 * W3), mod2(W0 * W2));
}
function ristretto255_map(bytes) {
  abytes(bytes, 64);
  const r1 = bytes255ToNumberLE(bytes.subarray(0, 32));
  const R1 = calcElligatorRistrettoMap(r1);
  const r2 = bytes255ToNumberLE(bytes.subarray(32, 64));
  const R2 = calcElligatorRistrettoMap(r2);
  return new _RistrettoPoint(R1.add(R2));
}
var _RistrettoPoint = class __RistrettoPoint extends PrimeEdwardsPoint {
  constructor(ep) {
    super(ep);
  }
  static fromAffine(ap) {
    return new __RistrettoPoint(ed25519.Point.fromAffine(ap));
  }
  assertSame(other) {
    if (!(other instanceof __RistrettoPoint))
      throw new Error("RistrettoPoint expected");
  }
  init(ep) {
    return new __RistrettoPoint(ep);
  }
  /** @deprecated use `import { ristretto255_hasher } from '@noble/curves/ed25519.js';` */
  static hashToCurve(hex) {
    return ristretto255_map(ensureBytes("ristrettoHash", hex, 64));
  }
  static fromBytes(bytes) {
    abytes(bytes, 32);
    const { a, d } = ed25519_CURVE;
    const P = ed25519_CURVE_p;
    const mod2 = (n) => Fp.create(n);
    const s = bytes255ToNumberLE(bytes);
    if (!equalBytes(Fp.toBytes(s), bytes) || isNegativeLE(s, P))
      throw new Error("invalid ristretto255 encoding 1");
    const s2 = mod2(s * s);
    const u1 = mod2(_1n6 + a * s2);
    const u2 = mod2(_1n6 - a * s2);
    const u1_2 = mod2(u1 * u1);
    const u2_2 = mod2(u2 * u2);
    const v = mod2(a * d * u1_2 - u2_2);
    const { isValid, value: I } = invertSqrt(mod2(v * u2_2));
    const Dx = mod2(I * u2);
    const Dy = mod2(I * Dx * v);
    let x = mod2((s + s) * Dx);
    if (isNegativeLE(x, P))
      x = mod2(-x);
    const y = mod2(u1 * Dy);
    const t = mod2(x * y);
    if (!isValid || isNegativeLE(t, P) || y === _0n6)
      throw new Error("invalid ristretto255 encoding 2");
    return new __RistrettoPoint(new ed25519.Point(x, y, _1n6, t));
  }
  /**
   * Converts ristretto-encoded string to ristretto point.
   * Described in [RFC9496](https://www.rfc-editor.org/rfc/rfc9496#name-decode).
   * @param hex Ristretto-encoded 32 bytes. Not every 32-byte string is valid ristretto encoding
   */
  static fromHex(hex) {
    return __RistrettoPoint.fromBytes(ensureBytes("ristrettoHex", hex, 32));
  }
  static msm(points, scalars) {
    return pippenger(__RistrettoPoint, ed25519.Point.Fn, points, scalars);
  }
  /**
   * Encodes ristretto point to Uint8Array.
   * Described in [RFC9496](https://www.rfc-editor.org/rfc/rfc9496#name-encode).
   */
  toBytes() {
    let { X, Y, Z, T } = this.ep;
    const P = ed25519_CURVE_p;
    const mod2 = (n) => Fp.create(n);
    const u1 = mod2(mod2(Z + Y) * mod2(Z - Y));
    const u2 = mod2(X * Y);
    const u2sq = mod2(u2 * u2);
    const { value: invsqrt } = invertSqrt(mod2(u1 * u2sq));
    const D1 = mod2(invsqrt * u1);
    const D2 = mod2(invsqrt * u2);
    const zInv = mod2(D1 * D2 * T);
    let D;
    if (isNegativeLE(T * zInv, P)) {
      let _x = mod2(Y * SQRT_M1);
      let _y = mod2(X * SQRT_M1);
      X = _x;
      Y = _y;
      D = mod2(D1 * INVSQRT_A_MINUS_D);
    } else {
      D = D2;
    }
    if (isNegativeLE(X * zInv, P))
      Y = mod2(-Y);
    let s = mod2((Z - Y) * D);
    if (isNegativeLE(s, P))
      s = mod2(-s);
    return Fp.toBytes(s);
  }
  /**
   * Compares two Ristretto points.
   * Described in [RFC9496](https://www.rfc-editor.org/rfc/rfc9496#name-equals).
   */
  equals(other) {
    this.assertSame(other);
    const { X: X1, Y: Y1 } = this.ep;
    const { X: X2, Y: Y2 } = other.ep;
    const mod2 = (n) => Fp.create(n);
    const one = mod2(X1 * Y2) === mod2(Y1 * X2);
    const two = mod2(Y1 * Y2) === mod2(X1 * X2);
    return one || two;
  }
  is0() {
    return this.equals(__RistrettoPoint.ZERO);
  }
};
_RistrettoPoint.BASE = /* @__PURE__ */ (() => new _RistrettoPoint(ed25519.Point.BASE))();
_RistrettoPoint.ZERO = /* @__PURE__ */ (() => new _RistrettoPoint(ed25519.Point.ZERO))();
_RistrettoPoint.Fp = /* @__PURE__ */ (() => Fp)();
_RistrettoPoint.Fn = /* @__PURE__ */ (() => Fn)();

var import_crypto2 = require("crypto");
var HKDF_INFO = "quarantine-blob-v1";
var SALT_BYTES = 16;
var NONCE_BYTES = 12;
var KEY_BYTES = 32;
function encryptForQuarantine(emailBytes, sandboxPeerX25519PubB64) {
  try {
    const recipientPubBytes = Buffer.from(sandboxPeerX25519PubB64, "base64");
    if (recipientPubBytes.length !== 32) {
      return {
        ok: false,
        error: `sandbox peer X25519 public key must be 32 bytes; got ${recipientPubBytes.length}`
      };
    }
    const ephemeralPriv = x25519.utils.randomPrivateKey();
    const ephemeralPub = x25519.getPublicKey(ephemeralPriv);
    const sharedSecret = x25519.getSharedSecret(ephemeralPriv, new Uint8Array(recipientPubBytes));
    const salt = (0, import_crypto2.randomBytes)(SALT_BYTES);
    const derivedKey = Buffer.from(
      (0, import_crypto2.hkdfSync)("sha256", Buffer.from(sharedSecret), salt, Buffer.from(HKDF_INFO, "utf-8"), KEY_BYTES)
    );
    const nonce = (0, import_crypto2.randomBytes)(NONCE_BYTES);
    const cipher = (0, import_crypto2.createCipheriv)("aes-256-gcm", derivedKey, nonce);
    const ct = Buffer.concat([cipher.update(emailBytes), cipher.final()]);
    const tag = cipher.getAuthTag();
    derivedKey.fill(0);
    sharedSecret.fill(0);
    ephemeralPriv.fill(0);
    return {
      ok: true,
      blob: {
        version: "quarantine-v1",
        sender_ephemeral_x25519_pub_b64: Buffer.from(ephemeralPub).toString("base64"),
        salt_b64: salt.toString("base64"),
        nonce_b64: nonce.toString("base64"),
        // Auth tag appended to ciphertext (matches decryptQBeapPackage.ts convention).
        ciphertext_b64: Buffer.concat([ct, tag]).toString("base64")
      }
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `encryptForQuarantine: ${msg}` };
  }
}

var MIME_LIMITS = {
  MAX_INPUT_BYTES: 8 * 1024 * 1024,
  MAX_PARTS: 64,
  MAX_HEADERS_BYTES: 64 * 1024
};
function parseHeaders(block) {
  const headers = /* @__PURE__ */ new Map();
  const unfolded = block.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const name = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (name && !headers.has(name)) headers.set(name, value);
  }
  return headers;
}
function decodeTransfer(bytes, encoding) {
  const enc = encoding.trim().toLowerCase();
  if (enc === "base64") {
    return Buffer.from(bytes.toString("ascii").replace(/\s+/g, ""), "base64");
  }
  if (enc === "quoted-printable") {
    const s = bytes.toString("latin1");
    const decoded = s.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
    return Buffer.from(decoded, "latin1");
  }
  return bytes;
}
function contentTypeOf(headers) {
  const ct = headers.get("content-type") ?? "text/plain";
  const type = ct.split(";")[0].trim().toLowerCase();
  const boundaryMatch = /boundary="?([^";]+)"?/i.exec(ct);
  const cd = headers.get("content-disposition") ?? "";
  const nameMatch = /filename="?([^";]+)"?/i.exec(cd) ?? /name="?([^";]+)"?/i.exec(ct);
  return {
    type,
    boundary: boundaryMatch?.[1],
    filename: nameMatch?.[1]
  };
}
function splitHeaderBody(raw) {
  const sep = raw.indexOf("\r\n\r\n");
  const sep2 = sep === -1 ? raw.indexOf("\n\n") : sep;
  if (sep2 === -1) return { headerBlock: raw.slice(0, MIME_LIMITS.MAX_HEADERS_BYTES), body: "" };
  const headerEnd = sep === -1 ? sep2 : sep;
  const bodyStart = sep === -1 ? sep2 + 2 : sep2 + 4;
  return { headerBlock: raw.slice(0, headerEnd), body: raw.slice(bodyStart) };
}
function extractMime(input) {
  const capped = input.length > MIME_LIMITS.MAX_INPUT_BYTES ? input.subarray(0, MIME_LIMITS.MAX_INPUT_BYTES) : input;
  const raw = capped.toString("latin1");
  const { headerBlock, body } = splitHeaderBody(raw);
  const headers = parseHeaders(headerBlock);
  const subject = headers.get("subject") ?? "";
  const top = contentTypeOf(headers);
  const plainTextParts = [];
  const artifactParts = [];
  const pushPart = (partHeaders, partBodyRaw) => {
    if (plainTextParts.length + artifactParts.length >= MIME_LIMITS.MAX_PARTS) return;
    const info = contentTypeOf(partHeaders);
    const cte = partHeaders.get("content-transfer-encoding") ?? "7bit";
    const decoded = decodeTransfer(Buffer.from(partBodyRaw, "latin1"), cte);
    const isAttachment = /attachment|inline/i.test(partHeaders.get("content-disposition") ?? "") && !!info.filename;
    if (info.type === "text/plain" && !isAttachment) {
      plainTextParts.push(decoded.toString("utf8"));
    } else {
      artifactParts.push({ contentType: info.type, bytes: decoded, filename: info.filename });
    }
  };
  if (top.type.startsWith("multipart/") && top.boundary) {
    const boundary = top.boundary;
    const segments = body.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:--)?\\r?\\n?`));
    for (const seg of segments) {
      if (!seg.trim()) continue;
      const { headerBlock: ph, body: pb } = splitHeaderBody(seg);
      if (!ph && !pb) continue;
      pushPart(parseHeaders(ph), pb);
      if (plainTextParts.length + artifactParts.length >= MIME_LIMITS.MAX_PARTS) break;
    }
  } else if (top.type === "text/plain" && !top.filename) {
    const cte = headers.get("content-transfer-encoding") ?? "7bit";
    plainTextParts.push(decodeTransfer(Buffer.from(body, "latin1"), cte).toString("utf8"));
  } else {
    const cte = headers.get("content-transfer-encoding") ?? "7bit";
    artifactParts.push({
      contentType: top.type,
      bytes: decodeTransfer(Buffer.from(body, "latin1"), cte),
      filename: top.filename
    });
  }
  return { subject, plainTextParts, artifactParts };
}

var SAFE_TEXT_SCHEMA = "safe-text/v1";
var SAFE_TEXT_LIMITS = {
  MAX_SUBJECT_CHARS: 2e3,
  MAX_BODY_CHARS: 1e6,
  MAX_ATTACHMENT_REFS: 256,
  /** blob_id is a UUID emitted by the worker. */
  BLOB_ID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
};
function toPlainTextField(raw, maxChars) {
  let s = typeof raw === "string" ? raw : "";
  try {
    s = s.normalize("NFC");
  } catch {
  }
  s = s.replace(/\r\n?/g, "\n");
  s = s.replace(
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g,
    ""
  );
  if (s.length > maxChars) s = s.slice(0, maxChars);
  return s;
}
function constructSafeText(input) {
  const subject = toPlainTextField(input.subjectRaw, SAFE_TEXT_LIMITS.MAX_SUBJECT_CHARS);
  const body_text = toPlainTextField(input.plainTextBodyRaw, SAFE_TEXT_LIMITS.MAX_BODY_CHARS);
  const attachment_refs = input.attachmentBlobIds.filter((id) => typeof id === "string" && SAFE_TEXT_LIMITS.BLOB_ID_RE.test(id)).slice(0, SAFE_TEXT_LIMITS.MAX_ATTACHMENT_REFS);
  return { schema: SAFE_TEXT_SCHEMA, subject, body_text, attachment_refs };
}

var import_crypto3 = require("crypto");

var Point = ed25519.Point ?? ed25519.ExtendedPoint;

function canonicalJobResultBytes(r) {
  const artifactDigest = (r.artifacts ?? []).map((a) => ({
    blob_id: a.blob_id,
    content_type: a.content_type,
    // Hash of the ciphertext — proves the result commits to exact blob bytes
    // without embedding them.
    ciphertext_sha256: (0, import_crypto3.createHash)("sha256").update(a.blob.ciphertext_b64, "utf8").digest("hex")
  }));
  const canonical = {
    jobId: r.jobId,
    ok: r.ok,
    safeText: r.safeText ?? null,
    artifacts: artifactDigest
  };
  return Buffer.from(JSON.stringify(canonical), "utf8");
}
function signJobResult(base, signingPrivKey) {
  const msg = canonicalJobResultBytes(base);
  const sig = ed25519.sign(msg, signingPrivKey);
  const pub = ed25519.getPublicKey(signingPrivKey);
  return {
    result_signing_pub_b64: Buffer.from(pub).toString("base64"),
    result_signature_b64: Buffer.from(sig).toString("base64")
  };
}
function stableStringify(value) {
  if (value === void 0 || value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v === void 0 ? null : v)).join(",")}]`;
  }
  const obj = value;
  const keys = Object.keys(obj).filter((k) => obj[k] !== void 0).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}
function canonicalDepackageEmailResultBytes(jobId, result) {
  let body;
  if (!result.ok) {
    body = { jobId, ok: false, code: result.code };
  } else {
    const artifacts = (result.artifacts ?? []).map((a) => ({
      blob_id: a.blob_id,
      content_type: a.content_type,
      ciphertext_sha256: (0, import_crypto3.createHash)("sha256").update(a.blob.ciphertext_b64, "utf8").digest("hex")
    }));
    const packages = (result.type === "beap-carrier" || result.type === "mixed" ? result.packages : []).map(
      (p) => ({
        encodingHint: p.encodingHint,
        source: p.source,
        bytes_sha256: (0, import_crypto3.createHash)("sha256").update(p.bytesB64, "utf8").digest("hex")
      })
    );
    const safeText = result.type === "beap-carrier" ? result.carrierSafeText ?? null : result.safeText;
    body = {
      jobId,
      ok: true,
      type: result.type,
      safeText,
      artifacts,
      packages,
      displayEnvelope: result.displayEnvelope,
      threadingHints: result.threadingHints
    };
  }
  return Buffer.from(stableStringify(body), "utf8");
}
function signDepackageEmailResult(jobId, result, signingPrivKey) {
  const msg = canonicalDepackageEmailResultBytes(jobId, result);
  const sig = ed25519.sign(msg, signingPrivKey);
  const pub = ed25519.getPublicKey(signingPrivKey);
  return {
    result_signing_pub_b64: Buffer.from(pub).toString("base64"),
    result_signature_b64: Buffer.from(sig).toString("base64")
  };
}

function depackage(inputBytes, sandboxPeerX25519PubB64) {
  let subjectRaw = "";
  let plainTextBodyRaw = "";
  const rawArtifacts = [];
  try {
    const mime = extractMime(inputBytes);
    subjectRaw = mime.subject;
    plainTextBodyRaw = mime.plainTextParts.join("\n\n");
    for (const part of mime.artifactParts) {
      rawArtifacts.push({ contentType: part.contentType, filename: part.filename, bytes: part.bytes });
    }
  } catch {
    subjectRaw = "";
    plainTextBodyRaw = "";
    rawArtifacts.length = 0;
    rawArtifacts.push({ contentType: "application/octet-stream", bytes: Buffer.from(inputBytes) });
  }
  const artifacts = [];
  for (const ra of rawArtifacts) {
    const enc = encryptForQuarantine(ra.bytes, sandboxPeerX25519PubB64);
    try {
      ra.bytes.fill(0);
    } catch {
    }
    if (!enc.ok) {
      throw new Error(`artifact custody failed: ${enc.error}`);
    }
    artifacts.push({
      blob_id: (0, import_crypto4.randomUUID)(),
      content_type: ra.contentType,
      filename: ra.filename,
      blob: enc.blob
    });
  }
  const safeText = constructSafeText({
    subjectRaw,
    plainTextBodyRaw,
    attachmentBlobIds: artifacts.map((a) => a.blob_id)
  });
  return { safeText, artifacts };
}
function runDepackagingJob(spec) {
  try {
    const { safeText, artifacts } = depackage(spec.inputBytes, spec.sandboxPeerX25519PubB64);
    const base = { jobId: spec.jobId, ok: true, safeText, artifacts };
    const signingPriv = ed25519.utils.randomPrivateKey();
    const sig = signJobResult(base, signingPriv);
    signingPriv.fill(0);
    return { ...base, ...sig };
  } catch (err) {
    return {
      jobId: spec.jobId,
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

var import_crypto5 = require("crypto");

var REMOVE_TAGS = [
  "script",
  "style",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "meta",
  "link",
  "base",
  "head",
  "noscript",
  "template"
];
var TRACKING_PATTERNS = [
  /track\./i,
  /pixel\./i,
  /beacon\./i,
  /analytics\./i,
  /mailchimp\.com/i,
  /sendgrid\.net/i,
  /mailgun\.org/i,
  /constantcontact\.com/i,
  /hubspot\.com/i,
  /salesforce\.com/i,
  /marketo\.com/i,
  /eloqua\.com/i,
  /pardot\.com/i,
  /utm_/i,
  /mc_cid/i,
  /mc_eid/i,
  /width=["']?1["']?.*height=["']?1["']?/i,
  /height=["']?1["']?.*width=["']?1["']?/i,
  /open\.gif/i,
  /pixel\.gif/i,
  /spacer\.gif/i,
  /blank\.gif/i,
  /track\.png/i
];
var HTML_ENTITIES = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&copy;": "©",
  "&reg;": "®",
  "&trade;": "™",
  "&mdash;": "—",
  "&ndash;": "–",
  "&hellip;": "…",
  "&lsquo;": "‘",
  "&rsquo;": "’",
  "&ldquo;": "“",
  "&rdquo;": "”",
  "&bull;": "•",
  "&middot;": "·",
  "&euro;": "€",
  "&pound;": "£",
  "&yen;": "¥",
  "&cent;": "¢"
};
function decodeHtmlEntities(text) {
  let result = text;
  for (const [entity, char] of Object.entries(HTML_ENTITIES)) {
    result = result.replace(new RegExp(entity, "gi"), char);
  }
  result = result.replace(
    /&#(\d+);/g,
    (_, code) => String.fromCharCode(parseInt(code, 10))
  );
  result = result.replace(
    /&#x([0-9a-f]+);/gi,
    (_, code) => String.fromCharCode(parseInt(code, 16))
  );
  return result;
}
function isTrackingPixel(tag) {
  return TRACKING_PATTERNS.some((pattern) => pattern.test(tag));
}
function removeDangerousTags(html) {
  let result = html;
  for (const tag of REMOVE_TAGS) {
    const regex = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi");
    result = result.replace(regex, "");
    const selfClosing = new RegExp(`<${tag}[^>]*\\/?>`, "gi");
    result = result.replace(selfClosing, "");
  }
  return result;
}
function removeEventHandlers(html) {
  return html.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, "").replace(/\s+on\w+\s*=\s*[^\s>]+/gi, "");
}
function removeDangerousCss(html) {
  return html.replace(/javascript\s*:/gi, "").replace(/expression\s*\(/gi, "").replace(/behavior\s*:/gi, "").replace(/-moz-binding\s*:/gi, "").replace(/vbscript\s*:/gi, "");
}
function removeTrackingPixels(html) {
  return html.replace(/<img[^>]*>/gi, (match) => {
    if (isTrackingPixel(match)) {
      return "";
    }
    if (/width\s*[:=]\s*["']?[01]px?["']?/i.test(match) || /height\s*[:=]\s*["']?[01]px?["']?/i.test(match)) {
      return "";
    }
    return match;
  });
}
var SKIP_LINK_PATTERNS = [
  /\.(png|jpg|jpeg|gif|svg|ico|webp|bmp)(\?|$)/i,
  /logo/i,
  /icon/i,
  /banner/i,
  /header/i,
  /footer/i,
  /spacer/i,
  /pixel/i,
  /facebook.*icon/i,
  /twitter.*icon/i,
  /linkedin.*icon/i,
  /instagram.*icon/i,
  /unsubscribe/i,
  /view.*browser/i,
  /email.*preferences/i,
  /cdn\./i,
  /static\./i,
  /assets\./i
];
function shouldSkipLink(url, text) {
  const combined = `${url} ${text}`.toLowerCase();
  return SKIP_LINK_PATTERNS.some((pattern) => pattern.test(combined));
}
function convertLinksToText(html) {
  return html.replace(
    /<a\s+[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_, url, text) => {
      const cleanText = text.replace(/<[^>]*>/g, "").trim();
      const cleanUrl = url.trim();
      if (/^(javascript|data):/i.test(cleanUrl)) {
        return cleanText;
      }
      if (shouldSkipLink(cleanUrl, cleanText)) {
        return cleanText;
      }
      if (!cleanUrl || cleanUrl === "#") {
        return cleanText;
      }
      if (!cleanText) {
        return "";
      }
      return `${cleanText} {{LINK_BUTTON:${cleanUrl}}}`;
    }
  );
}
function convertBlocksToBreaks(html) {
  const blockElements = ["p", "div", "br", "hr", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote"];
  let result = html;
  for (const tag of blockElements) {
    result = result.replace(new RegExp(`</${tag}>`, "gi"), "\n");
    if (tag === "br" || tag === "hr") {
      result = result.replace(new RegExp(`<${tag}[^>]*/?>`, "gi"), "\n");
    }
  }
  result = result.replace(/<\/(p|h[1-6])>/gi, "\n\n");
  result = result.replace(/<li[^>]*>/gi, "• ");
  return result;
}
function stripAllTags(html) {
  return html.replace(/<[^>]*>/g, "");
}
function cleanWhitespace(text) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/[ \t]+/g, " ").replace(/\n[ \t]+/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
function htmlToSafeText(html) {
  if (!html || typeof html !== "string") {
    return "";
  }
  let result = html;
  result = removeDangerousTags(result);
  result = removeEventHandlers(result);
  result = removeDangerousCss(result);
  result = removeTrackingPixels(result);
  result = convertLinksToText(result);
  result = convertBlocksToBreaks(result);
  result = stripAllTags(result);
  result = decodeHtmlEntities(result);
  result = cleanWhitespace(result);
  return result;
}

var DepackageFailure = class extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.code = code;
    this.name = "DepackageFailure";
  }
};
var DEPACKAGE_DEFAULTS = {
  MAX_INPUT_BYTES: 8 * 1024 * 1024,
  MAX_PARTS: 256,
  MAX_DEPTH: 8,
  MAX_HEADERS_BYTES: 64 * 1024,
  /** decoded/raw ratio ceiling — base64 shrinks, QP ~1x; >this ⇒ bomb. */
  MAX_DECODE_RATIO: 8
};
function resolveMaxInputBytes(limits) {
  return limits?.maxInputBytes != null && limits.maxInputBytes > 0 ? Math.min(limits.maxInputBytes, DEPACKAGE_DEFAULTS.MAX_INPUT_BYTES) : DEPACKAGE_DEFAULTS.MAX_INPUT_BYTES;
}

var ENVELOPE_CAPS = {
  MAX_SUBJECT_LEN: 2048,
  MAX_NAME_LEN: 998,
  MAX_EMAIL_LEN: 320,
  MAX_DATE_LEN: 128,
  MAX_RECIPIENTS: 256,
  MAX_MSGID_LEN: 998,
  MAX_REFERENCES: 64
};
function capMsgId(v) {
  if (!v) return void 0;
  const t = v.trim();
  if (!t) return void 0;
  return t.length > ENVELOPE_CAPS.MAX_MSGID_LEN ? t.slice(0, ENVELOPE_CAPS.MAX_MSGID_LEN) : t;
}
function threadingFromHeaders(headers) {
  const refsRaw = headers.get("references");
  const references = refsRaw ? refsRaw.split(/\s+/).map((s) => s.trim()).filter(Boolean).slice(0, ENVELOPE_CAPS.MAX_REFERENCES) : void 0;
  return {
    messageId: capMsgId(headers.get("message-id")),
    inReplyTo: capMsgId(headers.get("in-reply-to")),
    references: references && references.length ? references : void 0
  };
}
function threadingFromProvider(fields) {
  const references = fields.references ? fields.references.map((s) => s.trim()).filter(Boolean).slice(0, ENVELOPE_CAPS.MAX_REFERENCES) : void 0;
  return {
    messageId: capMsgId(fields.messageId),
    inReplyTo: capMsgId(fields.inReplyTo),
    references: references && references.length ? references : void 0
  };
}
var ENCODED_WORD = /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/;
function decodeQ(text) {
  const s = text.replace(/_/g, " ");
  const out = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "=" && i + 2 < s.length) {
      const h = s.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(h)) {
        out.push(parseInt(h, 16));
        i += 2;
        continue;
      }
    }
    out.push(s.charCodeAt(i) & 255);
  }
  return Buffer.from(out);
}
function decodeOne(charset, enc, text) {
  try {
    const bytes = enc.toLowerCase() === "b" ? Buffer.from(text.replace(/\s+/g, ""), "base64") : decodeQ(text);
    const dec = new TextDecoder(charset.trim().toLowerCase(), { fatal: false });
    return dec.decode(bytes);
  } catch {
    return null;
  }
}
function decodeHeaderText(raw) {
  if (!raw || !raw.includes("=?")) return { value: raw ?? "", degraded: false };
  const tokens = [];
  let rest = raw;
  const global = new RegExp(ENCODED_WORD.source, "g");
  let lastIndex = 0;
  let m;
  while ((m = global.exec(raw)) !== null) {
    if (m.index > lastIndex) tokens.push({ kind: "lit", text: raw.slice(lastIndex, m.index) });
    const decoded = decodeOne(m[1], m[2], m[3]);
    if (decoded === null) return { value: raw, degraded: true };
    tokens.push({ kind: "ew", text: m[0], decoded });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < raw.length) tokens.push({ kind: "lit", text: raw.slice(lastIndex) });
  let value = "";
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === "ew") {
      value += t.decoded;
    } else {
      const prev = tokens[i - 1];
      const next = tokens[i + 1];
      if (prev?.kind === "ew" && next?.kind === "ew" && /^\s*$/.test(t.text)) continue;
      value += t.text;
    }
  }
  return { value, degraded: false };
}
function capText(value, max) {
  if (value.length > max) return { value: value.slice(0, max), degraded: true };
  return { value, degraded: false };
}
function stripQuotes(s) {
  const t = s.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1).trim();
  return t;
}
function splitAddressList(raw) {
  const out = [];
  let cur = "";
  let inQuote = false;
  let inAngle = false;
  for (const ch of raw) {
    if (ch === '"' && !inAngle) inQuote = !inQuote;
    else if (ch === "<" && !inQuote) inAngle = true;
    else if (ch === ">" && !inQuote) inAngle = false;
    if (ch === "," && !inQuote && !inAngle) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function parseOneAddress(token, markDegraded) {
  const t = token.trim();
  if (!t) return null;
  const angle = /^(.*)<([^>]*)>\s*$/.exec(t);
  let rawName = "";
  let rawEmail = "";
  if (angle) {
    rawName = angle[1].trim();
    rawEmail = angle[2].trim();
  } else {
    rawEmail = t;
  }
  let name;
  if (rawName) {
    const dec = decodeHeaderText(stripQuotes(rawName));
    if (dec.degraded) markDegraded();
    const capped = capText(dec.value, ENVELOPE_CAPS.MAX_NAME_LEN);
    if (capped.degraded) markDegraded();
    name = capped.value || void 0;
  }
  const emailCap = capText(rawEmail, ENVELOPE_CAPS.MAX_EMAIL_LEN);
  if (emailCap.degraded) markDegraded();
  return name ? { email: emailCap.value, name } : { email: emailCap.value };
}
function parseAddressList(raw, fieldName, degraded) {
  if (!raw) return [];
  const mark = () => degraded.add(fieldName);
  let tokens = splitAddressList(raw);
  if (tokens.length > ENVELOPE_CAPS.MAX_RECIPIENTS) {
    tokens = tokens.slice(0, ENVELOPE_CAPS.MAX_RECIPIENTS);
    mark();
  }
  const out = [];
  for (const tok of tokens) {
    const a = parseOneAddress(tok, mark);
    if (a) out.push(a);
  }
  return out;
}
function normalizeSubject(raw, degraded) {
  const dec = decodeHeaderText(raw ?? "");
  if (dec.degraded) degraded.add("subject");
  const capped = capText(dec.value, ENVELOPE_CAPS.MAX_SUBJECT_LEN);
  if (capped.degraded) degraded.add("subject");
  return capped.value;
}
function normalizeDate(raw, degraded) {
  if (!raw) return void 0;
  const t = new Date(raw);
  if (!isNaN(t.getTime())) return t.toISOString();
  degraded.add("date");
  return capText(raw, ENVELOPE_CAPS.MAX_DATE_LEN).value;
}
function buildEnvelopeFromHeaders(headers) {
  const degraded = /* @__PURE__ */ new Set();
  const from = parseAddressList(headers.get("from"), "from", degraded);
  const to = parseAddressList(headers.get("to"), "to", degraded);
  const cc = parseAddressList(headers.get("cc"), "cc", degraded);
  const replyTo = parseAddressList(headers.get("reply-to"), "replyTo", degraded);
  return {
    subject: normalizeSubject(headers.get("subject"), degraded),
    from: from[0],
    to,
    cc,
    replyTo: replyTo[0],
    date: normalizeDate(headers.get("date"), degraded),
    degradedFields: [...degraded]
  };
}
function normalizeProviderAddress(a, fieldName, degraded) {
  if (!a) return void 0;
  let name;
  if (a.name) {
    const dec = decodeHeaderText(a.name);
    if (dec.degraded) degraded.add(fieldName);
    const capped = capText(dec.value, ENVELOPE_CAPS.MAX_NAME_LEN);
    if (capped.degraded) degraded.add(fieldName);
    name = capped.value || void 0;
  }
  const emailCap = capText(a.email ?? "", ENVELOPE_CAPS.MAX_EMAIL_LEN);
  if (emailCap.degraded) degraded.add(fieldName);
  return name ? { email: emailCap.value, name } : { email: emailCap.value };
}
function normalizeProviderList(list, fieldName, degraded) {
  if (!list || list.length === 0) return [];
  let items = list;
  if (items.length > ENVELOPE_CAPS.MAX_RECIPIENTS) {
    items = items.slice(0, ENVELOPE_CAPS.MAX_RECIPIENTS);
    degraded.add(fieldName);
  }
  const out = [];
  for (const a of items) {
    const n = normalizeProviderAddress(a, fieldName, degraded);
    if (n) out.push(n);
  }
  return out;
}
function buildEnvelopeFromFields(fields) {
  const degraded = /* @__PURE__ */ new Set();
  return {
    subject: normalizeSubject(fields.subject, degraded),
    from: normalizeProviderAddress(fields.from, "from", degraded),
    to: normalizeProviderList(fields.to, "to", degraded),
    cc: normalizeProviderList(fields.cc, "cc", degraded),
    replyTo: normalizeProviderAddress(fields.replyTo, "replyTo", degraded),
    date: normalizeDate(fields.date, degraded),
    degradedFields: [...degraded]
  };
}

function assertJsonDepth(value, max, depth = 0) {
  if (depth > max) {
    throw new DepackageFailure("E_LIMITS_EXCEEDED", "provider JSON nesting depth exceeded");
  }
  if (Array.isArray(value)) {
    for (const v of value) assertJsonDepth(v, max, depth + 1);
  } else if (value !== null && typeof value === "object") {
    for (const v of Object.values(value)) assertJsonDepth(v, max, depth + 1);
  }
}
function decodeBase64Guarded(b64) {
  const cleaned = b64.replace(/\s+/g, "");
  const decoded = Buffer.from(cleaned, "base64");
  if (cleaned.length > 0 && decoded.length > cleaned.length * DEPACKAGE_DEFAULTS.MAX_DECODE_RATIO) {
    throw new DepackageFailure("E_DECOMPRESSION_BOMB", "base64 decode expanded beyond ratio bound");
  }
  return decoded;
}
function chargeBytes(budget, n) {
  budget.decodedTotal += n;
  if (budget.decodedTotal > budget.maxInputBytes) {
    throw new DepackageFailure("E_LIMITS_EXCEEDED", "provider-structured decoded total exceeds maxInputBytes");
  }
}
function chargePart(budget) {
  budget.partCount += 1;
  if (budget.partCount > DEPACKAGE_DEFAULTS.MAX_PARTS) {
    throw new DepackageFailure("E_LIMITS_EXCEEDED", "provider-structured part count exceeded");
  }
}
function pushLeaf(out, budget, leaf) {
  if (leaf.bytes.length > budget.maxInputBytes) {
    throw new DepackageFailure("E_LIMITS_EXCEEDED", "provider-structured part size exceeded");
  }
  chargePart(budget);
  chargeBytes(budget, leaf.bytes.length);
  out.leaves.push(leaf);
}
function graphAddr(v) {
  if (v === null || typeof v !== "object") return void 0;
  const ea = v.emailAddress;
  if (ea === null || typeof ea !== "object") return void 0;
  const e = ea;
  return {
    email: typeof e.address === "string" ? e.address : void 0,
    name: typeof e.name === "string" ? e.name : void 0
  };
}
function graphList(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const item of v) {
    const a = graphAddr(item);
    if (a) out.push(a);
  }
  return out;
}
var outlookAdapter = {
  provider: "outlook",
  walk(obj, budget) {
    const envelopeFields = {
      subject: typeof obj.subject === "string" ? obj.subject : void 0,
      from: graphAddr(obj.from),
      to: graphList(obj.toRecipients),
      cc: graphList(obj.ccRecipients),
      replyTo: graphList(obj.replyTo)[0],
      date: typeof obj.receivedDateTime === "string" ? obj.receivedDateTime : void 0
    };
    const displayEnvelope = buildEnvelopeFromFields(envelopeFields);
    const out = {
      // SafeText subject uses the normalized envelope subject (parity with RFC822).
      subject: displayEnvelope.subject,
      plainTextParts: [],
      htmlParts: [],
      leaves: [],
      displayEnvelope,
      // Graph carries the RFC Message-ID as `internetMessageId`; conversationId is
      // the provider-native thread id used directly by the orchestrator.
      threadingHints: threadingFromProvider({
        messageId: typeof obj.internetMessageId === "string" ? obj.internetMessageId : void 0
      })
    };
    const body = obj.body;
    if (body !== void 0 && body !== null) {
      if (typeof body !== "object") {
        throw new DepackageFailure("E_AMBIGUOUS_STRUCTURE", "outlook body is not an object");
      }
      const b = body;
      const content = b.content;
      if (content !== void 0 && content !== null) {
        if (typeof content !== "string") {
          throw new DepackageFailure("E_AMBIGUOUS_STRUCTURE", "outlook body.content is not a string");
        }
        const ct = String(b.contentType ?? "").toLowerCase();
        const contentBytesLen = Buffer.byteLength(content, "utf8");
        if (ct === "html") {
          chargePart(budget);
          chargeBytes(budget, contentBytesLen);
          out.htmlParts.push(content);
          out.leaves.push({ contentType: "text/html", isAttachment: false, bytes: Buffer.from(content, "utf8") });
        } else if (ct === "text") {
          chargePart(budget);
          chargeBytes(budget, contentBytesLen);
          out.plainTextParts.push(content);
        } else {
          throw new DepackageFailure("E_AMBIGUOUS_STRUCTURE", `outlook body.contentType unrecognized: ${ct || "(absent)"}`);
        }
      }
    }
    const attachments = obj.attachments;
    if (attachments !== void 0 && attachments !== null) {
      if (!Array.isArray(attachments)) {
        throw new DepackageFailure("E_AMBIGUOUS_STRUCTURE", "outlook attachments is not an array");
      }
      for (const raw of attachments) {
        if (raw === null || typeof raw !== "object") {
          throw new DepackageFailure("E_AMBIGUOUS_STRUCTURE", "outlook attachment entry is not an object");
        }
        const att = raw;
        const contentBytes = att.contentBytes;
        if (contentBytes === void 0 || contentBytes === null) continue;
        if (typeof contentBytes !== "string") {
          throw new DepackageFailure("E_AMBIGUOUS_STRUCTURE", "outlook attachment.contentBytes is not a string");
        }
        const bytes = decodeBase64Guarded(contentBytes);
        const filename = typeof att.name === "string" ? att.name : void 0;
        const contentType = typeof att.contentType === "string" ? att.contentType : "application/octet-stream";
        pushLeaf(out, budget, { contentType, filename, isAttachment: true, bytes });
      }
    }
    return out;
  }
};
var ADAPTERS = /* @__PURE__ */ new Map([
  [outlookAdapter.provider, outlookAdapter]
]);
var DEFAULT_PROVIDER = "outlook";
function walkProviderStructured(input, opts, limits) {
  const maxInputBytes = resolveMaxInputBytes(limits);
  const rawStr = Buffer.isBuffer(input) ? input.toString("utf8") : input;
  if (Buffer.byteLength(rawStr, "utf8") > maxInputBytes) {
    throw new DepackageFailure("E_LIMITS_EXCEEDED", "provider-structured input exceeds maxInputBytes");
  }
  const providerKey = (opts.provider ?? DEFAULT_PROVIDER).toLowerCase();
  const adapter = ADAPTERS.get(providerKey);
  if (!adapter) {
    throw new DepackageFailure("E_AMBIGUOUS_STRUCTURE", `no structured-json adapter for provider '${providerKey}'`);
  }
  let parsed;
  try {
    parsed = JSON.parse(rawStr);
  } catch (err) {
    throw new DepackageFailure("E_AMBIGUOUS_STRUCTURE", `provider JSON parse failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new DepackageFailure("E_AMBIGUOUS_STRUCTURE", "provider JSON is not a message object");
  }
  assertJsonDepth(parsed, DEPACKAGE_DEFAULTS.MAX_DEPTH);
  const budget = { decodedTotal: 0, maxInputBytes, partCount: 0 };
  return adapter.walk(parsed, budget);
}

function parseHeaders2(block) {
  const headers = /* @__PURE__ */ new Map();
  const unfolded = block.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const name = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (name && !headers.has(name)) headers.set(name, value);
  }
  return headers;
}
function decodeTransfer2(rawBytes, encoding) {
  const enc = encoding.trim().toLowerCase();
  let decoded;
  if (enc === "base64") {
    decoded = Buffer.from(rawBytes.toString("ascii").replace(/\s+/g, ""), "base64");
  } else if (enc === "quoted-printable") {
    const s = rawBytes.toString("latin1");
    const d = s.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
    decoded = Buffer.from(d, "latin1");
  } else {
    decoded = rawBytes;
  }
  if (rawBytes.length > 0 && decoded.length > rawBytes.length * DEPACKAGE_DEFAULTS.MAX_DECODE_RATIO) {
    throw new DepackageFailure("E_DECOMPRESSION_BOMB", "transfer decode expanded beyond ratio bound");
  }
  return decoded;
}
function contentTypeOf2(headers) {
  const ct = headers.get("content-type") ?? "text/plain";
  const type = ct.split(";")[0].trim().toLowerCase();
  const boundaryMatch = /boundary="?([^";]+)"?/i.exec(ct);
  const cd = headers.get("content-disposition") ?? "";
  const nameMatch = /filename="?([^";]+)"?/i.exec(cd) ?? /name="?([^";]+)"?/i.exec(ct);
  return { type, boundary: boundaryMatch?.[1], filename: nameMatch?.[1] };
}
function splitHeaderBody2(raw) {
  const sep = raw.indexOf("\r\n\r\n");
  const sep2 = sep === -1 ? raw.indexOf("\n\n") : sep;
  if (sep2 === -1) return { headerBlock: raw.slice(0, DEPACKAGE_DEFAULTS.MAX_HEADERS_BYTES), body: "" };
  const headerEnd = sep === -1 ? sep2 : sep;
  const bodyStart = sep === -1 ? sep2 + 2 : sep2 + 4;
  return { headerBlock: raw.slice(0, headerEnd), body: raw.slice(bodyStart) };
}
function parseEntity(rawText, headers, out, depth, maxPartBytes) {
  if (depth > DEPACKAGE_DEFAULTS.MAX_DEPTH) {
    throw new DepackageFailure("E_LIMITS_EXCEEDED", "MIME nesting depth exceeded");
  }
  if (out.leaves.length + out.plainTextParts.length + out.htmlParts.length >= DEPACKAGE_DEFAULTS.MAX_PARTS) {
    throw new DepackageFailure("E_LIMITS_EXCEEDED", "MIME part count exceeded");
  }
  const info = contentTypeOf2(headers);
  if (info.type.startsWith("multipart/") && info.boundary) {
    const boundary = info.boundary;
    const segments = rawText.split(
      new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:--)?\\r?\\n?`)
    );
    for (const seg of segments) {
      if (!seg.trim()) continue;
      const { headerBlock: ph, body: pb } = splitHeaderBody2(seg);
      if (!ph && !pb) continue;
      parseEntity(pb, parseHeaders2(ph), out, depth + 1, maxPartBytes);
      if (out.leaves.length + out.plainTextParts.length + out.htmlParts.length >= DEPACKAGE_DEFAULTS.MAX_PARTS) break;
    }
    return;
  }
  const cte = headers.get("content-transfer-encoding") ?? "7bit";
  const decoded = decodeTransfer2(Buffer.from(rawText, "latin1"), cte);
  if (decoded.length > maxPartBytes) {
    throw new DepackageFailure("E_LIMITS_EXCEEDED", "MIME part size exceeded");
  }
  const isAttachment = /attachment|inline/i.test(headers.get("content-disposition") ?? "") && !!info.filename;
  if (info.type === "text/plain" && !isAttachment) {
    out.plainTextParts.push(decoded.toString("utf8"));
  } else if (info.type === "text/html" && !isAttachment) {
    out.htmlParts.push(decoded.toString("utf8"));
    out.leaves.push({ contentType: info.type, filename: info.filename, isAttachment, bytes: decoded });
  } else {
    out.leaves.push({ contentType: info.type, filename: info.filename, isAttachment, bytes: decoded });
  }
}
function hardenedParse(input, limits) {
  const maxInput = resolveMaxInputBytes(limits);
  if (input.length > maxInput) {
    throw new DepackageFailure("E_LIMITS_EXCEEDED", `input exceeds maxInputBytes (${input.length} > ${maxInput})`);
  }
  const raw = input.toString("latin1");
  const { headerBlock, body } = splitHeaderBody2(raw);
  const headers = parseHeaders2(headerBlock);
  const displayEnvelope = buildEnvelopeFromHeaders(headers);
  const out = {
    subject: displayEnvelope.subject,
    plainTextParts: [],
    htmlParts: [],
    leaves: [],
    displayEnvelope,
    threadingHints: threadingFromHeaders(headers)
  };
  parseEntity(body, headers, out, 0, maxInput);
  return out;
}
function detectBeapCapsule(text) {
  if (!text || typeof text !== "string") return { detected: false };
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return { detected: false };
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === "object" && parsed !== null && typeof parsed.schema_version === "number" && typeof parsed.capsule_type === "string" && ["initiate", "accept", "refresh", "revoke"].includes(parsed.capsule_type)) {
      return { detected: true, capsuleJson: trimmed };
    }
  } catch {
  }
  return { detected: false };
}
function detectBeapMessagePackage(text) {
  if (!text || typeof text !== "string") return { detected: false };
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return { detected: false };
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === "object" && parsed !== null && "header" in parsed && parsed.header != null && typeof parsed.header === "object" && "metadata" in parsed && parsed.metadata != null && typeof parsed.metadata === "object" && ("envelope" in parsed || "payload" in parsed)) {
      const enc = parsed.header?.encoding;
      if (enc != null && !["qBEAP", "pBEAP"].includes(enc)) {
        return { detected: false, ambiguous: true };
      }
      return { detected: true, packageJson: trimmed, encoding: typeof enc === "string" ? enc : "unknown" };
    }
  } catch {
  }
  return { detected: false };
}
function detectBeapInJson(parsed) {
  if (!parsed || typeof parsed !== "object") return false;
  const p = parsed;
  if (p.capsule_type && typeof p.schema_version === "number") return true;
  if (p.header && typeof p.header === "object" && (p.envelope != null || p.payload != null)) return true;
  return false;
}
function isBeapAttachment(filename, contentType) {
  const fn = (filename || "").toLowerCase();
  const ct = (contentType || "").toLowerCase();
  if (fn.endsWith(".beap")) return true;
  if (ct === "application/vnd.beap+json" || ct === "application/x-beap") return true;
  return false;
}
function isJsonAttachment(filename, contentType) {
  const fn = (filename || "").toLowerCase();
  const ct = (contentType || "").toLowerCase();
  if (fn.endsWith(".json")) return true;
  if (ct === "application/json") return true;
  return false;
}
function encodingHintOf(packageJson) {
  try {
    const enc = JSON.parse(packageJson)?.header?.encoding;
    if (enc === "qBEAP" || enc === "pBEAP") return enc;
  } catch {
  }
  return "unknown";
}
var MAX_DETECT_CHARS = 65536;
function detectCarrierPackages(parsed) {
  const packages = [];
  const consumedLeaves = /* @__PURE__ */ new Set();
  let ambiguous = false;
  let bodyConsumed = false;
  for (const leaf of parsed.leaves) {
    if (!isBeapAttachment(leaf.filename, leaf.contentType)) continue;
    if (leaf.bytes.length === 0) continue;
    const text = leaf.bytes.toString("utf-8");
    if (text.length > MAX_DETECT_CHARS) continue;
    const cap = detectBeapCapsule(text);
    if (cap.detected && cap.capsuleJson) {
      packages.push({ encodingHint: encodingHintOf(cap.capsuleJson), bytesB64: Buffer.from(cap.capsuleJson, "utf8").toString("base64"), source: "attachment" });
      consumedLeaves.add(leaf);
      continue;
    }
    const pkg = detectBeapMessagePackage(text);
    if (pkg.detected && pkg.packageJson) {
      packages.push({ encodingHint: pkg.encoding === "qBEAP" || pkg.encoding === "pBEAP" ? pkg.encoding : "unknown", bytesB64: Buffer.from(pkg.packageJson, "utf8").toString("base64"), source: "attachment" });
      consumedLeaves.add(leaf);
      continue;
    }
    ambiguous = true;
  }
  const bodyText = parsed.plainTextParts.join("\n\n");
  if (bodyText.trim().startsWith("{")) {
    const cap = detectBeapCapsule(bodyText);
    if (cap.detected && cap.capsuleJson) {
      packages.push({ encodingHint: encodingHintOf(cap.capsuleJson), bytesB64: Buffer.from(cap.capsuleJson, "utf8").toString("base64"), source: "body" });
      bodyConsumed = true;
    } else {
      const pkg = detectBeapMessagePackage(bodyText);
      if (pkg.detected && pkg.packageJson) {
        packages.push({ encodingHint: pkg.encoding === "qBEAP" || pkg.encoding === "pBEAP" ? pkg.encoding : "unknown", bytesB64: Buffer.from(pkg.packageJson, "utf8").toString("base64"), source: "body" });
        bodyConsumed = true;
      } else if (pkg.ambiguous) {
        ambiguous = true;
      }
    }
  }
  for (const leaf of parsed.leaves) {
    if (!isJsonAttachment(leaf.filename, leaf.contentType)) continue;
    if (leaf.bytes.length === 0) continue;
    const text = leaf.bytes.toString("utf-8");
    if (text.length > MAX_DETECT_CHARS) continue;
    try {
      const obj = JSON.parse(text);
      if (detectBeapInJson(obj)) {
        packages.push({ encodingHint: encodingHintOf(text), bytesB64: Buffer.from(text, "utf8").toString("base64"), source: "json-attachment" });
        consumedLeaves.add(leaf);
      }
    } catch {
    }
  }
  return { packages, ambiguous, consumedLeaves, bodyConsumed };
}
function sealArtifacts(leaves, sandboxPubB64) {
  const artifacts = [];
  for (const leaf of leaves) {
    const enc = encryptForQuarantine(leaf.bytes, sandboxPubB64);
    try {
      leaf.bytes.fill(0);
    } catch {
    }
    if (!enc.ok) {
      throw new DepackageFailure("E_ARTIFACT_CUSTODY_FAILED", `artifact custody failed: ${enc.error}`);
    }
    artifacts.push({ blob_id: (0, import_crypto5.randomUUID)(), content_type: leaf.contentType, filename: leaf.filename, blob: enc.blob });
  }
  return artifacts;
}
function deriveBodyText(parsed, bodyConsumed) {
  if (!bodyConsumed && parsed.plainTextParts.length > 0) return parsed.plainTextParts.join("\n\n");
  if (parsed.htmlParts.length > 0) return htmlToSafeText(parsed.htmlParts.join("\n\n"));
  return "";
}
function buildResultFromParse(parsed, sandboxPubB64) {
  const { packages, ambiguous, consumedLeaves, bodyConsumed } = detectCarrierPackages(parsed);
  if (ambiguous) {
    throw new DepackageFailure("E_AMBIGUOUS_CLASSIFICATION", "ambiguous or partially-matching carrier classification");
  }
  const displayEnvelope = parsed.displayEnvelope;
  const threadingHints = parsed.threadingHints;
  const sealLeaves = parsed.leaves.filter((leaf) => !consumedLeaves.has(leaf));
  const bodyText = deriveBodyText(parsed, bodyConsumed);
  const hasText = bodyText.trim().length > 0;
  if (packages.length === 0) {
    const artifacts2 = sealArtifacts(sealLeaves, sandboxPubB64);
    const safeText = constructSafeText({
      subjectRaw: parsed.subject,
      plainTextBodyRaw: bodyText,
      attachmentBlobIds: artifacts2.map((a) => a.blob_id)
    });
    return { ok: true, type: "plain", safeText, artifacts: artifacts2, displayEnvelope, threadingHints };
  }
  const artifacts = sealArtifacts(sealLeaves, sandboxPubB64);
  if (hasText) {
    const safeText = constructSafeText({
      subjectRaw: parsed.subject,
      plainTextBodyRaw: bodyText,
      attachmentBlobIds: artifacts.map((a) => a.blob_id)
    });
    return { ok: true, type: "mixed", packages, safeText, artifacts, displayEnvelope, threadingHints };
  }
  const carrierSafeText = constructSafeText({
    subjectRaw: parsed.subject,
    plainTextBodyRaw: "",
    attachmentBlobIds: artifacts.map((a) => a.blob_id)
  });
  return { ok: true, type: "beap-carrier", packages, carrierSafeText, artifacts, displayEnvelope, threadingHints };
}
function toFailureResult(err) {
  if (err instanceof DepackageFailure) {
    return { ok: false, code: err.code, message: err.message };
  }
  return { ok: false, code: "E_MALFORMED_MIME", message: err instanceof Error ? err.message : String(err) };
}
function depackageEmail(inputBytes, sandboxPubB64, limits) {
  try {
    return buildResultFromParse(hardenedParse(inputBytes, limits), sandboxPubB64);
  } catch (err) {
    return toFailureResult(err);
  }
}
function depackageEmailStructured(providerJson, sandboxPubB64, opts, limits) {
  try {
    const parsed = walkProviderStructured(providerJson, opts, limits);
    return buildResultFromParse(parsed, sandboxPubB64);
  } catch (err) {
    return toFailureResult(err);
  }
}
function runDepackageEmailJob(input) {
  try {
    const limits = input.maxInputBytes != null ? { maxInputBytes: input.maxInputBytes } : void 0;
    const result = input.inputForm === "provider-structured-json" ? depackageEmailStructured(input.inputBytes, input.sandboxPeerX25519PubB64, { provider: input.provider }, limits) : depackageEmail(input.inputBytes, input.sandboxPeerX25519PubB64, limits);
    const signingPriv = ed25519.utils.randomPrivateKey();
    const sig = signDepackageEmailResult(input.jobId, result, signingPriv);
    signingPriv.fill(0);
    return { jobId: input.jobId, kind: "depackage-email", result, ...sig };
  } catch (err) {
    return {
      jobId: input.jobId,
      kind: "depackage-email",
      result: { ok: false, code: "E_MALFORMED_MIME", message: err instanceof Error ? err.message : String(err) },
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(Buffer.from(c)));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}
async function main() {
  const raw = await readStdin();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    process.stdout.write(
      JSON.stringify({ jobId: "unknown", ok: false, error: `bad job input json: ${String(err)}` })
    );
    process.exitCode = 1;
    return;
  }
  const inputBytes = Buffer.from(parsed.inputBytes_b64 ?? "", "base64");
  if (parsed.kind === "depackage-email") {
    const signed = runDepackageEmailJob({
      jobId: parsed.jobId,
      inputBytes,
      sandboxPeerX25519PubB64: parsed.sandboxPeerX25519PubB64,
      inputForm: parsed.inputForm,
      provider: parsed.provider,
      maxInputBytes: parsed.maxInputBytes
    });
    process.stdout.write(JSON.stringify(signed));
    return;
  }
  const spec = {
    jobId: parsed.jobId,
    kind: "depackage",
    inputBytes,
    sandboxPeerX25519PubB64: parsed.sandboxPeerX25519PubB64
  };
  const result = runDepackagingJob(spec);
  process.stdout.write(JSON.stringify(result));
}
void main();
