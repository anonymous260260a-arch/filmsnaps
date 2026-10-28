import fs from 'node:fs';

const path = 'patches/expo-video@55.0.18.patch';
const s = fs.readFileSync(path, 'utf8');
const lines = s.split('\n');
if (lines.length && lines[lines.length - 1] === '') lines.pop();
const crlf = lines.filter((l) => l.endsWith('\r')).length;
console.log(`file lines=${lines.length} crlf=${crlf} bare-lf=${lines.length - crlf}`);

let cur = null;
const sections = [];
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (l.startsWith('diff --git ')) {
    cur = { name: l.trim(), start: i + 1, lines: [] };
    sections.push(cur);
    continue;
  }
  if (cur) cur.lines.push(l);
}

let bad = 0;
function checkHunk(sec, hi) {
  if (hi.bodyOld === hi.oldCount && hi.bodyNew === hi.newCount && hi.anomalies.length === 0) return;
  bad++;
  console.log(`MISMATCH (patch line ~${sec.start}): ${sec.name}`);
  console.log(`  header: ${hi.headerLine}`);
  console.log(`  actual: old=${hi.bodyOld} (header ${hi.oldCount}), new=${hi.bodyNew} (header ${hi.newCount})`);
  for (const a of hi.anomalies.slice(0, 5)) console.log(`  anomaly: ${a}`);
}

for (const sec of sections) {
  let hi = null;
  for (let i = 0; i < sec.lines.length; i++) {
    const raw = sec.lines[i];
    const l = raw.replace(/\r$/, '');
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(l);
    if (m) {
      if (hi) checkHunk(sec, hi);
      hi = {
        headerLine: l,
        oldCount: m[2] === undefined ? 1 : +m[2],
        newCount: m[4] === undefined ? 1 : +m[4],
        bodyOld: 0,
        bodyNew: 0,
        anomalies: [],
      };
      continue;
    }
    if (!hi) continue;
    if (l.startsWith('\\')) continue;
    if (l === '') {
      hi.anomalies.push(`empty line at body offset ${i}`);
      hi.bodyOld++;
      hi.bodyNew++;
      continue;
    }
    if (l.startsWith(' ')) { hi.bodyOld++; hi.bodyNew++; }
    else if (l.startsWith('-')) hi.bodyOld++;
    else if (l.startsWith('+')) hi.bodyNew++;
    else hi.anomalies.push(`unexpected line: ${JSON.stringify(raw.slice(0, 60))}`);
  }
  if (hi) checkHunk(sec, hi);
}

console.log(bad === 0 ? 'ALL HUNKS OK' : `${bad} bad hunk(s)`);
process.exit(bad === 0 ? 0 : 1);
