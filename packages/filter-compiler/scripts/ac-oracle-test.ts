import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const jsonPath = join(
  __dirname,
  "..",
  "build",
  "android-adblock-patterns.json",
);
const src = JSON.parse(readFileSync(jsonPath, "utf8"));
const net = src.network;
const blockedUrlSubstrings = new Set<string>(net.blockedUrlSubstrings);
const regexTriggers = new Map<string, Set<string>>();
for (const [k, v] of Object.entries<any>(net.regexTriggers))
  regexTriggers.set(k, new Set<string>(v));
const allPatterns = [...blockedUrlSubstrings, ...regexTriggers.keys()];

type N = {
  children: Record<number, number>;
  fail: number;
  out: string | null;
  depth: number;
};
const nodes: N[] = [{ children: {}, fail: 0, out: null, depth: 0 }];
const depth = (n: number) => nodes[n].depth;
const idx = new Map<string, number>();
allPatterns.forEach((p, i) => {
  if (!idx.has(p)) idx.set(p, i);
});
for (const p of allPatterns) {
  let node = 0;
  for (let k = 0; k < p.length; k++) {
    const code = p.charCodeAt(k);
    if (nodes[node].children[code] === undefined) {
      nodes[node].children[code] = nodes.length;
      nodes.push({ children: {}, fail: 0, out: null, depth: depth(node) + 1 });
    }
    node = nodes[node].children[code];
  }
  if (nodes[node].out === null) nodes[node].out = p;
}
const q: number[] = [];
for (const ch in nodes[0].children) q.push(nodes[0].children[+ch]);
let guard = 0;
while (q.length) {
  if (++guard > 2000000) {
    console.log("BUILD guard hit");
    process.exit(1);
  }
  const v = q.shift()!;
  for (const ch in nodes[v].children) {
    const c = +ch;
    const u = nodes[v].children[c];
    let f = nodes[v].fail;
    let ig = 0;
    while (f !== 0 && nodes[f].children[c] === undefined) {
      if (++ig > 100000) {
        console.log("INNER HANG v=", v, "c=", c);
        process.exit(1);
      }
      f = nodes[f].fail;
    }
    const fc = nodes[f].children[c];
    nodes[u].fail = fc !== undefined && fc !== u ? fc : 0;
    q.push(u);
  }
}
console.log("BUILD OK nodes=", nodes.length);

// findFirst with guard
function findFirst(text: string): string | null {
  let node = 0;
  let fg = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    while (node !== 0) {
      if (++fg > 1000000) {
        console.log("FIND HANG at", i);
        process.exit(1);
      }
      if (nodes[node].children[c] === undefined) node = nodes[node].fail;
      else break;
    }
    if (nodes[node].children[c] === undefined) node = 0;
    else node = nodes[node].children[c];
    if (nodes[node].out !== null) return nodes[node].out;
  }
  return null;
}

let count = 0;
const probe = new Set<string>();
for (const p of allPatterns) {
  probe.add(p);
  probe.add("https://" + p + ".example.com/x");
  probe.add("https://example.com/" + p);
}
for (const url of probe) {
  findFirst(url);
  if (++count % 1000 === 0) console.log("probed", count);
}
console.log("PROBE OK total=", probe.size);
