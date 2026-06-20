import { mkdir, copyFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rootDir = resolve(__dirname, '..');
const srcDir = resolve(rootDir, 'src');
const outDir = resolve(rootDir, 'wwwroot', 'dist');

async function main() {
  // Ensure output directories exist
  await mkdir(outDir, { recursive: true });

  // --- App stylesheet: src/app.css -> wwwroot/dist/app.css ---
  const srcPath = resolve(srcDir, 'app.css');
  const destPath = resolve(outDir, 'app.css');
  try {
    await copyFile(srcPath, destPath);
  } catch {
    // If src/app.css doesn't exist, skip silently.
  }

  // --- Bootstrap Icons (icon pack) ---
  // Vendored as-is so the CSS's relative `./fonts/...` references resolve.
  // Layout under dist/icons:
  //   bootstrap-icons.css
  //   fonts/bootstrap-icons.woff2
  //   fonts/bootstrap-icons.woff
  const biPkgDir = resolve(rootDir, 'node_modules', 'bootstrap-icons', 'font');
  const iconsDir = resolve(outDir, 'icons');
  const iconsFontsDir = resolve(iconsDir, 'fonts');
  await mkdir(iconsFontsDir, { recursive: true });

  const biAssets = [
    ['bootstrap-icons.css', 'bootstrap-icons.css'],
    ['fonts/bootstrap-icons.woff2', 'fonts/bootstrap-icons.woff2'],
    ['fonts/bootstrap-icons.woff', 'fonts/bootstrap-icons.woff'],
  ];
  for (const [from, to] of biAssets) {
    await copyFile(resolve(biPkgDir, from), resolve(iconsDir, to));
  }
}

main();
