// Test-only runner for source units when Vite's esbuild pipe is unavailable.
// Uses Node's TypeScript transformer; does not build or emulate Electron.
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const aliases = { '@main/': 'src/main/', '@shared/': 'src/shared/', '@features/': 'src/features/' };
registerHooks({
  resolve(specifier, context, next) {
    let base;
    const alias = Object.keys(aliases).find((prefix) => specifier.startsWith(prefix));
    if (alias) base = resolve(root, aliases[alias], specifier.slice(alias.length));
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      base = resolve(dirname(fileURLToPath(context.parentURL)), specifier);
    }
    if (base && !extname(base)) {
      for (const name of [`${base}.ts`, resolve(base, 'index.ts')]) {
        if (existsSync(name)) return next(pathToFileURL(name).href, context);
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith(pathToFileURL(root).href) && url.endsWith('.ts')) {
      return { format: 'module', shortCircuit: true, source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform', sourceUrl: url }) };
    }
    return next(url, context);
  },
});
