/**
 * Binary trie writer (Expert Fix 4).
 *
 * Emits adblock-trie.bin: a flat little-endian file with header
 *   [0..4)  magic   "FSAB"
 *   [4..8)  format  uint32 = 1
 *   [8..12) crc32   uint32 (over the payload bytes)
 *   [12..16) length  uint32 (payload byte count)
 * followed by a payload of self-describing sections:
 *   - blockedDomains     : string table (sorted, for suffix binary-search)
 *   - allowedDomains     : string table (sorted)
 *   - allowedUrlPrefixes : string table (linear startsWith scan)
 *   - acPatterns         : string table (indexed 0..N-1) — the matched patterns
 *   - acRegexes          : per-pattern regex string tables (empty = always-block)
 *   - acNodes            : Aho-Corasick fail/output/children (children sorted by char)
 *   - cosmetic           : per-domain selector string tables
 *   - blobLen + blob     : UTF-8 bytes referenced by every (offset,length) entry
 *
 * The Kotlin loader (loadBinaryTrie in AdblockEngine) validates
 * magic+format+crc+exact-consumption and otherwise falls back to JSON.
 */

export function crc32(buf: Buffer): number {
  let c = ~0 >>> 0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return ~c >>> 0;
}

interface AcNode {
  children: Map<number, number>;
  fail: number;
  output: string | null;
}

/**
 * Build the Aho-Corasick automaton from the union of blocked URL substrings
 * and regex hint keys — matching the Kotlin AhoCorasick semantics exactly
 * (single output per node = the first-set pattern, propagated from failure
 * links). Returns flat arrays the binary writer serializes directly.
 */
function buildAc(patterns: string[]): {
  nodes: AcNode[];
  outPat: number[];
} {
  const index = new Map<string, number>();
  patterns.forEach((p, i) => {
    if (!index.has(p)) index.set(p, i);
  });
  const nodes: AcNode[] = [{ children: new Map(), fail: 0, output: null }];
  const add = (p: string) => {
    if (!p) return;
    let node = 0;
    for (let k = 0; k < p.length; k++) {
      const code = p.charCodeAt(k);
      const nx = nodes[node].children.get(code);
      if (nx !== undefined) {
        node = nx;
      } else {
        const id = nodes.length;
        nodes.push({ children: new Map(), fail: 0, output: null });
        nodes[node].children.set(code, id);
        node = id;
      }
    }
    if (nodes[node].output === null) nodes[node].output = p;
  };
  for (const p of patterns) add(p);

  const queue: number[] = [];
  for (const [, child] of nodes[0].children) queue.push(child);
  while (queue.length) {
    const v = queue.shift()!;
    for (const [ch, u] of nodes[v].children) {
      let f = nodes[v].fail;
      while (f !== 0 && !nodes[f].children.has(ch)) f = nodes[f].fail;
      const fc = nodes[f].children.get(ch);
      nodes[u].fail = fc !== undefined && fc !== u ? fc : 0;
      if (nodes[nodes[u].fail].output !== null && nodes[u].output === null) {
        nodes[u].output = nodes[nodes[u].fail].output;
      }
      queue.push(u);
    }
  }
  const outPat = nodes.map((n) =>
    n.output !== null ? index.get(n.output)! : -1,
  );
  return { nodes, outPat };
}

export function writeBinaryTrie(
  blockedDomains: Set<string>,
  allowedDomains: Set<string>,
  allowedUrlPrefixes: Set<string>,
  blockedUrlSubstrings: Set<string>,
  regexTriggers: Map<string, Set<string>>,
  cosmeticSelectors: Record<string, string[]>,
): Buffer {
  // 1) Aho-Corasick over (blockedUrlSubstrings ∪ regexHints)
  const regexHints = Array.from(regexTriggers.keys());
  const acPatterns = Array.from(
    new Set([...blockedUrlSubstrings, ...regexHints]),
  );
  const ac = buildAc(acPatterns);
  const acRegexes: string[][] = acPatterns.map((p) => {
    const set = regexTriggers.get(p);
    return set ? Array.from(set) : [];
  });

  // 2) String blob (all referenced strings, UTF-8). Each putStr returns its
  //    (offset, length) within the blob so callers can build offset tables.
  const blobParts: Buffer[] = [];
  let blobLen = 0;
  const putStr = (s: string): [number, number] => {
    const b = Buffer.from(s, "utf-8");
    const off = blobLen;
    blobParts.push(b);
    blobLen += b.length;
    return [off, b.length];
  };
  const putList = (arr: string[]): Array<[number, number]> => arr.map(putStr);

  const bdEntries = putList(Array.from(blockedDomains).sort());
  const adEntries = putList(Array.from(allowedDomains).sort());
  const apEntries = putList(Array.from(allowedUrlPrefixes).sort());
  const acEntries = putList(acPatterns);
  const regexPool = new Map<string, [number, number]>();
  const acRegexEntries: Array<Array<[number, number]>> = acRegexes.map(
    (rlist) => {
      const out: Array<[number, number]> = [];
      for (const r of rlist) {
        let e = regexPool.get(r);
        if (!e) {
          e = putStr(r);
          regexPool.set(r, e);
        }
        out.push(e);
      }
      return out;
    },
  );
  const cosDomEntries: Array<{
    dom: [number, number];
    sels: Array<[number, number]>;
  }> = [];
  for (const domain of Object.keys(cosmeticSelectors).sort()) {
    cosDomEntries.push({
      dom: putStr(domain),
      sels: putList(cosmeticSelectors[domain]),
    });
  }

  // 3) Serialize payload into a growing list of buffers.
  const chunks: Buffer[] = [];
  let len = 0;
  const w32 = (v: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v >>> 0);
    chunks.push(b);
    len += 4;
  };
  const wI32 = (v: number) => {
    const b = Buffer.alloc(4);
    b.writeInt32LE(v | 0);
    chunks.push(b);
    len += 4;
  };
  const w16 = (v: number) => {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(v & 0xffff);
    chunks.push(b);
    len += 2;
  };
  const wStrTable = (ents: Array<[number, number]>) => {
    w32(ents.length);
    for (const [o, l] of ents) {
      w32(o);
      w16(l);
    }
  };

  wStrTable(bdEntries);
  wStrTable(adEntries);
  wStrTable(apEntries);
  wStrTable(acEntries);
  w32(acRegexEntries.length);
  for (const rl of acRegexEntries) {
    w32(rl.length);
    for (const [o, l] of rl) {
      w32(o);
      w16(l);
    }
  }
  w32(ac.nodes.length);
  for (let i = 0; i < ac.nodes.length; i++) {
    const n = ac.nodes[i];
    const kids = Array.from(n.children.entries()).sort((a, b) => a[0] - b[0]);
    w32(n.fail);
    wI32(ac.outPat[i]);
    w32(kids.length);
    for (const [ch, child] of kids) {
      w16(ch);
      w32(child);
    }
  }
  w32(cosDomEntries.length);
  for (const d of cosDomEntries) {
    w32(d.dom[0]);
    w16(d.dom[1]);
    w32(d.sels.length);
    for (const [o, l] of d.sels) {
      w32(o);
      w16(l);
    }
  }
  w32(blobLen);
  for (const b of blobParts) {
    chunks.push(b);
    len += b.length;
  }

  const payload = Buffer.concat(chunks, len);
  const crc = crc32(payload);

  const header = Buffer.alloc(16);
  header.write("FSAB", 0, "ascii");
  header.writeUInt32LE(1, 4);
  header.writeUInt32LE(crc, 8);
  header.writeUInt32LE(payload.length, 12);

  return Buffer.concat([header, payload]);
}
