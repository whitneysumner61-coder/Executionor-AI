import { readdir, stat } from 'fs/promises';
import { join, normalize, relative, resolve } from 'path';
import { spawn } from 'child_process';

import { WORKSPACE_ROOT } from './local-agent.js';

const WORKSPACE_ROOT_ABS = normalize(resolve(WORKSPACE_ROOT));
const COMPOSE_FILENAMES = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];

function isInsideWorkspace(candidatePath) {
  const rel = relative(WORKSPACE_ROOT_ABS, candidatePath);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('../'));
}

function makeStackId(relativeDir) {
  return String(relativeDir || '.')
    .replace(/[\\/]+/g, '__')
    .replace(/[^a-zA-Z0-9_.-]/g, '-')
    .replace(/^-+|-+$/g, '') || 'workspace-root';
}

function runCommand(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: options.cwd || WORKSPACE_ROOT_ABS,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', rejectRun);
    child.on('close', (code) => {
      if (code !== 0) {
        rejectRun(new Error((stderr || stdout || `${command} exited with code ${code}`).trim()));
        return;
      }
      resolveRun({ stdout, stderr, code });
    });
  });
}

export async function getComposeRuntime() {
  try {
    const result = await runCommand('docker', ['compose', 'version']);
    return { available: true, version: result.stdout.trim() };
  } catch (error) {
    return { available: false, version: '', error: error.message };
  }
}

async function detectComposeFile(dir) {
  for (const name of COMPOSE_FILENAMES) {
    const fullPath = join(dir, name);
    try {
      const details = await stat(fullPath);
      if (details.isFile()) return fullPath;
    } catch (_) {}
  }
  return null;
}

async function walkForStacks(dir, depth = 0, found = []) {
  if (depth > 4) return found;

  const composeFile = await detectComposeFile(dir);
  if (composeFile) {
    found.push({ projectDir: dir, composeFile });
    return found;
  }

  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (_) {
    return found;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (['.git', 'node_modules', 'sessions'].includes(entry.name)) continue;
    await walkForStacks(join(dir, entry.name), depth + 1, found);
  }

  return found;
}

async function getComposeServices(projectDir, composeFile) {
  try {
    const result = await runCommand('docker', ['compose', '-f', composeFile, 'config', '--services'], { cwd: projectDir });
    return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  } catch (_) {
    return [];
  }
}

async function getComposePs(projectDir, composeFile) {
  try {
    const result = await runCommand('docker', ['compose', '-f', composeFile, 'ps', '--format', 'json'], { cwd: projectDir });
    return result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}

function summarizeStatus(containers = []) {
  if (!containers.length) return 'idle';
  if (containers.some((container) => /running/i.test(container.State || ''))) return 'running';
  return 'stopped';
}

export async function listComposeStacks() {
  const runtime = await getComposeRuntime();
  const discovered = await walkForStacks(WORKSPACE_ROOT_ABS);

  const stacks = await Promise.all(discovered.map(async ({ projectDir, composeFile }) => {
    const relDir = relative(WORKSPACE_ROOT_ABS, projectDir) || '.';
    const services = await getComposeServices(projectDir, composeFile);
    const containers = runtime.available ? await getComposePs(projectDir, composeFile) : [];
    return {
      id: makeStackId(relDir),
      name: relDir === '.' ? 'workspace-root' : relDir.split(/[\\/]/).pop(),
      projectDir,
      relativeDir: relDir,
      composeFile,
      services,
      containers,
      status: summarizeStatus(containers)
    };
  }));

  return stacks.sort((a, b) => a.relativeDir.localeCompare(b.relativeDir));
}

async function resolveStack(stackId) {
  const stacks = await listComposeStacks();
  const stack = stacks.find((entry) => entry.id === stackId);
  if (!stack) throw new Error('Compose stack not found');
  if (!isInsideWorkspace(stack.projectDir)) throw new Error('Compose stack escapes workspace root');
  return stack;
}

export async function inspectComposeStack(stackId) {
  return resolveStack(stackId);
}

export async function runComposeStackAction(stackId, action, options = {}) {
  const stack = await resolveStack(stackId);
  const baseArgs = ['compose', '-f', stack.composeFile];

  if (action === 'up') {
    const args = [...baseArgs, 'up', '-d'];
    if (options.build !== false) args.push('--build');
    const result = await runCommand('docker', args, { cwd: stack.projectDir });
    return { action, stackId, output: result.stdout.trim() || 'Stack started.' };
  }

  if (action === 'down') {
    const result = await runCommand('docker', [...baseArgs, 'down'], { cwd: stack.projectDir });
    return { action, stackId, output: result.stdout.trim() || 'Stack stopped.' };
  }

  if (action === 'config') {
    const result = await runCommand('docker', [...baseArgs, 'config'], { cwd: stack.projectDir });
    return { action, stackId, output: result.stdout.trim() };
  }

  if (action === 'logs') {
    const tail = Number.isFinite(Number(options.tail)) ? String(Number(options.tail)) : '80';
    const args = [...baseArgs, 'logs', '--no-color', '--tail', tail];
    if (options.service) args.push(String(options.service));
    const result = await runCommand('docker', args, { cwd: stack.projectDir });
    return { action, stackId, output: result.stdout.trim() };
  }

  throw new Error(`Unsupported compose action: ${action}`);
}

export async function runComposeAction(parsed) {
  const stacks = await listComposeStacks();
  if (!stacks.length) throw new Error('No compose stacks were found in the workspace.');

  if (parsed.action === 'list') {
    return {
      action: parsed.action,
      stacks: stacks.map((stack) => ({
        id: stack.id,
        name: stack.name,
        relativeDir: stack.relativeDir,
        status: stack.status,
        services: stack.services
      }))
    };
  }

  const target = parsed.stack
    ? stacks.find((stack) =>
        stack.id === parsed.stack
        || stack.name === parsed.stack
        || stack.relativeDir === parsed.stack
        || stack.relativeDir.includes(parsed.stack))
    : (stacks.length === 1 ? stacks[0] : null);

  if (!target) {
    throw new Error(parsed.stack
      ? `Compose stack "${parsed.stack}" was not found in the workspace.`
      : 'Multiple compose stacks were found. Specify which stack to target.');
  }

  if (parsed.action === 'status') {
    return inspectComposeStack(target.id);
  }

  return runComposeStackAction(target.id, parsed.action, parsed);
}
