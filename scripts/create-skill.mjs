import { mkdir, readFile, stat, writeFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const skillsRoot = join(repoRoot, '.github', 'skills');
const templatePath = join(skillsRoot, '_template', 'SKILL.md.template');

function printUsage() {
  console.log('Usage: npm run skill:new -- <skill-name> [--dry-run] [--force]');
  console.log('Example: npm run skill:new -- chrome-devtools');
}

function slugify(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function titleize(slug) {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');
  const rawName = args.find((arg) => !arg.startsWith('--'));

  if (!rawName) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const slug = slugify(rawName);
  if (!slug) {
    throw new Error('Skill name must contain letters or numbers.');
  }

  const title = titleize(slug);
  const targetDir = join(skillsRoot, slug);
  const targetFile = join(targetDir, 'SKILL.md');

  const template = await readFile(templatePath, 'utf8');
  const rendered = template
    .replaceAll('{{SKILL_TITLE}}', title)
    .replaceAll('{{SKILL_SLUG}}', slug);

  let exists = false;
  try {
    await stat(targetFile);
    exists = true;
  } catch (_) {}

  if (exists && !force) {
    throw new Error(`Skill already exists at ${targetFile}. Use --force to overwrite.`);
  }

  if (dryRun) {
    console.log(`[dry-run] would create ${targetFile}`);
    console.log('');
    console.log(rendered);
    return;
  }

  await mkdir(targetDir, { recursive: true });
  await writeFile(targetFile, rendered, 'utf8');
  console.log(`Created ${targetFile}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
