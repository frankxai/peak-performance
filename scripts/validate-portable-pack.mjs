// Dependency-free structural checks, not vendor schema or security certification.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fs.realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const manifests = ['plugin.json', '.claude-plugin/plugin.json', '.antigravity-plugin/plugin.json']
  .map(file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')));
for (const manifest of manifests) {
  assert.equal(manifest.name, 'peak-performance');
  for (const key of ['version', 'license', 'author']) assert.deepEqual(manifest[key], manifests[0][key]);
  assert.equal(typeof manifest.description, 'string'); assert(manifest.description.trim());
  assert(!manifest.hooks && !manifest.mcpServers && !manifest.apps, 'unexpected active integration');
}
assert.equal(manifests[0].$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
assert.equal(manifests[0].extensions?.['com.openai']?.requires_local_executor, true);
assert(!manifests[0].extensions?.['com.openai']?.hooks && !manifests[0].extensions?.['com.openai']?.apps);
assert.equal(manifests[2].$schema, 'https://antigravity.google/schemas/v1/plugin.json');
for (const file of ['mcp.json', '.mcp.json', '.app.json', 'hooks']) {
  assert(!fs.existsSync(path.join(root, file)), `unexpected autoload surface: ${file}`);
}
const markdown = [];
const dirs = fs.readdirSync(path.join(root, 'skills'), { withFileTypes: true }).filter(d => d.isDirectory());
assert.equal(dirs.length, 2);
for (const dir of dirs) {
  const file = path.join(root, 'skills', dir.name, 'SKILL.md');
  const text = fs.readFileSync(file, 'utf8');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/);
  assert(match, `missing skill metadata/body: ${file}`);
  // These skills deliberately use two unquoted single-line metadata scalars.
  const lines = match[1].split(/\r?\n/);
  assert.equal(lines.length, 2);
  const fields = Object.fromEntries(lines.map(line => {
    const at = line.indexOf(':'); assert(at > 0, 'unsupported metadata syntax');
    return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
  }));
  assert.deepEqual(Object.keys(fields).sort(), ['description', 'name']);
  assert.equal(fields.name, dir.name);
  assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fields.name)); assert(fields.description);
  markdown.push(file);
}
for (const file of fs.readdirSync(path.join(root, 'knowledge'))) {
  if (file.endsWith('.md')) markdown.push(path.join(root, 'knowledge', file));
}
markdown.push(path.join(root, 'docs/PORTABLE-WORKSTATION-PRODUCT.md'));
let links = 0;
for (const file of markdown) {
  for (const match of fs.readFileSync(file, 'utf8').matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const ref = match[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('#')) continue;
    const target = fs.realpathSync(path.resolve(path.dirname(file), decodeURIComponent(ref.split('#')[0])));
    const relative = path.relative(root, target);
    assert(!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`), 'reference escapes package');
    links++;
  }
}
JSON.parse(fs.readFileSync(path.join(root, 'evals/workstation-triage.json'), 'utf8'));
console.log(JSON.stringify({ status: 'baseline-pass', manifests: manifests.length, skills: dirs.length, relativeLinksChecked: links, vendorSchemaValidated: false }));
