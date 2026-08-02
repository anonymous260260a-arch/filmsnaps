/**
 * Fix extensionless relative imports in the emitted dist for native Node ESM.
 *
 * tsc compiles the source's extensionless specifiers (e.g. `from './providers/registry'`)
 * verbatim into dist. Bundlers tolerate that, but Node's native ESM loader requires
 * explicit file extensions — so any runtime `await import('@filmsnaps/shared')` fails
 * with ERR_MODULE_NOT_FOUND. This postbuild rewrites every relative import in dist/*.js
 * (not type-only ones in .d.ts, which Node ignores) to carry the `.js` extension.
 *
 * Safe: the rewritten specifier points at a real emitted file, and bundler consumers
 * resolve it identically either way.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));

// Rewrites ONLY bare relative specifiers (./x or ../x). Bare package specifiers
// ('@filmsnaps/shared', 'clsx', …) and absolute-ish URLs are left untouched.
function withJsExtension(spec, fromDir) {
  if (!spec.startsWith('.')) return spec;
  // Already has an extension ('.js', '.json', '.css', …) — leave alone.
  if (extname(spec)) return spec;

  const base = join(fromDir, spec);

  // 1) The specifier refers to a FILE whose extension was omitted:
  //    './providers/registry' → './providers/registry.js'
  if (isFile(`${base}.js`)) return `${spec}.js`;

  // 2) The specifier refers to a DIRECTORY with an index.js:
  //    './utils' → './utils/index.js'
  if (isFile(join(base, 'index.js'))) {
    const rel = relative(fromDir, join(base, 'index.js')).replace(/\\/g, '/');
    return `./${rel}`;
  }

  // Nothing resolvable — return the specifier unchanged (will error loudly, which is
  // better than silently mangling it).
  return spec;
}

function isFile(p) {
  try {
    return readFileSync(p) !== undefined;
  } catch {
    return false;
  }
}

let changed = 0;

function walk(dir) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) {
      walk(full);
      continue;
    }
    if (name.isFile() && name.name.endsWith('.js')) {
      const src = readFileSync(full, 'utf8');
      const fromDir = dirname(full);

      // Rewrite `from './x'` / `import './x'` / `export * from './x'` and dynamic
      // import('...') inside template/regular strings. A per-specifier regex is enough
      // for this codebase's emitted shape.
      const out = src.replace(
        /(from\s+['"])(\.[^'"]+)(['"])|(import\s*\(\s*['"])(\.[^'"]+)(['"])/g,
        (match, fromPre, fromSpec, fromQuote, dynPre, dynSpec, dynQuote) => {
          if (fromSpec !== undefined) {
            const fixed = withJsExtension(fromSpec, fromDir);
            return fixed === fromSpec ? match : `${fromPre}${fixed}${fromQuote}`;
          }
          const fixed = withJsExtension(dynSpec, fromDir);
          return fixed === dynSpec ? match : `${dynPre}${fixed}${dynQuote}`;
        },
      );

      if (out !== src) {
        writeFileSync(full, out);
        changed++;
      }
    }
  }
}

walk(DIST);
console.log(`[shared:fix-dist] Rewrote relative imports in ${changed} dist file(s)`);
if (changed === 0) console.log('[shared:fix-dist] No extensionless relative imports found — dist already clean.');
