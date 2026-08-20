import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const binPath = join(__dirname, "..", "build", "adblock-trie.bin");
const bin = readFileSync(binPath);

function readU32(o: number) {
  return bin.readUInt32LE(o);
}
function readI32(o: number) {
  return bin.readInt32LE(o);
}
function readU16(o: number) {
  return bin.readUInt16LE(o);
}

const magic = bin.toString("ascii", 0, 4);
const version = readU32(4);
const crc = readU32(8);
const payloadLen = readU32(12);
console.log(
  "magic",
  magic,
  "version",
  version,
  "crc",
  crc,
  "payloadLen",
  payloadLen,
);

let pos = 16;
const pget = {
  u32: () => {
    const v = readU32(pos);
    pos += 4;
    return v;
  },
  i32: () => {
    const v = readI32(pos);
    pos += 4;
    return v;
  },
  u16: () => {
    const v = readU16(pos);
    pos += 2;
    return v;
  },
};
function readTable(): Array<[number, number]> {
  const n = pget.u32();
  const out: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) out.push([pget.u32(), pget.u16()]);
  return out;
}
const bdT = readTable();
const adT = readTable();
const apT = readTable();
const acT = readTable();
const rxN = pget.u32();
for (let i = 0; i < rxN; i++) {
  const rc = pget.u32();
  for (let j = 0; j < rc; j++) {
    pget.u32();
    pget.u16();
  }
}
const nodeCount = pget.u32();
const failArr: number[] = [];
const outArr: number[] = [];
const childStart: number[] = [];
const childCount: number[] = [];
const childChars: number[] = [];
const childNodes: number[] = [];
for (let i = 0; i < nodeCount; i++) {
  failArr.push(pget.u32());
  outArr.push(pget.i32());
  const cc = pget.u32();
  childStart.push(childChars.length);
  childCount.push(cc);
  for (let k = 0; k < cc; k++) {
    childChars.push(pget.u16());
    childNodes.push(pget.u32());
  }
}
const cosN = pget.u32();
for (let d = 0; d < cosN; d++) {
  pget.u32();
  pget.u16();
  const sc = pget.u32();
  for (let s = 0; s < sc; s++) {
    pget.u32();
    pget.u16();
  }
}
const blobLen = pget.u32();
const blob = bin.subarray(pos, pos + blobLen);
console.log(
  "nodes",
  nodeCount,
  "blobLen",
  blobLen,
  "pos now",
  pos,
  "consume",
  pos + blobLen,
  "total",
  bin.length,
);

// detect self-fail cycles
let selfFails = 0;
for (let i = 0; i < nodeCount; i++)
  if (failArr[i] === i && i !== 0) selfFails++;
console.log("self-fail (non-root) count:", selfFails);

const getStr = (o: number, l: number) => blob.toString("utf-8", o, o + l);
const ac = acT.map(([o, l]) => getStr(o, l));

function binFindFirst(text: string): string | null {
  let node = 0;
  let bg = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    while (node !== 0) {
      if (++bg > 500000) {
        console.log("BINFIND HANG at", i, "node", node);
        return null;
      }
      const start = childStart[node];
      const cnt = childCount[node];
      let lo = start,
        hi = start + cnt - 1,
        found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const mc = childChars[mid];
        if (mc < c) lo = mid + 1;
        else if (mc > c) hi = mid - 1;
        else {
          found = childNodes[mid];
          break;
        }
      }
      if (found !== -1) break;
      node = failArr[node];
    }
    const fc = childStart[node];
    const ccnt = childCount[node];
    let nxt = 0;
    for (let k = fc; k < fc + ccnt; k++) {
      if (childChars[k] === c) {
        nxt = childNodes[k];
        break;
      }
    }
    node = nxt;
    if (outArr[node] >= 0) return ac[outArr[node]];
  }
  return null;
}

const url = ".alcmpn.com/";
console.log("calling binFindFirst on:", JSON.stringify(url));
const r = binFindFirst(url);
console.log("result:", r);
