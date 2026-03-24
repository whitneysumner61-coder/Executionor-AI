import { mkdir, readFile, readdir, rm, stat, writeFile, rename } from 'fs/promises';
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

import { dispatchLocalAgent, WORKSPACE_ROOT } from './local-agent.js';
import { runPSSync } from '../routes/ps.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = join(__dirname, '..', 'sessions');
const STATE_PATH = join(STATE_DIR, 'ops-control.json');
const WORKSPACE_ROOT_ABS = normalize(resolve(WORKSPACE_ROOT));
let stateMutationQueue = Promise.resolve();

function now() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createBuiltinRunbooks() {
  const createdAt = now();
  return [
    {
      id: 'runbook_workspace_inventory',
      title: 'Workspace inventory',
      summary: 'Capture the current workspace top-level inventory so operators can orient quickly before making changes.',
      command: 'list files in the workspace root',
      targetAgent: 'PHANTOM',
      requiresApproval: false,
      tags: ['workspace', 'inventory'],
      builtin: true,
      createdBy: 'system',
      createdAt,
      updatedAt: createdAt,
      lastUsedAt: null,
      previewType: 'fs',
      risk: 'low'
    },
    {
      id: 'runbook_host_runtime_snapshot',
      title: 'Host runtime snapshot',
      summary: 'Collect CPU, memory, and disk information from the current host before troubleshooting or deployments.',
      command: 'cpu memory disk usage',
      targetAgent: 'SHELL',
      requiresApproval: false,
      tags: ['runtime', 'health'],
      builtin: true,
      createdBy: 'system',
      createdAt,
      updatedAt: createdAt,
      lastUsedAt: null,
      previewType: 'ps',
      risk: 'critical'
    },
    {
      id: 'runbook_openclaw_status',
      title: 'OpenClaw bridge status',
      summary: 'Check whether the OpenClaw relay and bridge are reachable before dispatching remote workflow commands.',
      command: 'status openclaw',
      targetAgent: 'CLAW',
      requiresApproval: false,
      tags: ['openclaw', 'bridge'],
      builtin: true,
      createdBy: 'system',
      createdAt,
      updatedAt: createdAt,
      lastUsedAt: null,
      previewType: 'claw',
      risk: 'low'
    },
    {
      id: 'runbook_database_schema_snapshot',
      title: 'Database schema snapshot',
      summary: 'Review the public database schema quickly before writing new SQL or changing data flows.',
      command: "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name LIMIT 25",
      targetAgent: 'HYDRA',
      requiresApproval: true,
      tags: ['database', 'schema'],
      builtin: true,
      createdBy: 'system',
      createdAt,
      updatedAt: createdAt,
      lastUsedAt: null,
      previewType: 'sql',
      risk: 'medium'
    }
  ];
}

function createDefaultState() {
  return {
    tasks: [],
    audit: [],
    runbooks: createBuiltinRunbooks(),
    policies: createDefaultPolicies(),
    updatedAt: null
  };
}

function createDefaultPolicies() {
  return {
    profile: 'balanced',
    allowCustomRunbooks: true,
    allowRunbookDeletion: true,
    requireApprovalForTypes: ['ps', 'sql', 'code'],
    blockedTaskTypes: [],
    blockedFsOperations: [],
    blockedClawActions: [],
    notes: 'Require review for shell, SQL, and code tasks. Use blocked lists only for actions you never want queued from the dashboard.'
  };
}

function sortRunbooks(runbooks) {
  return [...runbooks].sort((a, b) => {
    if (Boolean(a.builtin) !== Boolean(b.builtin)) return a.builtin ? -1 : 1;
    const aTime = a.updatedAt || a.createdAt || '';
    const bTime = b.updatedAt || b.createdAt || '';
    return aTime < bTime ? 1 : -1;
  });
}

function normalizeTags(tags) {
  const raw = Array.isArray(tags)
    ? tags
    : String(tags || '').split(',');
  return [...new Set(raw
    .map((tag) => String(tag || '').trim())
    .filter(Boolean)
    .slice(0, 8))];
}

function mergeRunbooks(savedRunbooks = []) {
  const builtins = createBuiltinRunbooks();
  const byId = new Map();

  builtins.forEach((runbook) => byId.set(runbook.id, runbook));
  (Array.isArray(savedRunbooks) ? savedRunbooks : []).forEach((runbook) => {
    if (!runbook?.id) return;
    byId.set(runbook.id, {
      ...runbook,
      tags: normalizeTags(runbook.tags),
      builtin: Boolean(runbook.builtin)
    });
  });

  return sortRunbooks([...byId.values()]);
}

function normalizeStringList(values, allowed = null) {
  const raw = Array.isArray(values) ? values : String(values || '').split(',');
  const normalized = [...new Set(raw
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean))];
  return allowed ? normalized.filter((value) => allowed.includes(value)) : normalized;
}

function mergePolicies(savedPolicies = {}) {
  const defaults = createDefaultPolicies();
  const taskTypes = ['ps', 'fs', 'sql', 'claw', 'code'];
  const fsOperations = ['list', 'read', 'find', 'mkdir', 'write', 'rename', 'delete'];
  const clawActions = ['status', 'list_channels', 'list_agents', 'send_message'];
  const hasApprovalOverride = Object.prototype.hasOwnProperty.call(savedPolicies, 'requireApprovalForTypes');

  return {
    profile: String(savedPolicies.profile || defaults.profile),
    allowCustomRunbooks: typeof savedPolicies.allowCustomRunbooks === 'boolean'
      ? savedPolicies.allowCustomRunbooks
      : defaults.allowCustomRunbooks,
    allowRunbookDeletion: typeof savedPolicies.allowRunbookDeletion === 'boolean'
      ? savedPolicies.allowRunbookDeletion
      : defaults.allowRunbookDeletion,
    requireApprovalForTypes: hasApprovalOverride
      ? normalizeStringList(savedPolicies.requireApprovalForTypes, taskTypes)
      : defaults.requireApprovalForTypes,
    blockedTaskTypes: normalizeStringList(savedPolicies.blockedTaskTypes, taskTypes),
    blockedFsOperations: normalizeStringList(savedPolicies.blockedFsOperations, fsOperations),
    blockedClawActions: normalizeStringList(savedPolicies.blockedClawActions, clawActions),
    notes: String(savedPolicies.notes || defaults.notes).trim().slice(0, 500) || defaults.notes
  };
}

function normalizeTaskStatus(status) {
  return ['draft', 'pending_approval', 'approved', 'rejected', 'running', 'completed', 'failed'].includes(status)
    ? status
    : 'draft';
}

async function ensureStateFile() {
  await mkdir(STATE_DIR, { recursive: true });
  try {
    await stat(STATE_PATH);
  } catch (_) {
    await writeFile(STATE_PATH, JSON.stringify(createDefaultState(), null, 2), 'utf8');
  }
}

async function readState() {
  await ensureStateFile();
  try {
    const raw = await readFile(STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      audit: Array.isArray(parsed.audit) ? parsed.audit : [],
      runbooks: mergeRunbooks(parsed.runbooks),
      policies: mergePolicies(parsed.policies),
      updatedAt: parsed.updatedAt || null
    };
  } catch (_) {
    return createDefaultState();
  }
}

async function writeState(state) {
  const payload = { ...state, updatedAt: now() };
  await writeFile(STATE_PATH, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

async function mutateState(mutator) {
  const runMutation = async () => {
    const state = await readState();
    const next = await mutator(state);
    return writeState(next || state);
  };

  const nextMutation = stateMutationQueue.then(runMutation, runMutation);
  stateMutationQueue = nextMutation.catch(() => {});
  return nextMutation;
}

function addAuditEvent(state, type, detail) {
  state.audit.unshift({
    id: makeId('audit'),
    type,
    detail,
    createdAt: now()
  });
  if (state.audit.length > 250) state.audit.length = 250;
}

function summarizeAction(parsed) {
  if (!parsed) return 'No parsed action available yet.';
  if (parsed.type === 'ps') return `PowerShell: ${parsed.command}`;
  if (parsed.type === 'fs') return `Filesystem ${parsed.operation}: ${parsed.path || ''}`.trim();
  if (parsed.type === 'sql') return `SQL: ${parsed.query}`;
  if (parsed.type === 'claw') return `OpenClaw ${parsed.action}`;
  if (parsed.type === 'code') return `Generate ${parsed.filename}`;
  return JSON.stringify(parsed);
}

function classifyRisk(parsed) {
  if (!parsed) return 'medium';

  if (parsed.type === 'ps') return 'critical';

  if (parsed.type === 'fs') {
    if (['list', 'read', 'find'].includes(parsed.operation)) return 'low';
    if (['mkdir', 'write', 'rename'].includes(parsed.operation)) return 'medium';
    if (parsed.operation === 'delete') return 'high';
    return 'medium';
  }

  if (parsed.type === 'sql') {
    return /^\s*(select|with)\b/i.test(parsed.query || '') ? 'medium' : 'high';
  }

  if (parsed.type === 'claw') {
    return ['status', 'list_channels', 'list_agents'].includes(parsed.action) ? 'low' : 'medium';
  }

  if (parsed.type === 'code') return 'medium';
  return 'medium';
}

function defaultApprovalRequired(parsed) {
  return classifyRisk(parsed) !== 'low';
}

function evaluatePolicies(parsed, policies) {
  if (!parsed) {
    return { requiresApproval: false };
  }

  if (policies.blockedTaskTypes.includes(parsed.type)) {
    throw new Error(`Policy blocks ${parsed.type.toUpperCase()} tasks from being queued or run.`);
  }

  if (parsed.type === 'fs' && policies.blockedFsOperations.includes(parsed.operation)) {
    throw new Error(`Policy blocks filesystem operation: ${parsed.operation}.`);
  }

  if (parsed.type === 'claw' && policies.blockedClawActions.includes(parsed.action)) {
    throw new Error(`Policy blocks OpenClaw action: ${parsed.action}.`);
  }

  return {
    requiresApproval: defaultApprovalRequired(parsed) || policies.requireApprovalForTypes.includes(parsed.type)
  };
}

function sortTasks(tasks) {
  return [...tasks].sort((a, b) => {
    const aTime = a.updatedAt || a.createdAt || '';
    const bTime = b.updatedAt || b.createdAt || '';
    return aTime < bTime ? 1 : -1;
  });
}

function taskCounts(tasks) {
  return tasks.reduce((acc, task) => {
    const key = normalizeTaskStatus(task.status);
    acc[key] = (acc[key] || 0) + 1;
    acc.total += 1;
    return acc;
  }, { total: 0, draft: 0, pending_approval: 0, approved: 0, rejected: 0, running: 0, completed: 0, failed: 0 });
}

function safeTitle(input = '') {
  const title = String(input || '').trim();
  return title || 'Untitled ops task';
}

function isInsideWorkspace(candidatePath) {
  const rel = relative(WORKSPACE_ROOT_ABS, candidatePath);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function resolveWorkspacePath(targetPath) {
  const resolved = normalize(resolve(WORKSPACE_ROOT_ABS, targetPath || '.'));
  if (!isInsideWorkspace(resolved)) {
    throw new Error(`Path escapes workspace root: ${targetPath}`);
  }
  return resolved;
}

function isExecutableTask(task) {
  return Boolean(task?.parsed);
}

async function searchNames(basePath, query) {
  const results = [];
  const lower = String(query || '').toLowerCase();

  async function walk(dir, depth = 0) {
    if (depth > 4 || results.length >= 50) return;
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }

    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const fullPath = join(dir, entry.name);
      if (entry.name.toLowerCase().includes(lower)) results.push(fullPath);
      if (entry.isDirectory()) await walk(fullPath, depth + 1);
      if (results.length >= 50) return;
    }
  }

  await walk(basePath);
  return results;
}

async function executeFsAction(parsed) {
  const targetPath = resolveWorkspacePath(parsed.path);

  if (parsed.operation === 'list') {
    const entries = await readdir(targetPath, { withFileTypes: true });
    return {
      operation: parsed.operation,
      path: targetPath,
      entries: entries.slice(0, 100).map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? 'dir' : 'file'
      }))
    };
  }

  if (parsed.operation === 'read') {
    const content = await readFile(targetPath, 'utf8');
    return {
      operation: parsed.operation,
      path: targetPath,
      bytes: Buffer.byteLength(content, 'utf8'),
      contentPreview: content.slice(0, 4000)
    };
  }

  if (parsed.operation === 'find') {
    return {
      operation: parsed.operation,
      path: targetPath,
      matches: await searchNames(targetPath, parsed.query || '')
    };
  }

  if (parsed.operation === 'mkdir') {
    await mkdir(targetPath, { recursive: true });
    return { operation: parsed.operation, path: targetPath, created: true };
  }

  if (parsed.operation === 'write') {
    await mkdir(dirname(targetPath), { recursive: true });
    const content = parsed.content ?? '';
    await writeFile(targetPath, content, 'utf8');
    return { operation: parsed.operation, path: targetPath, bytes: Buffer.byteLength(content, 'utf8') };
  }

  if (parsed.operation === 'rename') {
    const nextName = basename(String(parsed.newName || '').trim());
    if (!nextName) throw new Error('Rename operation requires a valid destination name');
    const nextPath = resolveWorkspacePath(join(dirname(targetPath), nextName));
    await rename(targetPath, nextPath);
    return { operation: parsed.operation, oldPath: targetPath, newPath: nextPath };
  }

  if (parsed.operation === 'delete') {
    await rm(targetPath, { recursive: true, force: false });
    return { operation: parsed.operation, path: targetPath, deleted: true };
  }

  throw new Error(`Unsupported filesystem operation: ${parsed.operation}`);
}

async function runRawSQL(query) {
  const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('SUPABASE_DB_URL or DATABASE_URL is required to run SQL tasks');
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const result = await client.query(query);
    return {
      rowCount: result.rowCount ?? result.rows.length,
      rows: result.rows.slice(0, 50),
      fields: result.fields?.map((field) => field.name) ?? []
    };
  } finally {
    await client.end();
  }
}

async function clawFetch(url, opts = {}) {
  const token = process.env.OPENCLAW_GATEWAY_TOKEN || '';
  const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const response = await fetch(url, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  const text = await response.text();
  let data = text;
  try {
    data = JSON.parse(text);
  } catch (_) {}
  return { ok: response.ok, status: response.status, data };
}

async function executeClawAction(parsed) {
  const relayUrl = process.env.OPENCLAW_RELAY_URL || 'http://localhost:4588';
  const bridgeUrl = process.env.OPENCLAW_BRIDGE_URL || 'http://localhost:3004';

  if (parsed.action === 'status') {
    const [relay, bridge] = await Promise.all([
      clawFetch(`${relayUrl}/`).catch(() => ({ ok: false, status: 0, data: null })),
      clawFetch(`${bridgeUrl}/health`).catch(() => ({ ok: false, status: 0, data: null }))
    ]);
    return { relay, bridge };
  }

  const toolMap = {
    list_channels: 'claw_channels_list',
    list_agents: 'claw_agents_list',
    send_message: 'claw_send_message'
  };

  const toolName = toolMap[parsed.action];
  if (!toolName) throw new Error(`Unsupported OpenClaw action: ${parsed.action}`);

  const argumentsPayload = parsed.action === 'send_message'
    ? { channel_id: parsed.channel, message: parsed.payload }
    : {};

  return clawFetch(`${bridgeUrl}/mcp`, {
    method: 'POST',
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: toolName, arguments: argumentsPayload }
    })
  });
}

async function executeCodeAction(parsed) {
  const targetPath = resolveWorkspacePath(parsed.filename);
  const ext = extname(targetPath).toLowerCase();
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, parsed.code || '', 'utf8');
  return {
    path: targetPath,
    language: parsed.lang || ext.replace('.', '') || 'text',
    bytes: Buffer.byteLength(parsed.code || '', 'utf8')
  };
}

async function executeParsedTask(parsed) {
  if (!parsed) throw new Error('Task has no parsed action to execute');

  if (parsed.type === 'ps') {
    return { type: parsed.type, output: await runPSSync(parsed.command) };
  }

  if (parsed.type === 'fs') {
    return { type: parsed.type, ...(await executeFsAction(parsed)) };
  }

  if (parsed.type === 'sql') {
    return { type: parsed.type, ...(await runRawSQL(parsed.query)) };
  }

  if (parsed.type === 'claw') {
    return { type: parsed.type, ...(await executeClawAction(parsed)) };
  }

  if (parsed.type === 'code') {
    return { type: parsed.type, ...(await executeCodeAction(parsed)) };
  }

  throw new Error(`Unsupported task type: ${parsed.type}`);
}

async function parseTaskInput(targetAgent, command) {
  if (!command?.trim()) return null;
  const result = await dispatchLocalAgent({ agentId: targetAgent || 'AUTO', command });
  return result.parsed;
}

export async function listOpsRunbooks() {
  const state = await readState();
  return sortRunbooks(state.runbooks || []);
}

export async function getOpsPolicies() {
  const state = await readState();
  return mergePolicies(state.policies);
}

export async function listOpsTasks(status) {
  const state = await readState();
  const tasks = sortTasks(state.tasks);
  return status ? tasks.filter((task) => task.status === status) : tasks;
}

export async function listOpsAudit(limit = 40) {
  const state = await readState();
  return state.audit.slice(0, limit);
}

export async function createOpsTask(input) {
  const command = String(input.command || '').trim();
  const targetAgent = input.targetAgent || 'AUTO';
  const parsed = await parseTaskInput(targetAgent, command);
  const policies = await getOpsPolicies();
  const policyDecision = evaluatePolicies(parsed, policies);
  const risk = classifyRisk(parsed);
  const executable = isExecutableTask({ parsed });
  const requiresApproval = executable ? (input.requiresApproval === true || policyDecision.requiresApproval) : false;
  const createdAt = now();

  const task = {
    id: makeId('task'),
    title: safeTitle(input.title),
    summary: String(input.summary || summarizeAction(parsed)).trim(),
    command,
    targetAgent,
    requestedBy: String(input.requestedBy || 'operator'),
    status: executable ? (requiresApproval ? 'pending_approval' : 'approved') : 'draft',
    risk,
    requiresApproval,
    executable,
    parsed,
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
    createdAt,
    updatedAt: createdAt,
    decision: null,
    lastRun: null
  };

  const nextState = await mutateState((state) => {
    state.tasks.unshift(task);
    addAuditEvent(state, 'task.created', {
      taskId: task.id,
      title: task.title,
      targetAgent: task.targetAgent,
      requiresApproval: task.requiresApproval,
      risk: task.risk,
      executable: task.executable
    });
    if (!task.executable) {
      addAuditEvent(state, 'task.recorded', {
        taskId: task.id,
        reason: 'planning-only task without an executable command'
      });
    } else if (!requiresApproval) {
      addAuditEvent(state, 'task.auto_approved', {
        taskId: task.id,
        reason: 'low-risk action'
      });
    }
    return state;
  });

  return nextState.tasks.find((entry) => entry.id === task.id);
}

export async function createOpsRunbook(input) {
  const command = String(input.command || '').trim();
  if (!command) throw new Error('Runbook command is required');

  const policies = await getOpsPolicies();
  if (!policies.allowCustomRunbooks) throw new Error('Policy currently disables custom runbook creation.');

  const targetAgent = input.targetAgent || 'AUTO';
  const parsed = await parseTaskInput(targetAgent, command);
  if (!parsed) throw new Error('Runbook command must resolve to an executable action');
  const policyDecision = evaluatePolicies(parsed, policies);

  const createdAt = now();
  const runbook = {
    id: makeId('runbook'),
    title: safeTitle(input.title),
    summary: String(input.summary || summarizeAction(parsed)).trim(),
    command,
    targetAgent,
    requiresApproval: input.requiresApproval === true || policyDecision.requiresApproval,
    tags: normalizeTags(input.tags),
    builtin: false,
    createdBy: String(input.createdBy || 'operator'),
    createdAt,
    updatedAt: createdAt,
    lastUsedAt: null,
    previewType: parsed.type || 'unknown',
    risk: classifyRisk(parsed)
  };

  const nextState = await mutateState((state) => {
    state.runbooks = sortRunbooks([runbook, ...(state.runbooks || [])]);
    addAuditEvent(state, 'runbook.created', {
      runbookId: runbook.id,
      title: runbook.title,
      createdBy: runbook.createdBy
    });
    return state;
  });

  return nextState.runbooks.find((entry) => entry.id === runbook.id);
}

export async function deleteOpsRunbook(runbookId, deletedBy = 'operator') {
  let deletedRunbook = null;

  await mutateState((state) => {
    const policies = mergePolicies(state.policies);
    const runbook = state.runbooks.find((entry) => entry.id === runbookId);
    if (!runbook) throw new Error('Runbook not found');
    if (runbook.builtin) throw new Error('Built-in runbooks cannot be deleted');
    if (!policies.allowRunbookDeletion) throw new Error('Policy currently disables custom runbook deletion.');

    state.runbooks = state.runbooks.filter((entry) => entry.id !== runbookId);
    deletedRunbook = structuredClone(runbook);
    addAuditEvent(state, 'runbook.deleted', {
      runbookId,
      deletedBy
    });
    return state;
  });

  return deletedRunbook;
}

export async function instantiateOpsRunbook(runbookId, input = {}) {
  const state = await readState();
  const runbook = state.runbooks.find((entry) => entry.id === runbookId);
  if (!runbook) throw new Error('Runbook not found');

  const task = await createOpsTask({
    title: input.title || runbook.title,
    summary: input.summary || runbook.summary,
    command: input.command || runbook.command,
    targetAgent: input.targetAgent || runbook.targetAgent,
    requestedBy: input.requestedBy || 'operator',
    requiresApproval: typeof input.requiresApproval === 'boolean' ? input.requiresApproval : runbook.requiresApproval,
    metadata: {
      ...(input.metadata && typeof input.metadata === 'object' ? input.metadata : {}),
      runbookId: runbook.id,
      runbookTitle: runbook.title
    }
  });

  await mutateState((nextState) => {
    const target = nextState.runbooks.find((entry) => entry.id === runbookId);
    if (!target) return nextState;
    target.lastUsedAt = now();
    target.updatedAt = target.lastUsedAt;
    addAuditEvent(nextState, 'runbook.instantiated', {
      runbookId,
      taskId: task.id,
      requestedBy: input.requestedBy || 'operator'
    });
    return nextState;
  });

  return task;
}

export async function updateOpsPolicies(input = {}, updatedBy = 'operator') {
  let nextPolicies = null;

  await mutateState((state) => {
    state.policies = mergePolicies({
      ...(state.policies || {}),
      ...(input && typeof input === 'object' ? input : {})
    });
    nextPolicies = structuredClone(state.policies);
    addAuditEvent(state, 'policy.updated', {
      updatedBy,
      profile: state.policies.profile,
      requireApprovalForTypes: state.policies.requireApprovalForTypes,
      blockedTaskTypes: state.policies.blockedTaskTypes,
      blockedFsOperations: state.policies.blockedFsOperations,
      blockedClawActions: state.policies.blockedClawActions
    });
    return state;
  });

  return nextPolicies;
}

export async function decideOpsTask(taskId, decision, reviewer, note = '') {
  const targetDecision = decision === 'approve' ? 'approved' : 'rejected';
  let updatedTask = null;

  await mutateState((state) => {
    const task = state.tasks.find((entry) => entry.id === taskId);
    if (!task) throw new Error('Task not found');
    if (!task.requiresApproval) throw new Error('Task does not require approval');
    if (task.status === 'running') throw new Error('Task is currently running');

    task.status = targetDecision;
    task.updatedAt = now();
    task.decision = {
      decision: targetDecision,
      by: reviewer || 'operator',
      note: String(note || ''),
      at: task.updatedAt
    };
    updatedTask = structuredClone(task);
    addAuditEvent(state, `task.${targetDecision}`, {
      taskId: task.id,
      by: reviewer || 'operator',
      note: String(note || '')
    });
    return state;
  });

  return updatedTask;
}

export async function runOpsTask(taskId, requestedBy = 'operator') {
  let taskSnapshot = null;

  await mutateState((state) => {
    const policies = mergePolicies(state.policies);
    const task = state.tasks.find((entry) => entry.id === taskId);
    if (!task) throw new Error('Task not found');
    if (!task.executable) throw new Error('This task is planning-only and cannot be run');
    const policyDecision = evaluatePolicies(task.parsed, policies);
    if (policyDecision.requiresApproval) task.requiresApproval = true;
    if (task.requiresApproval && task.status !== 'approved') {
      task.status = 'pending_approval';
      task.updatedAt = now();
      throw Object.assign(new Error('Task must be approved before it can run'), { task: structuredClone(task) });
    }
    task.status = 'running';
    task.updatedAt = now();
    task.lastRun = {
      startedAt: task.updatedAt,
      requestedBy,
      result: null,
      error: null
    };
    taskSnapshot = structuredClone(task);
    addAuditEvent(state, 'task.run_started', { taskId: task.id, by: requestedBy });
    return state;
  });

  try {
    const result = await executeParsedTask(taskSnapshot.parsed);
    let completedTask = null;
    await mutateState((state) => {
      const task = state.tasks.find((entry) => entry.id === taskId);
      if (!task) throw new Error('Task disappeared during execution');
      task.status = 'completed';
      task.updatedAt = now();
      task.lastRun = {
        ...(task.lastRun || {}),
        startedAt: task.lastRun?.startedAt || now(),
        finishedAt: task.updatedAt,
        requestedBy,
        result,
        error: null
      };
      completedTask = structuredClone(task);
      addAuditEvent(state, 'task.run_completed', {
        taskId: task.id,
        by: requestedBy,
        type: task.parsed?.type || 'unknown'
      });
      return state;
    });
    return completedTask;
  } catch (error) {
    let failedTask = null;
    await mutateState((state) => {
      const task = state.tasks.find((entry) => entry.id === taskId);
      if (!task) throw new Error('Task disappeared during failure handling');
      task.status = 'failed';
      task.updatedAt = now();
      task.lastRun = {
        ...(task.lastRun || {}),
        finishedAt: task.updatedAt,
        requestedBy,
        result: null,
        error: error.message
      };
      failedTask = structuredClone(task);
      addAuditEvent(state, 'task.run_failed', {
        taskId: task.id,
        by: requestedBy,
        error: error.message
      });
      return state;
    });
    throw Object.assign(new Error(error.message), { task: failedTask });
  }
}

export async function collectOpsDiagnostics() {
  const checks = [];
  const pkgPath = join(__dirname, '..', 'package.json');
  const readmePath = join(__dirname, '..', 'README.md');
  const gitConfigPath = join(__dirname, '..', '.git', 'config');
  const state = await readState();

  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  const readme = await readFile(readmePath, 'utf8').catch(() => '');
  const gitConfig = await readFile(gitConfigPath, 'utf8').catch(() => '');

  checks.push({
    id: 'ops-storage',
    label: 'Ops state persistence',
    status: 'ok',
    detail: `Persistent state file is stored at ${STATE_PATH}.`
  });

  checks.push({
    id: 'platform',
    label: 'Host platform compatibility',
    status: process.platform === 'win32' ? 'ok' : 'warn',
    detail: process.platform === 'win32'
      ? 'Windows-native execution paths are aligned with the current host.'
      : 'Core execution, monitoring, and log routes now adapt to the host shell, but some UX copy and legacy assumptions still reflect the original Windows-first design.'
  });

  const hasDb = !!(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY));
  checks.push({
    id: 'database',
    label: 'Database readiness',
    status: hasDb ? 'ok' : 'warn',
    detail: hasDb ? 'Supabase credentials are configured.' : 'Supabase is not configured, so database tooling is limited.'
  });

  const bridgeUrl = process.env.OPENCLAW_BRIDGE_URL || 'http://localhost:3004';
  const relayUrl = process.env.OPENCLAW_RELAY_URL || 'http://localhost:4588';
  try {
    const [relay, bridge] = await Promise.all([
      clawFetch(`${relayUrl}/`).catch(() => ({ ok: false, status: 0 })),
      clawFetch(`${bridgeUrl}/health`).catch(() => ({ ok: false, status: 0 }))
    ]);
    checks.push({
      id: 'openclaw',
      label: 'OpenClaw bridge',
      status: relay.ok || bridge.ok ? 'ok' : 'warn',
      detail: relay.ok || bridge.ok
        ? `Relay (${relay.status}) and/or bridge (${bridge.status}) responded.`
        : 'OpenClaw relay/bridge are not reachable from this app right now.'
    });
  } catch (error) {
    checks.push({
      id: 'openclaw',
      label: 'OpenClaw bridge',
      status: 'warn',
      detail: error.message
    });
  }

  const mcpDeps = [
    '@wonderwhy-er/desktop-commander',
    'chrome-devtools-mcp',
    '@modelcontextprotocol/server-filesystem',
    '@mseep/windows-command-line-mcp-server'
  ];
  const installedMcp = mcpDeps.filter((dep) => pkg.dependencies?.[dep]);
  checks.push({
    id: 'mcp',
    label: 'Local MCP toolchain',
    status: installedMcp.length === mcpDeps.length ? 'ok' : 'warn',
    detail: `${installedMcp.length}/${mcpDeps.length} requested MCP packages are installed.`
  });

  checks.push({
    id: 'runbooks',
    label: 'Ops runbook library',
    status: (state.runbooks || []).length ? 'ok' : 'warn',
    detail: `${(state.runbooks || []).length} reusable runbook${(state.runbooks || []).length === 1 ? '' : 's'} available to operators.`
  });

  checks.push({
    id: 'policies',
    label: 'Ops governance policies',
    status: state.policies?.requireApprovalForTypes?.length ? 'ok' : 'warn',
    detail: `Approval required for: ${(state.policies?.requireApprovalForTypes || []).join(', ') || 'nothing'}; blocked task types: ${(state.policies?.blockedTaskTypes || []).join(', ') || 'none'}.`
  });

  checks.push({
    id: 'docs',
    label: 'README parity',
    status: readme.includes('/api/ops/runbooks') && readme.includes('/api/ops/policies') && readme.includes('/api/logs') && readme.includes('/api/monitor') ? 'ok' : 'warn',
    detail: 'README coverage should reflect the current routes, runbooks, and control-plane features.'
  });

  checks.push({
    id: 'security',
    label: 'Dashboard token hygiene',
    status: process.env.DASHBOARD_TOKEN && process.env.DASHBOARD_TOKEN !== 'executionor-local' ? 'ok' : 'warn',
    detail: process.env.DASHBOARD_TOKEN && process.env.DASHBOARD_TOKEN !== 'executionor-local'
      ? 'Dashboard token is customized.'
      : 'DASHBOARD_TOKEN is unset or still using the default placeholder.'
  });

  checks.push({
    id: 'git-remote',
    label: 'Git remote',
    status: /\[remote "origin"\]/.test(gitConfig) ? 'ok' : 'warn',
    detail: /\[remote "origin"\]/.test(gitConfig)
      ? 'A git origin remote is configured.'
      : 'The local repository has no origin remote configured yet.'
  });

  return checks;
}

export async function getOpsOverview() {
  const state = await readState();
  const tasks = sortTasks(state.tasks);
  const runbooks = sortRunbooks(state.runbooks || []);
  const policies = mergePolicies(state.policies);
  const diagnostics = await collectOpsDiagnostics();
  const counts = taskCounts(tasks);
  return {
    counts: { ...counts, runbooks: runbooks.length },
    tasks: tasks.slice(0, 25),
    runbooks: runbooks.slice(0, 25),
    policies,
    audit: state.audit.slice(0, 25),
    diagnostics,
    diagnosticsSummary: diagnostics.reduce((acc, check) => {
      acc[check.status] = (acc[check.status] || 0) + 1;
      return acc;
    }, { ok: 0, warn: 0, fail: 0 })
  };
}
