import { mkdir, copyFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rootDir = resolve(__dirname, '..');
const srcDir = resolve(rootDir, 'src');
const outDir = resolve(rootDir, 'wwwroot', 'dist');

async function main() {
  // Ensure output directory exists
  await mkdir(outDir, { recursive: true });

  const srcPath = resolve(srcDir, 'app.css');
  const destPath = resolve(outDir, 'app.css');

  try {
    await copyFile(srcPath, destPath);
  } catch {
    // If src/app.css doesn't exist, exit 0 silently
    process.exit(0);
  }
}

main();
