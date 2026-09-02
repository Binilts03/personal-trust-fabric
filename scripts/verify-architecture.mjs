import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative, resolve, sep } from 'node:path';

const SCENARIO_TERMS = /(airline|flight|hotel|booking|shopping[\s_-]*cart|product[\s_-]*catalog|merchant[\s_-]*sku|age[\s_-]*proof)/i;
const WEB_ADAPTER_USAGE = /document\.modelContext|registerTool\s*\(|from\s+['"]node:http['"]/;
const IMPORTS = /(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"](?<path>\.[^'"]+)['"]/g;

async function listJavaScriptFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listJavaScriptFiles(path)));
    else if (entry.isFile() && /\.[cm]?js$/.test(entry.name)) files.push(path);
  }
  return files;
}

export async function scanArchitecture(root) {
  const coreRoot = join(root, 'src', 'core');
  let files;
  try {
    files = await listJavaScriptFiles(coreRoot);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const violations = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const displayPath = relative(root, file).split(sep).join('/');
    if (SCENARIO_TERMS.test(source)) violations.push(`${displayPath}: scenario vocabulary in trust core`);
    if (WEB_ADAPTER_USAGE.test(source)) violations.push(`${displayPath}: WebMCP/DOM/HTTP adapter usage in trust core`);

    for (const match of source.matchAll(IMPORTS)) {
      const imported = resolve(file, '..', match.groups.path).split(sep).join('/');
      if (/\/src\/(adapters|ui|web)\//.test(imported) || /\/public\//.test(imported)) {
        violations.push(`${displayPath}: trust core imports adapter/UI path ${match.groups.path}`);
      }
    }
  }
  return violations;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = await scanArchitecture(process.cwd());
  if (violations.length > 0) {
    console.error(violations.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('Architecture verification passed.');
  }
}
