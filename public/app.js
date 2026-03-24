'use strict';

const API = `${window.location.origin}/api`;
const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;

const AGENTS = [
  { id: 'SHELL', name: 'Shell', role: 'Real Host Shell Executor', orb: 'o-sh', emoji: '⚡' },
  { id: 'PHANTOM', name: 'Phantom', role: 'Filesystem Operator', orb: 'o-gh', emoji: '👻' },
  { id: 'HYDRA', name: 'Hydra', role: 'SQL and Data Router', orb: 'o-hy', emoji: '🗃' },
  { id: 'SCRIBE', name: 'Scribe', role: 'Template Builder', orb: 'o-sc', emoji: '✍' },
  { id: 'CLAW', name: 'Claw', role: 'OpenClaw Relay Operator', orb: 'o-cl', emoji: '🦞' }
];

const AUTO_AGENT = { id: 'AUTO', name: 'Auto', role: 'Local Router', orb: 'o-sh', emoji: '✦' };
const MODE_LABELS = {
  powershell: 'PowerShell',
  javascript: 'JavaScript',
  sql: 'SQL',
  python: 'Python',
  htmlmixed: 'HTML',
  css: 'CSS',
  markdown: 'Markdown',
  json: 'JSON',
  text: 'Text'
};

const state = {
  workspaceRoot: 'D:\\',
  health: null,
  ws: null,
  wsRetry: null,
  activeView: 'editor',
  activeAgent: 'SHELL',
  dispatchTarget: 'SHELL',
  activeSortProc: 'cpu',
  logFile: '',
  logStream: null,
  opsRunbooks: [],
  opsPolicies: {},
  savedSessions: [],
  paletteMode: 'commands',
  paletteItems: [],
  paletteSelection: 0,
  ctxTarget: null,
  bubbleCounter: 0,
  editor: null,
  tabs: [
    {
      id: `tab_${Date.now()}`,
      name: 'workspace.ps1',
      path: '',
      mode: 'powershell',
      content: "# Executionor Local Workspace\n$env:PATH = \"D:\\npm-global;C:\\Program Files\\nodejs;\" + $env:PATH\n\nGet-Location\n",
      dirty: false
    }
  ],
  activeTab: 0,
  terminalSessions: [{ id: 0, label: 'PS #1', history: [], histIdx: -1 }],
  activeTerminalSession: 0,
  nextTerminalSessionId: 1,
  psActiveSessionId: null,
  session: createSession(),
  agentState: Object.fromEntries(AGENTS.map((agent) => [agent.id, { status: 'idle', history: [] }]))
};

document.addEventListener('DOMContentLoaded', boot);

async function boot() {
  initEditor();
  renderSidebar();
  renderEditorTabs();
  initResize();
  initWS();
  installGlobalShortcuts();

  const health = await checkHealth();
  state.workspaceRoot = health?.workspaceRoot || state.workspaceRoot;
  document.getElementById('fp-inp').value = state.workspaceRoot;

  await Promise.allSettled([
    browseDir(state.workspaceRoot),
    loadTables(),
    loadSessionList(),
    loadLogFiles(),
    loadOpsDashboard()
  ]);

  setAgent('SHELL');
  selT('SHELL');
  switchTerminalSession(0);
  bubble('System', AUTO_AGENT, 'Executionor local mode is online.\nReal host-shell execution, real filesystem access, live process data, and optional real database/OpenClaw integrations are ready.');
  setInterval(checkHealth, 20000);
}

function createSession() {
  return {
    id: `sess_${Date.now()}`,
    createdAt: new Date().toISOString(),
    messages: []
  };
}

function installGlobalShortcuts() {
  document.addEventListener('keydown', (event) => {
    if (event.key === 'F5') {
      event.preventDefault();
      runActive();
    }
    if (event.key === 'Escape') {
      closePalette();
      closeCfg();
      closeWizard();
      hideCtx();
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'p') {
      event.preventDefault();
      openPalette();
    }
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 's') {
      event.preventDefault();
      writeFileback();
    }
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      openFileSearch();
    }
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('#ctx-menu')) hideCtx();
  });
}

function initEditor() {
  const host = document.getElementById('ed-wrap');
  state.editor = CodeMirror(host, {
    value: state.tabs[0].content,
    mode: 'powershell',
    lineNumbers: true,
    lineWrapping: true,
    matchBrackets: true,
    autoCloseBrackets: true,
    styleActiveLine: true
  });

  state.editor.on('change', () => {
    const tab = currentTab();
    if (!tab) return;
    tab.content = state.editor.getValue();
    tab.dirty = true;
    updateEditorStatus();
    renderEditorTabs();
  });

  state.editor.on('cursorActivity', updateEditorStatus);
  updateEditorStatus();
}

function currentTab() {
  return state.tabs[state.activeTab];
}

function updateEditorStatus() {
  const cursor = state.editor.getCursor();
  const tab = currentTab();
  document.getElementById('sb-ln').textContent = String(cursor.line + 1);
  document.getElementById('sb-col').textContent = String(cursor.ch + 1);
  document.getElementById('sb-lang').textContent = MODE_LABELS[tab?.mode] || 'Text';
}

function guessMode(name = '') {
  const lower = name.toLowerCase();
  if (lower.endsWith('.ps1') || lower.endsWith('.psm1')) return 'powershell';
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'javascript';
  if (lower.endsWith('.sql')) return 'sql';
  if (lower.endsWith('.py')) return 'python';
  if (lower.endsWith('.html')) return 'htmlmixed';
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.md')) return 'markdown';
  if (lower.endsWith('.json')) return 'javascript';
  return 'text';
}

function renderSidebar() {
  const root = document.getElementById('agent-list');
  root.innerHTML = AGENTS.map((agent) => {
    const status = state.agentState[agent.id]?.status || 'idle';
    const dotClass = { idle: 'd-idle', running: 'd-run', ok: 'd-ok', error: 'd-err' }[status] || 'd-idle';
    return `
      <div class="a-item ${state.activeAgent === agent.id ? 'active' : ''}" onclick="setAgent('${agent.id}')">
        <div class="a-orb ${agent.orb}">${agent.emoji}<div class="a-dot ${dotClass}"></div></div>
        <div class="a-meta">
          <div class="a-name">${esc(agent.name)}</div>
          <div class="a-role">${esc(agent.role)}</div>
        </div>
      </div>
    `;
  }).join('');
}

function getAgentMeta(agentId) {
  return AGENTS.find((agent) => agent.id === agentId) || AUTO_AGENT;
}

function setAgent(agentId) {
  state.activeAgent = agentId;
  document.getElementById('sb-ag').textContent = agentId;
  renderSidebar();
}

function selT(agentId) {
  state.dispatchTarget = agentId;
  document.querySelectorAll('.dtool').forEach((button) => button.classList.remove('sel'));
  document.getElementById(`dt-${agentId}`)?.classList.add('sel');
}

function initWS() {
  try {
    state.ws = new WebSocket(WS_URL);
    state.ws.onopen = () => {
      setHd('ws', true, 'live');
      clearTimeout(state.wsRetry);
    };
    state.ws.onclose = () => {
      setHd('ws', false, 'retrying');
      state.wsRetry = setTimeout(initWS, 3000);
    };
    state.ws.onerror = () => {};
    state.ws.onmessage = (event) => {
      try {
        onWS(JSON.parse(event.data));
      } catch (_) {}
    };
  } catch (_) {
    state.wsRetry = setTimeout(initWS, 5000);
  }
}

function onWS(message) {
  switch (message.type) {
    case 'ps:start':
      state.psActiveSessionId = message.sessionId;
      break;
    case 'ps:line':
      if (message.sessionId !== state.psActiveSessionId) return;
      appendTerminalLine(ansi(message.line), message.stream === 'stderr' ? 'te' : 'to');
      break;
    case 'ps:done':
      if (message.sessionId !== state.psActiveSessionId) return;
      appendTerminalLine(`[exit: ${message.exitCode}]`, message.exitCode === 0 ? 'tok' : 'te');
      state.psActiveSessionId = null;
      break;
    case 'ps:timeout':
      appendTerminalLine('[TIMEOUT]', 'te');
      state.psActiveSessionId = null;
      break;
    case 'ps:killed':
      appendTerminalLine('[killed]', 'te');
      state.psActiveSessionId = null;
      break;
    case 'agent:thinking':
      if (state.agentState[message.agentId]) {
        state.agentState[message.agentId].status = 'running';
        renderSidebar();
      }
      break;
    case 'agent:error':
      if (state.agentState[message.agentId]) {
        state.agentState[message.agentId].status = 'error';
        renderSidebar();
      }
      break;
    case 'agent:response':
      if (state.agentState[message.agentId]) {
        state.agentState[message.agentId].status = 'ok';
        renderSidebar();
      }
      break;
    case 'ops:update':
      if (state.activeView === 'ops') loadOpsDashboard();
      break;
    default:
      break;
  }
}

async function checkHealth() {
  try {
    const health = await GET('/health');
    state.health = health;
    setHd('be', true, `v${health.version}`);
    setHd('ag', true, 'local');
    setHd('db', health.env.database, health.env.database ? 'ready' : 'optional');
    setHd('cl', health.env.openclaw, health.env.openclaw ? 'ready' : 'optional');
    if (health.workspaceRoot) state.workspaceRoot = health.workspaceRoot;
    return health;
  } catch (_) {
    setHd('be', false, 'offline');
    return null;
  }
}

function setHd(id, ok, value) {
  const dot = document.getElementById(`hd-${id}`);
  const label = document.getElementById(`hv-${id}`);
  if (dot) dot.className = `h-dot ${ok ? 'd-ok' : 'd-err'}`;
  if (label) label.textContent = value || '';
}

const H = { 'Content-Type': 'application/json' };

async function api(method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: H,
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || `HTTP ${response.status}`);
  return data;
}

const GET = (path) => api('GET', path);
const POST = (path, body) => api('POST', path, body);
const PUT = (path, body) => api('PUT', path, body);
const DEL = (path) => api('DELETE', path);

function sv(view, button) {
  state.activeView = view;
  document.querySelectorAll('#content .view').forEach((panel) => panel.classList.remove('on'));
  document.getElementById(`v-${view}`)?.classList.add('on');
  document.querySelectorAll('#tabs .tab').forEach((tab) => tab.classList.remove('active'));
  if (button) button.classList.add('active');
  if (view === 'logs') startLogStream();
  if (view === 'monitor') refreshMonitor();
  if (view === 'ops') loadOpsDashboard();
}

function renderEditorTabs() {
  const root = document.getElementById('ed-tabs');
  root.innerHTML = state.tabs.map((tab, index) => `
    <div class="et ${index === state.activeTab ? 'active' : ''}" onclick="activateEditorTab(${index})">
      <span>${esc(tab.name)}${tab.dirty ? ' *' : ''}</span>
      <span class="ec" onclick="event.stopPropagation();closeEditorTab(${index})">×</span>
    </div>
  `).join('') + '<div class="add-tab" onclick="addEditorTab()">+</div>';
}

function activateEditorTab(index) {
  state.activeTab = index;
  const tab = currentTab();
  state.editor.setOption('mode', tab.mode);
  state.editor.setValue(tab.content);
  updateEditorStatus();
  renderEditorTabs();
}

function addEditorTab(name = 'untitled.ps1', content = '', path = '') {
  state.tabs.push({
    id: `tab_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    path,
    mode: guessMode(name),
    content,
    dirty: false
  });
  activateEditorTab(state.tabs.length - 1);
}

function closeEditorTab(index) {
  if (state.tabs.length === 1) return;
  state.tabs.splice(index, 1);
  state.activeTab = Math.max(0, Math.min(state.activeTab, state.tabs.length - 1));
  activateEditorTab(state.activeTab);
}

function openInEditor(name, content, path = '') {
  const existingIndex = state.tabs.findIndex((tab) => tab.path && path && tab.path.toLowerCase() === path.toLowerCase());
  if (existingIndex >= 0) {
    state.tabs[existingIndex].content = content;
    state.tabs[existingIndex].dirty = false;
    activateEditorTab(existingIndex);
    return;
  }

  state.tabs.push({
    id: `tab_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    path,
    mode: guessMode(name),
    content,
    dirty: false
  });
  activateEditorTab(state.tabs.length - 1);
}

async function browseDir(path) {
  const target = path || state.workspaceRoot;
  const result = await GET(`/fs/list?path=${encodeURIComponent(target)}`);
  state.fileTreePath = result.path;
  document.getElementById('fp-inp').value = result.path;
  document.getElementById('ftree').innerHTML = result.items.map((item) => `
    <div class="ti ${item.type}" onclick="${item.type === 'dir' ? `browseDir('${escapeJs(item.path)}')` : `openFromFS('${escapeJs(item.path)}')`}" oncontextmenu="showCtx(event, ${encodeHtmlAttr(JSON.stringify(item))})">
      <span>${item.type === 'dir' ? '📁' : '📄'}</span>
      <span class="ti-nm">${esc(item.name)}</span>
      <span class="ti-sz">${esc(item.type === 'dir' ? '' : item.size)}</span>
    </div>
  `).join('');
}

async function openFromFS(path) {
  const file = await GET(`/fs/read?path=${encodeURIComponent(path)}`);
  openInEditor(file.name, file.content, file.path);
  sv('editor', document.querySelectorAll('#tabs .tab')[0]);
}

function showCtx(event, item) {
  event.preventDefault();
  state.ctxTarget = item;
  const menu = document.getElementById('ctx-menu');
  menu.style.display = 'block';
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;
}

function hideCtx() {
  const menu = document.getElementById('ctx-menu');
  if (menu) menu.style.display = 'none';
}

async function ctxAction(action) {
  if (!state.ctxTarget) return;
  const item = state.ctxTarget;
  hideCtx();

  if (action === 'open' && item.type === 'file') {
    await openFromFS(item.path);
    return;
  }
  if (action === 'newfile') {
    await ctxNewFile(item.type === 'dir' ? item.path : state.fileTreePath);
    return;
  }
  if (action === 'newfolder') {
    const name = prompt('Folder name');
    if (!name) return;
    await POST('/fs/mkdir', { path: joinClientPath(item.type === 'dir' ? item.path : state.fileTreePath, name) });
    await browseDir(state.fileTreePath);
    toast(`Created ${name}`, 'ok');
    return;
  }
  if (action === 'rename') {
    const newName = prompt('New name', item.name);
    if (!newName || newName === item.name) return;
    await POST('/fs/rename', { path: item.path, newName });
    await browseDir(state.fileTreePath);
    toast(`Renamed to ${newName}`, 'ok');
    return;
  }
  if (action === 'delete') {
    if (!confirm(`Delete ${item.name}?`)) return;
    await DEL(`/fs?path=${encodeURIComponent(item.path)}`);
    await browseDir(state.fileTreePath);
    toast(`Deleted ${item.name}`, 'ok');
    return;
  }
  if (action === 'copypath') {
    await navigator.clipboard.writeText(item.path);
    toast('Path copied', 'ok');
    return;
  }
  if (action === 'reveal') {
    await browseDir(item.type === 'dir' ? item.path : state.fileTreePath);
  }
}

async function ctxNewFile(basePath) {
  const name = prompt('File name', 'untitled.ps1');
  if (!name) return;
  const path = joinClientPath(basePath || state.workspaceRoot, name);
  openInEditor(name, '', path);
  toast(`Ready to edit ${name}`, 'info');
}

function joinClientPath(basePath, name) {
  const trimmedBase = String(basePath || '').replace(/[\\/]+$/, '');
  const trimmedName = String(name || '').replace(/^[\\/]+/, '');
  return `${trimmedBase}\\${trimmedName}`;
}

async function qdSend() {
  const input = document.getElementById('qd-inp');
  const command = input.value.trim();
  if (!command) return;
  input.value = '';
  await dispatch(state.activeAgent, command);
}

async function dSend() {
  const input = document.getElementById('dsp-inp');
  const command = input.value.trim();
  if (!command) return;
  input.value = '';
  grow(input);
  await dispatch(state.dispatchTarget, command);
}

function dKey(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    dSend();
  }
}

function grow(element) {
  element.style.height = 'auto';
  element.style.height = `${Math.min(180, element.scrollHeight)}px`;
}

async function dispatch(agentId, command) {
  const requestedAgent = getAgentMeta(agentId);
  const bubbleId = `b${state.bubbleCounter++}`;
  const stream = document.getElementById('stream');

  if (state.agentState[requestedAgent.id]) {
    state.agentState[requestedAgent.id].status = 'running';
    renderSidebar();
  }

  if (agentId !== 'AUTO') setAgent(agentId);
  sv('agents', document.querySelectorAll('#tabs .tab')[3]);
  bubble('You', null, command, true);

  state.session.messages.push({ role: 'user', agentId, content: command, ts: ts() });
  stream.insertAdjacentHTML('beforeend', `
    <div class="bbl" id="${bubbleId}">
      <div class="bav ${requestedAgent.orb}">${requestedAgent.emoji}</div>
      <div class="bbd" id="bbd-${bubbleId}">
        <div class="bhdr"><span>${esc(requestedAgent.name)}</span><span class="bts">${ts()}</span></div>
        <div class="bstream" id="bs-${bubbleId}"><div class="tdots"><span></span><span></span><span></span></div></div>
      </div>
    </div>
  `);
  stream.scrollTop = stream.scrollHeight;

  const streamEl = document.getElementById(`bs-${bubbleId}`);
  let accumulated = '';

  try {
    const response = await fetch(`${API}/stream`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        agentId,
        command,
        history: state.agentState[requestedAgent.id]?.history?.slice(-4) || []
      })
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw) continue;

        let event;
        try {
          event = JSON.parse(raw);
        } catch (_) {
          continue;
        }

        if (event.type === 'token') {
          accumulated += event.text;
          streamEl.textContent = accumulated;
          stream.scrollTop = stream.scrollHeight;
          continue;
        }

        if (event.type === 'parsed') {
          const actualAgent = getAgentMeta(event.data?.agentId || requestedAgent.id);
          renderParsedInBubble(actualAgent, event.data, bubbleId);
          if (state.agentState[actualAgent.id]) {
            state.agentState[actualAgent.id].status = 'ok';
            state.agentState[actualAgent.id].history.push({ command, result: event.data });
          }
          state.session.messages.push({ role: 'agent', agentId: actualAgent.id, content: event.data, ts: ts() });
          renderSidebar();
          continue;
        }

        if (event.type === 'exec_start') {
          sv('terminal', document.querySelectorAll('#tabs .tab')[1]);
          appendTerminalLine(`⚡ ${event.cmd}`, 'ti2');
          continue;
        }

        if (event.type === 'exec_line') {
          appendTerminalLine(ansi(event.line), event.stream === 'stderr' ? 'te' : 'to');
          continue;
        }

        if (event.type === 'exec_done') {
          appendTerminalLine(`[exit: ${event.exitCode}]`, event.exitCode === 0 ? 'tok' : 'te');
          continue;
        }

        if (event.type === 'error') {
          streamEl.innerHTML = `<span style="color:var(--red)">${esc(event.message)}</span>`;
          if (state.agentState[requestedAgent.id]) state.agentState[requestedAgent.id].status = 'error';
          renderSidebar();
        }
      }
    }
  } catch (error) {
    streamEl.innerHTML = `<span style="color:var(--red)">Error: ${esc(error.message)}</span>`;
    if (state.agentState[requestedAgent.id]) state.agentState[requestedAgent.id].status = 'error';
    renderSidebar();
  }
}

function renderParsedInBubble(agent, parsed, bubbleId) {
  const body = document.getElementById(`bbd-${bubbleId}`);
  let html = `<div class="bhdr"><span>${esc(agent.name)}</span><span class="bts">${ts()}</span></div>`;

  if (!parsed) {
    body.innerHTML = `${html}<div class="bcode">No structured action returned.</div>`;
    return;
  }

  if (parsed.explanation) html += `<div style="font-size:11px;color:var(--t3);margin-bottom:5px">${esc(parsed.explanation)}</div>`;

  if (parsed.type === 'ps') {
    html += `<div class="bcode">${esc(parsed.command)}</div>`;
  } else if (parsed.type === 'fs') {
    html += `<div class="bcode">op: ${esc(parsed.operation)}\npath: ${esc(parsed.path || '')}</div>`;
    if (parsed.preview) html += `<div class="bcode">${esc(parsed.preview)}</div>`;
    executeFsSideEffect(parsed);
  } else if (parsed.type === 'sql') {
    html += `<div class="bcode">${esc(parsed.query)}</div>`;
    document.getElementById('db-sql').value = parsed.query;
    if (/^\s*(select|with)\b/i.test(parsed.query)) {
      sv('db', document.querySelectorAll('#tabs .tab')[2]);
      runSQL(parsed.query);
    }
  } else if (parsed.type === 'code') {
    html += `<div class="bcode">${esc(parsed.filename)}\n\n${esc(parsed.code.slice(0, 600))}${parsed.code.length > 600 ? '\n...' : ''}</div>`;
    openInEditor(parsed.filename, parsed.code, joinClientPath(state.workspaceRoot, parsed.filename));
    sv('editor', document.querySelectorAll('#tabs .tab')[0]);
  } else if (parsed.type === 'claw') {
    html += `<div class="bcode">action: ${esc(parsed.action)}\nchannel: ${esc(parsed.channel || '-')}\npayload: ${esc(parsed.payload || '')}</div>`;
  } else {
    html += `<div class="bcode">${esc(JSON.stringify(parsed, null, 2))}</div>`;
  }

  body.innerHTML = html;
}

async function executeFsSideEffect(parsed) {
  try {
    if (parsed.operation === 'list') {
      await browseDir(parsed.path || state.workspaceRoot);
    } else if (parsed.operation === 'read') {
      await openFromFS(parsed.path);
    } else if (parsed.operation === 'find' && parsed.query) {
      openPalette('files', parsed.query);
    } else if (parsed.operation === 'mkdir') {
      await POST('/fs/mkdir', { path: parsed.path });
      await browseDir(state.fileTreePath || state.workspaceRoot);
      toast(`Created ${parsed.path}`, 'ok');
    } else if (parsed.operation === 'write') {
      openInEditor(parsed.path.split(/[\\/]/).pop(), parsed.content || '', parsed.path);
      toast('File template opened in editor', 'info');
    }
  } catch (error) {
    toast(error.message, 'err');
  }
}

function psKey(event) {
  const session = state.terminalSessions.find((item) => item.id === state.activeTerminalSession);
  if (event.key === 'Enter') {
    event.preventDefault();
    execPS();
    return;
  }
  if (!session) return;
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    session.histIdx = Math.min(session.histIdx + 1, session.history.length - 1);
    event.target.value = session.history[session.histIdx] || event.target.value;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    session.histIdx = Math.max(session.histIdx - 1, -1);
    event.target.value = session.histIdx >= 0 ? session.history[session.histIdx] : '';
  }
}

async function execPS() {
  const input = document.getElementById('ps-inp');
  const command = input.value.trim();
  if (!command) return;
  input.value = '';

  const session = state.terminalSessions.find((item) => item.id === state.activeTerminalSession);
  if (session) {
    session.history.unshift(command);
    session.histIdx = -1;
  }
  await execPSCmd(command);
}

async function execPSCmd(command) {
  sv('terminal', document.querySelectorAll('#tabs .tab')[1]);
  appendTerminalPrompt(command);

  try {
    const useSync = !state.ws || state.ws.readyState !== 1;
    const result = await POST('/ps/exec', { command, sync: useSync });
    if (result.sessionId) state.psActiveSessionId = result.sessionId;
    if (result.output) result.output.forEach((line) => appendTerminalLine(ansi(line), /\[ERR\]|error|fail/i.test(line) ? 'te' : 'to'));
  } catch (error) {
    appendTerminalLine(`Error: ${error.message}`, 'te');
  }
}

function appendTerminalPrompt(command) {
  const body = getTerminalBody();
  body.insertAdjacentHTML('beforeend', `
    <div class="tl">
      <span class="tp">PS &gt;</span>
      <span class="tc2">${esc(command)}</span>
      <span class="tts">${ts()}</span>
    </div>
  `);
  body.scrollTop = body.scrollHeight;
}

function appendTerminalLine(html, className = 'to') {
  const body = getTerminalBody();
  const line = document.createElement('div');
  line.className = 'tl';
  line.innerHTML = `<span class="${className}">${html}</span>`;
  body.appendChild(line);
  body.scrollTop = body.scrollHeight;
}

function getTerminalBody() {
  return document.getElementById(`tb-${state.activeTerminalSession}`) || document.getElementById('tb-0');
}

function newTSess() {
  const id = state.nextTerminalSessionId++;
  state.terminalSessions.push({ id, label: `PS #${id + 1}`, history: [], histIdx: -1 });
  const sessionsBar = document.getElementById('tsess-bar');
  const addButton = sessionsBar.lastElementChild;

  const tab = document.createElement('div');
  tab.className = 'tsess';
  tab.id = `ts-${id}`;
  tab.innerHTML = `<span>PS #${id + 1}</span><span class="tc" onclick="event.stopPropagation();closeTSess(${id})">×</span>`;
  tab.onclick = () => switchTerminalSession(id);
  sessionsBar.insertBefore(tab, addButton);

  const body = document.createElement('div');
  body.className = 'term-body';
  body.id = `tb-${id}`;
  document.getElementById('term-bodies').appendChild(body);
  switchTerminalSession(id);
}

function switchTerminalSession(id) {
  state.activeTerminalSession = id;
  document.querySelectorAll('.tsess').forEach((item) => item.classList.remove('active'));
  document.querySelectorAll('.term-body').forEach((item) => item.classList.remove('active'));
  document.getElementById(`ts-${id}`)?.classList.add('active');
  document.getElementById(`tb-${id}`)?.classList.add('active');
}

function closeTSess(id) {
  if (state.terminalSessions.length === 1) return;
  state.terminalSessions = state.terminalSessions.filter((session) => session.id !== id);
  document.getElementById(`ts-${id}`)?.remove();
  document.getElementById(`tb-${id}`)?.remove();
  switchTerminalSession(state.terminalSessions[state.terminalSessions.length - 1].id);
}

async function killRunning() {
  try {
    const result = await GET('/ps/running');
    if (!result.sessions.length) {
      toast('No running PowerShell processes', 'info');
      return;
    }
    await Promise.all(result.sessions.map((session) => POST(`/ps/kill/${session.sessionId}`, {})));
    appendTerminalLine('[All running processes killed]', 'tok');
    toast(`Killed ${result.sessions.length} process(es)`, 'ok');
  } catch (error) {
    toast(error.message, 'err');
  }
}

async function killAll() {
  try {
    const result = await POST('/ps/killall', {});
    appendTerminalLine(`[killall: ${result.killed.length}]`, 'tok');
    toast('All PowerShell sessions stopped', 'ok');
  } catch (error) {
    toast(error.message, 'err');
  }
}

async function runActive() {
  const tab = currentTab();
  if (!tab) return;

  if (tab.mode === 'sql') {
    document.getElementById('db-sql').value = tab.content;
    sv('db', document.querySelectorAll('#tabs .tab')[2]);
    await runSQL(tab.content);
    return;
  }

  if ((tab.mode === 'javascript' || tab.mode === 'python') && !tab.path) {
    toast('Save this file to disk before running it.', 'info');
    return;
  }

  if (tab.mode === 'javascript') {
    await execPSCmd(`node "${tab.path}"`);
    return;
  }

  if (tab.mode === 'python') {
    await execPSCmd(`python "${tab.path}"`);
    return;
  }

  await execPSCmd(tab.content);
}

async function loadTables() {
  const select = document.getElementById('db-tbl');
  try {
    const result = await GET('/db/tables');
    select.innerHTML = '<option value="">— select —</option>' + result.tables.map((table) => `<option value="${esc(table)}">${esc(table)}</option>`).join('');
  } catch (error) {
    select.innerHTML = '<option value="">DB not configured</option>';
    document.getElementById('db-res').innerHTML = `<span style="color:var(--t3);font-size:13px">${esc(error.message)}</span>`;
  }
}

function quickSelect(table) {
  if (!table) return;
  document.getElementById('db-sql').value = `SELECT * FROM ${table} ORDER BY 1 DESC LIMIT 25;`;
  runSQL();
}

async function runSQL(sqlOverride) {
  const sql = (sqlOverride || document.getElementById('db-sql').value).trim();
  if (!sql) return;
  const resultEl = document.getElementById('db-res');
  resultEl.innerHTML = '<span style="color:var(--t3);font-size:13px">Running query...</span>';

  try {
    const endpoint = /^\s*(select|with)\b/i.test(sql) ? '/db/select' : '/db/query';
    const result = await POST(endpoint, { sql });
    renderQueryResults(result);
  } catch (error) {
    resultEl.innerHTML = `<span style="color:var(--red);font-size:13px">${esc(error.message)}</span>`;
  }
}

function renderQueryResults(result) {
  const rows = Array.isArray(result.rows) ? result.rows : [];
  const fields = rows[0] ? Object.keys(rows[0]) : (result.fields || []).map((field) => field.name);
  const meta = `
    <div class="db-meta">
      <span>${rows.length} row(s)</span>
      <span>${esc(result.duration || '')}</span>
      <span>${esc(result.strategy || 'direct')}</span>
    </div>
  `;

  if (!rows.length) {
    document.getElementById('db-res').innerHTML = `${meta}<span style="color:var(--t3);font-size:13px">Query succeeded but returned no rows.</span>`;
    return;
  }

  const table = `
    <table class="dbt">
      <thead><tr>${fields.map((field) => `<th>${esc(field)}</th>`).join('')}</tr></thead>
      <tbody>
        ${rows.map((row) => `
          <tr onclick="editRow(${encodeHtmlAttr(JSON.stringify(row))})">
            ${fields.map((field) => `<td>${renderCell(row[field])}</td>`).join('')}
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  document.getElementById('db-res').innerHTML = meta + table;
}

function renderCell(value) {
  if (value === null || value === undefined) return '<span class="db-null">null</span>';
  if (typeof value === 'object') return esc(JSON.stringify(value));
  return esc(String(value));
}

async function showInsertForm() {
  const table = document.getElementById('db-tbl').value;
  if (!table) {
    toast('Select a table first', 'info');
    return;
  }
  const raw = prompt(`Insert JSON row into ${table}`, '{"name":"example"}');
  if (!raw) return;
  try {
    const row = JSON.parse(raw);
    await POST('/db/insert', { table, rows: [row] });
    toast('Row inserted', 'ok');
    quickSelect(table);
  } catch (error) {
    toast(error.message, 'err');
  }
}

async function editRow(row) {
  const table = document.getElementById('db-tbl').value;
  if (!table || row.id === undefined) return;
  const raw = prompt(`Edit row ${row.id} as JSON`, JSON.stringify(row, null, 2));
  if (!raw) return;
  try {
    const updated = JSON.parse(raw);
    await POST('/db/update', { table, id: row.id, data: updated });
    toast('Row updated', 'ok');
    quickSelect(table);
  } catch (error) {
    toast(error.message, 'err');
  }
}

function setSortProc(sort) {
  state.activeSortProc = sort === 'ram' ? 'mem' : sort;
  refreshMonitor();
}

async function refreshMonitor() {
  try {
    const [system, processes] = await Promise.all([
      GET('/monitor/system'),
      GET(`/monitor/processes?sort=${encodeURIComponent(state.activeSortProc)}&limit=35`)
    ]);

    document.getElementById('sys-cpu').textContent = `${Math.round(system.cpu_pct || 0)}%`;
    document.getElementById('sys-ram').textContent = `${system.ram_used_gb || 0} GB`;
    document.getElementById('sys-ramf').textContent = `${system.ram_free_gb || 0} GB`;
    const preferredDisk = (system.disks || []).find((disk) => disk.Name === 'C') || (system.disks || [])[0];
    document.querySelector('#sys-disk-c .sysc-val').textContent = preferredDisk ? `${preferredDisk.Free_GB} GB` : '—';
    document.querySelector('#sys-disk-c .sysc-lbl').textContent = preferredDisk ? `${preferredDisk.Name}: Free` : 'Disk Free';
    document.getElementById('mon-ts').textContent = `updated ${new Date().toLocaleTimeString()}`;

    document.getElementById('proc-body').innerHTML = (processes.processes || []).map((proc) => {
      const cpu = Number(proc.CPU || 0);
      const ram = Number(proc.RAM_MB || 0);
      return `
        <tr>
          <td>${esc(proc.Name)}</td>
          <td>${esc(String(proc.Id))}</td>
          <td>${cpu.toFixed(1)}</td>
          <td><div style="width:100px;height:8px;background:rgba(255,255,255,.06);border-radius:999px;overflow:hidden"><div style="width:${Math.min(100, cpu)}%;height:100%;background:var(--ac)"></div></div></td>
          <td>${ram.toFixed(1)}</td>
          <td>${esc(String(proc.Threads || 0))}</td>
          <td><button class="proc-kill" onclick="killPid(${proc.Id})">Kill</button></td>
        </tr>
      `;
    }).join('');
  } catch (error) {
    document.getElementById('proc-body').innerHTML = `<tr><td colspan="7" style="color:var(--red)">${esc(error.message)}</td></tr>`;
  }
}

async function killPid(pid) {
  try {
    await POST('/monitor/kill', { pid });
    toast(`Killed PID ${pid}`, 'ok');
    refreshMonitor();
  } catch (error) {
    toast(error.message, 'err');
  }
}

async function loadLogFiles() {
  try {
    const files = await GET('/logs/files');
    const select = document.getElementById('log-file-sel');
    if (!files.length) {
      select.innerHTML = '<option value="">No log files found</option>';
      return;
    }
    select.innerHTML = files.map((file) => `<option value="${esc(file.path)}">${esc(file.name)}</option>`).join('');
    if (!state.logFile) state.logFile = files[0].path;
    select.value = state.logFile;
  } catch (error) {
    document.getElementById('log-body').textContent = error.message;
  }
}

function switchLogFile(path) {
  state.logFile = path;
  if (state.activeView === 'logs') startLogStream();
}

function clearLogView() {
  document.getElementById('log-body').textContent = '';
}

function scrollLogBottom() {
  const body = document.getElementById('log-body');
  body.scrollTop = body.scrollHeight;
}

function startLogStream() {
  if (!state.logFile) return;
  if (state.logStream) state.logStream.close();

  const body = document.getElementById('log-body');
  body.textContent = '';
  document.getElementById('log-status').textContent = 'connecting...';

  state.logStream = new EventSource(`${API}/logs/stream?path=${encodeURIComponent(state.logFile)}&tail=80`);
  state.logStream.onmessage = (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch (_) {
      return;
    }

    if (payload.type === 'history' || payload.type === 'reset') {
      body.textContent = (payload.lines || []).join('\n');
    } else if (payload.type === 'line') {
      body.textContent += `${body.textContent ? '\n' : ''}${payload.line}`;
    } else if (payload.type === 'error') {
      body.textContent = payload.message;
    }

    document.getElementById('log-status').textContent = 'live';
    body.scrollTop = body.scrollHeight;
  };

  state.logStream.onerror = () => {
    document.getElementById('log-status').textContent = 'offline';
  };
}

async function loadOpsDashboard() {
  const tasksRoot = document.getElementById('ops-tasks');
  const runbooksRoot = document.getElementById('ops-runbooks');
  const policiesRoot = document.getElementById('ops-policies');
  const diagRoot = document.getElementById('ops-diag');
  const auditRoot = document.getElementById('ops-audit');
  const statsRoot = document.getElementById('ops-stats');
  if (!tasksRoot || !runbooksRoot || !policiesRoot || !diagRoot || !auditRoot || !statsRoot) return;

  try {
    const filter = document.getElementById('ops-filter')?.value || '';
    const [overview, taskData, runbookData, policyData] = await Promise.all([
      GET('/ops/overview'),
      GET(`/ops/tasks${filter ? `?status=${encodeURIComponent(filter)}` : ''}`),
      GET('/ops/runbooks'),
      GET('/ops/policies')
    ]);

    state.opsRunbooks = runbookData.runbooks || overview.runbooks || [];
    state.opsPolicies = policyData || overview.policies || {};
    renderOpsStats(overview.counts, overview.diagnosticsSummary);
    renderOpsTasks(taskData.tasks || []);
    renderOpsRunbooks(state.opsRunbooks);
    renderOpsPolicies(state.opsPolicies);
    renderOpsDiagnostics(overview.diagnostics || []);
    renderOpsAudit(overview.audit || []);
    document.getElementById('ops-sync').textContent = `updated ${new Date().toLocaleTimeString()}`;
  } catch (error) {
    statsRoot.innerHTML = '';
    tasksRoot.innerHTML = `<div class="ops-empty" style="color:var(--red)">${esc(error.message)}</div>`;
    runbooksRoot.innerHTML = '';
    policiesRoot.innerHTML = '';
    diagRoot.innerHTML = '';
    auditRoot.innerHTML = '';
  }
}

function renderOpsStats(counts = {}, diagnosticsSummary = {}) {
  const stats = [
    ['Total', counts.total || 0],
    ['Runbooks', counts.runbooks || state.opsRunbooks.length || 0],
    ['Policy gates', (state.opsPolicies.requireApprovalForTypes || []).length || 0],
    ['Pending', counts.pending_approval || 0],
    ['Approved', counts.approved || 0],
    ['Running', counts.running || 0],
    ['Completed', counts.completed || 0],
    ['Failed', counts.failed || 0],
    ['Diag OK', diagnosticsSummary.ok || 0],
    ['Diag Warn', diagnosticsSummary.warn || 0]
  ];

  document.getElementById('ops-stats').innerHTML = stats.map(([label, value]) => `
    <div class="ops-stat">
      <div class="ops-stat-val">${esc(String(value))}</div>
      <div class="ops-stat-lbl">${esc(label)}</div>
    </div>
  `).join('');
}

function renderOpsTasks(tasks = []) {
  const root = document.getElementById('ops-tasks');
  if (!tasks.length) {
    root.innerHTML = '<div class="ops-empty">No ops tasks yet.</div>';
    return;
  }

  root.innerHTML = tasks.map((task) => {
    const resultPreview = task.lastRun?.error
      ? `Error: ${task.lastRun.error}`
      : task.lastRun?.result
        ? JSON.stringify(task.lastRun.result, null, 2).slice(0, 1200)
        : '';
    return `
      <div class="ops-task">
        <div class="ops-task-hdr">
          <div>
            <div class="ops-task-title">${esc(task.title)}</div>
            <div class="ops-task-meta">
              ${opsBadge(task.status, taskStatusTone(task.status))}
              ${opsBadge(task.risk || 'medium', taskRiskTone(task.risk))}
              ${opsBadge(task.targetAgent || 'AUTO', 'info')}
              ${task.executable ? (task.requiresApproval ? opsBadge('approval', 'warn') : opsBadge('auto', 'ok')) : opsBadge('plan-only', 'info')}
            </div>
          </div>
          <div class="ops-inline-note">${esc(fmtDateTime(task.updatedAt || task.createdAt))}</div>
        </div>
        <div class="ops-task-summary">${esc(task.summary || '')}</div>
        ${task.command ? `<div class="ops-task-code">${esc(task.command)}</div>` : ''}
        ${task.parsed ? `<div class="ops-inline-note" style="margin-top:8px">Parsed as ${esc(task.parsed.type || 'unknown')} via ${esc(task.parsed.agentId || task.targetAgent || 'AUTO')}.</div>` : '<div class="ops-inline-note" style="margin-top:8px">No executable command was captured, so this task is stored as planning context only.</div>'}
        ${task.metadata?.runbookTitle ? `<div class="ops-inline-note" style="margin-top:6px">Created from runbook: ${esc(task.metadata.runbookTitle)}</div>` : ''}
        ${task.decision ? `<div class="ops-inline-note" style="margin-top:6px">Decision: ${esc(task.decision.decision)} by ${esc(task.decision.by || 'operator')}${task.decision.note ? ` — ${esc(task.decision.note)}` : ''}</div>` : ''}
        ${resultPreview ? `<div class="ops-task-code">${esc(resultPreview)}</div>` : ''}
        <div class="ops-actions">
          ${task.requiresApproval && ['pending_approval', 'completed', 'failed'].includes(task.status) ? `<button class="btn sm" onclick="approveOpsTask('${escapeJs(task.id)}')">${task.status === 'pending_approval' ? 'Approve' : 'Approve Again'}</button><button class="btn sm danger" onclick="rejectOpsTask('${escapeJs(task.id)}')">Reject</button>` : ''}
          ${task.executable && (task.status === 'approved' || (!task.requiresApproval && !['running', 'rejected'].includes(task.status))) ? `<button class="btn sm primary" onclick="runOpsTaskAction('${escapeJs(task.id)}')">${task.lastRun ? 'Run Again' : 'Run'}</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function renderOpsRunbooks(runbooks = []) {
  const root = document.getElementById('ops-runbooks');
  if (!runbooks.length) {
    root.innerHTML = '<div class="ops-empty">No runbooks available yet.</div>';
    return;
  }

  root.innerHTML = runbooks.map((runbook) => `
    <div class="ops-task">
      <div class="ops-task-hdr">
        <div>
          <div class="ops-task-title">${esc(runbook.title)}</div>
          <div class="ops-task-meta">
            ${opsBadge(runbook.builtin ? 'builtin' : 'custom', runbook.builtin ? 'info' : 'ok')}
            ${opsBadge(runbook.targetAgent || 'AUTO', 'info')}
            ${opsBadge(runbook.risk || 'medium', taskRiskTone(runbook.risk))}
            ${runbook.requiresApproval ? opsBadge('approval', 'warn') : opsBadge('auto', 'ok')}
          </div>
        </div>
        <div class="ops-inline-note">${esc(fmtDateTime(runbook.updatedAt || runbook.createdAt))}</div>
      </div>
      <div class="ops-task-summary">${esc(runbook.summary || '')}</div>
      ${runbook.command ? `<div class="ops-task-code">${esc(runbook.command)}</div>` : ''}
      ${Array.isArray(runbook.tags) && runbook.tags.length ? `<div class="ops-task-meta" style="margin-top:8px">${runbook.tags.map((tag) => opsBadge(tag, 'info')).join('')}</div>` : ''}
      <div class="ops-inline-note" style="margin-top:8px">Last used: ${esc(fmtDateTime(runbook.lastUsedAt))}</div>
      <div class="ops-actions">
        <button class="btn sm" onclick="applyOpsRunbook('${escapeJs(runbook.id)}')">Use Template</button>
        <button class="btn sm primary" onclick="queueOpsRunbook('${escapeJs(runbook.id)}')">Queue Task</button>
        ${runbook.builtin ? '' : `<button class="btn sm danger" onclick="deleteOpsRunbookAction('${escapeJs(runbook.id)}')">Delete</button>`}
      </div>
    </div>
  `).join('');
}

function renderOpsPolicies(policies = {}) {
  const root = document.getElementById('ops-policies');
  if (!root) return;

  root.innerHTML = `
    <div class="ops-form-row">
      <label for="ops-pol-profile">Profile</label>
      <input class="ops-inp" id="ops-pol-profile" value="${escAttr(policies.profile || 'balanced')}" placeholder="balanced">
    </div>
    <label class="ops-check"><input type="checkbox" id="ops-pol-custom-runbooks" ${policies.allowCustomRunbooks !== false ? 'checked' : ''}> Allow custom runbooks</label>
    <label class="ops-check"><input type="checkbox" id="ops-pol-delete-runbooks" ${policies.allowRunbookDeletion !== false ? 'checked' : ''}> Allow custom runbook deletion</label>
    <div class="ops-form-row">
      <label for="ops-pol-approval-types">Always require approval for task types</label>
      <input class="ops-inp" id="ops-pol-approval-types" value="${escAttr((policies.requireApprovalForTypes || []).join(', '))}" placeholder="ps, sql, code">
    </div>
    <div class="ops-form-row">
      <label for="ops-pol-blocked-types">Blocked task types</label>
      <input class="ops-inp" id="ops-pol-blocked-types" value="${escAttr((policies.blockedTaskTypes || []).join(', '))}" placeholder="fs, claw">
    </div>
    <div class="ops-form-row">
      <label for="ops-pol-blocked-fs">Blocked filesystem operations</label>
      <input class="ops-inp" id="ops-pol-blocked-fs" value="${escAttr((policies.blockedFsOperations || []).join(', '))}" placeholder="delete">
    </div>
    <div class="ops-form-row">
      <label for="ops-pol-blocked-claw">Blocked OpenClaw actions</label>
      <input class="ops-inp" id="ops-pol-blocked-claw" value="${escAttr((policies.blockedClawActions || []).join(', '))}" placeholder="send_message">
    </div>
    <div class="ops-form-row">
      <label for="ops-pol-notes">Policy notes</label>
      <textarea class="ops-ta" id="ops-pol-notes" placeholder="Explain why these governance rules exist.">${escText(policies.notes || '')}</textarea>
    </div>
    <div class="ops-form-actions">
      <button class="btn primary" onclick="saveOpsPolicies()">Save Policies</button>
      <button class="btn" onclick="loadOpsDashboard()">Reload Policies</button>
    </div>
  `;
}

function renderOpsDiagnostics(checks = []) {
  const root = document.getElementById('ops-diag');
  if (!checks.length) {
    root.innerHTML = '<div class="ops-empty">No diagnostics available.</div>';
    return;
  }

  root.innerHTML = checks.map((check) => `
    <div class="ops-diag-item">
      <div class="ops-diag-hdr">
        <div class="ops-diag-title">${esc(check.label)}</div>
        ${opsBadge(check.status || 'warn', diagTone(check.status))}
      </div>
      <div class="ops-diag-detail">${esc(check.detail || '')}</div>
    </div>
  `).join('');
}

function renderOpsAudit(audit = []) {
  const root = document.getElementById('ops-audit');
  if (!audit.length) {
    root.innerHTML = '<div class="ops-empty">No audit events yet.</div>';
    return;
  }

  root.innerHTML = audit.map((entry) => `
    <div class="ops-audit-item">
      <div class="ops-audit-hdr">
        <div class="ops-diag-title">${esc(entry.type)}</div>
        <div class="ops-inline-note">${esc(fmtDateTime(entry.createdAt))}</div>
      </div>
      <div class="ops-audit-detail">${esc(JSON.stringify(entry.detail || {}, null, 2))}</div>
    </div>
  `).join('');
}

async function createOpsTaskFromForm() {
  const title = document.getElementById('ops-title').value.trim();
  const summary = document.getElementById('ops-summary').value.trim();
  const command = document.getElementById('ops-command').value.trim();
  const targetAgent = document.getElementById('ops-agent').value;
  const requestedBy = document.getElementById('ops-requested-by').value.trim() || 'operator';
  const requiresApproval = document.getElementById('ops-approval').checked;

  if (!title) {
    toast('Ops task title is required', 'info');
    return;
  }
  if (!summary && !command) {
    toast('Add a summary or command for the ops task', 'info');
    return;
  }

  try {
    await POST('/ops/tasks', { title, summary, command, targetAgent, requestedBy, requiresApproval });
    document.getElementById('ops-title').value = '';
    document.getElementById('ops-summary').value = '';
    document.getElementById('ops-command').value = '';
    document.getElementById('ops-approval').checked = true;
    toast('Ops task created', 'ok');
    await loadOpsDashboard();
  } catch (error) {
    toast(error.message, 'err');
  }
}

async function createOpsRunbookFromForm() {
  const title = document.getElementById('ops-title').value.trim();
  const summary = document.getElementById('ops-summary').value.trim();
  const command = document.getElementById('ops-command').value.trim();
  const targetAgent = document.getElementById('ops-agent').value;
  const createdBy = document.getElementById('ops-requested-by').value.trim() || 'operator';
  const requiresApproval = document.getElementById('ops-approval').checked;
  const tags = document.getElementById('ops-tags').value.trim();

  if (!title) {
    toast('Runbook title is required', 'info');
    return;
  }
  if (!command) {
    toast('Runbooks need a reusable command or instruction', 'info');
    return;
  }

  try {
    await POST('/ops/runbooks', { title, summary, command, targetAgent, createdBy, requiresApproval, tags });
    document.getElementById('ops-tags').value = '';
    toast('Runbook saved', 'ok');
    await loadOpsDashboard();
  } catch (error) {
    toast(error.message, 'err');
  }
}

async function approveOpsTask(taskId) {
  const reviewedBy = document.getElementById('ops-requested-by').value.trim() || 'operator';
  const note = prompt('Approval note (optional)', '') ?? '';
  try {
    await POST(`/ops/tasks/${encodeURIComponent(taskId)}/approve`, { reviewedBy, note });
    toast('Task approved', 'ok');
    await loadOpsDashboard();
  } catch (error) {
    toast(error.message, 'err');
  }
}

async function rejectOpsTask(taskId) {
  const reviewedBy = document.getElementById('ops-requested-by').value.trim() || 'operator';
  const note = prompt('Rejection reason', '') ?? '';
  try {
    await POST(`/ops/tasks/${encodeURIComponent(taskId)}/reject`, { reviewedBy, note });
    toast('Task rejected', 'ok');
    await loadOpsDashboard();
  } catch (error) {
    toast(error.message, 'err');
  }
}

async function runOpsTaskAction(taskId) {
  const requestedBy = document.getElementById('ops-requested-by').value.trim() || 'operator';
  try {
    await POST(`/ops/tasks/${encodeURIComponent(taskId)}/run`, { requestedBy });
    toast('Task run completed', 'ok');
  } catch (error) {
    toast(error.message, 'err');
  }
  await loadOpsDashboard();
}

function applyOpsRunbook(runbookId) {
  const runbook = state.opsRunbooks.find((entry) => entry.id === runbookId);
  if (!runbook) {
    toast('Runbook not found', 'err');
    return;
  }

  document.getElementById('ops-title').value = runbook.title || '';
  document.getElementById('ops-summary').value = runbook.summary || '';
  document.getElementById('ops-command').value = runbook.command || '';
  document.getElementById('ops-agent').value = runbook.targetAgent || 'AUTO';
  document.getElementById('ops-approval').checked = Boolean(runbook.requiresApproval);
  document.getElementById('ops-tags').value = Array.isArray(runbook.tags) ? runbook.tags.join(', ') : '';
  toast(`Loaded runbook: ${runbook.title}`, 'ok');
}

async function queueOpsRunbook(runbookId) {
  const requestedBy = document.getElementById('ops-requested-by').value.trim() || 'operator';
  try {
    await POST(`/ops/runbooks/${encodeURIComponent(runbookId)}/instantiate`, { requestedBy });
    toast('Runbook queued as task', 'ok');
    await loadOpsDashboard();
  } catch (error) {
    toast(error.message, 'err');
  }
}

async function deleteOpsRunbookAction(runbookId) {
  const runbook = state.opsRunbooks.find((entry) => entry.id === runbookId);
  if (!runbook) {
    toast('Runbook not found', 'err');
    return;
  }
  if (!confirm(`Delete runbook "${runbook.title}"?`)) return;

  const deletedBy = document.getElementById('ops-requested-by').value.trim() || 'operator';
  try {
    await fetch(`${API}/ops/runbooks/${encodeURIComponent(runbookId)}?deletedBy=${encodeURIComponent(deletedBy)}`, { method: 'DELETE' })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
        return body;
      });
    toast('Runbook deleted', 'ok');
    await loadOpsDashboard();
  } catch (error) {
    toast(error.message, 'err');
  }
}

async function saveOpsPolicies() {
  const updatedBy = document.getElementById('ops-requested-by').value.trim() || 'operator';

  try {
    const policies = await PUT('/ops/policies', {
      updatedBy,
      profile: document.getElementById('ops-pol-profile').value.trim() || 'balanced',
      allowCustomRunbooks: document.getElementById('ops-pol-custom-runbooks').checked,
      allowRunbookDeletion: document.getElementById('ops-pol-delete-runbooks').checked,
      requireApprovalForTypes: document.getElementById('ops-pol-approval-types').value.trim(),
      blockedTaskTypes: document.getElementById('ops-pol-blocked-types').value.trim(),
      blockedFsOperations: document.getElementById('ops-pol-blocked-fs').value.trim(),
      blockedClawActions: document.getElementById('ops-pol-blocked-claw').value.trim(),
      notes: document.getElementById('ops-pol-notes').value.trim()
    });
    state.opsPolicies = policies;
    toast('Policies saved', 'ok');
    await loadOpsDashboard();
  } catch (error) {
    toast(error.message, 'err');
  }
}

function opsBadge(label, tone) {
  return `<span class="ops-badge ${tone}">${esc(label)}</span>`;
}

function escAttr(value) {
  return esc(String(value ?? '')).replace(/"/g, '&quot;');
}

function escText(value) {
  return esc(String(value ?? ''));
}

function taskStatusTone(status) {
  if (status === 'completed' || status === 'approved') return 'ok';
  if (status === 'pending_approval' || status === 'running') return 'warn';
  if (status === 'failed' || status === 'rejected') return 'err';
  return 'info';
}

function taskRiskTone(risk) {
  if (risk === 'low') return 'ok';
  if (risk === 'medium') return 'warn';
  return 'err';
}

function diagTone(status) {
  if (status === 'ok') return 'ok';
  if (status === 'fail') return 'err';
  return 'warn';
}

function fmtDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function openCfg() {
  document.getElementById('cfg-modal').classList.remove('hidden');
  await loadCfg();
}

function closeCfg() {
  document.getElementById('cfg-modal').classList.add('hidden');
}

function closeWizard() {
  document.getElementById('wizard').classList.add('hidden');
}

async function loadCfg() {
  try {
    const cfg = await GET('/config');
    setCfgStatus('cs-ant', cfg.status.WORKSPACE_ROOT?.configured);
    setCfgStatus('cs-su', cfg.status.SUPABASE_URL?.configured);
    setCfgStatus('cs-sa', cfg.status.SUPABASE_ANON_KEY?.configured);
    setCfgStatus('cs-ss', cfg.status.SUPABASE_SERVICE_KEY?.configured);
    setCfgStatus('cs-sd', cfg.status.SUPABASE_DB_URL?.configured);
    setCfgStatus('cs-cr', cfg.status.OPENCLAW_RELAY_URL?.configured);
    document.getElementById('ci-ant').value = state.workspaceRoot || '';
  } catch (error) {
    toast(error.message, 'err');
  }
}

function setCfgStatus(id, ready) {
  const dot = document.getElementById(id);
  if (!dot) return;
  dot.className = `cs ${ready ? 'd-ok' : 'd-idle'}`;
}

async function saveCfg() {
  const pairs = {};
  if (document.getElementById('ci-ant').value.trim()) pairs.WORKSPACE_ROOT = document.getElementById('ci-ant').value.trim();
  if (document.getElementById('ci-su').value.trim()) pairs.SUPABASE_URL = document.getElementById('ci-su').value.trim();
  if (document.getElementById('ci-sa').value.trim()) pairs.SUPABASE_ANON_KEY = document.getElementById('ci-sa').value.trim();
  if (document.getElementById('ci-ss').value.trim()) pairs.SUPABASE_SERVICE_KEY = document.getElementById('ci-ss').value.trim();
  if (document.getElementById('ci-sd').value.trim()) pairs.SUPABASE_DB_URL = document.getElementById('ci-sd').value.trim();
  if (document.getElementById('ci-cr').value.trim()) pairs.OPENCLAW_RELAY_URL = document.getElementById('ci-cr').value.trim();
  if (document.getElementById('ci-ct').value.trim()) pairs.OPENCLAW_GATEWAY_TOKEN = document.getElementById('ci-ct').value.trim();

  try {
    await POST('/config/bulk', { pairs });
    if (pairs.WORKSPACE_ROOT) state.workspaceRoot = pairs.WORKSPACE_ROOT;
    toast('Settings saved', 'ok');
    closeCfg();
    await checkHealth();
    await loadTables();
    await loadLogFiles();
  } catch (error) {
    toast(error.message, 'err');
  }
}

async function saveWizard() {
  const pairs = {};
  if (document.getElementById('wiz-key').value.trim()) pairs.WORKSPACE_ROOT = document.getElementById('wiz-key').value.trim();
  if (document.getElementById('wiz-sb-url').value.trim()) pairs.SUPABASE_URL = document.getElementById('wiz-sb-url').value.trim();
  if (document.getElementById('wiz-sb-key').value.trim()) pairs.SUPABASE_SERVICE_KEY = document.getElementById('wiz-sb-key').value.trim();

  try {
    await POST('/config/bulk', { pairs });
    closeWizard();
    toast('Setup saved', 'ok');
    await checkHealth();
    await browseDir(state.workspaceRoot);
  } catch (error) {
    toast(error.message, 'err');
  }
}

async function saveSession() {
  try {
    await POST('/sessions', {
      sessionId: state.session.id,
      messages: state.session.messages,
      title: state.session.messages.find((message) => message.role === 'user')?.content?.slice(0, 60) || 'Executionor Session'
    });
    toast('Session saved', 'ok');
    await loadSessionList();
  } catch (error) {
    toast(error.message, 'err');
  }
}

async function loadSessionList() {
  try {
    state.savedSessions = await GET('/sessions');
  } catch (_) {
    state.savedSessions = [];
  }
}

function newSession() {
  state.session = createSession();
  document.getElementById('stream').innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--t3);font-size:13px">New local session started.</div>';
  toast('Started a new session', 'info');
}

function openPalette(mode = 'commands', seed = '') {
  state.paletteMode = mode;
  document.getElementById('palette').classList.remove('hidden');
  const input = document.getElementById('pal-inp');
  input.value = seed;
  input.placeholder = mode === 'files' ? 'Search files in the workspace...' : 'Search commands, sessions, files, or tables...';
  renderPaletteItems(buildPaletteItems(seed));
  input.focus();
  input.select();
}

function closePalette() {
  document.getElementById('palette').classList.add('hidden');
}

function buildPaletteItems(query = '') {
  const lower = query.toLowerCase();

  if (state.paletteMode === 'files') {
    if (!query.trim()) return [];
    searchFiles(query);
    return state.paletteItems;
  }

  const commands = [
    { label: 'Open Settings', action: () => openCfg() },
    { label: 'Browse Workspace Root', action: () => browseDir(state.workspaceRoot) },
    { label: 'Refresh Monitor', action: () => refreshMonitor() },
    { label: 'Start New Session', action: () => newSession() },
    { label: 'Save Current Session', action: () => saveSession() },
    { label: 'Open Logs View', action: () => sv('logs', document.querySelectorAll('#tabs .tab')[5]) },
    { label: 'Open Ops Control Plane', action: () => sv('ops', document.querySelectorAll('#tabs .tab')[6]) }
  ];

  const sessions = state.savedSessions.map((session) => ({
    label: `Session: ${session.title || session.id}`,
    action: () => restoreSession(session.id)
  }));

  const files = state.tabs.map((tab, index) => ({
    label: `Editor: ${tab.name}`,
    action: () => activateEditorTab(index)
  }));

  return [...commands, ...sessions, ...files].filter((item) => !lower || item.label.toLowerCase().includes(lower));
}

async function searchFiles(query) {
  try {
    const result = await GET(`/fs/search?path=${encodeURIComponent(state.fileTreePath || state.workspaceRoot)}&query=${encodeURIComponent(query)}`);
    const items = result.results.map((item) => ({
      label: item.path,
      action: () => openFromFS(item.path)
    }));
    renderPaletteItems(items);
  } catch (error) {
    renderPaletteItems([{ label: error.message, action: () => {} }]);
  }
}

function renderPaletteItems(items) {
  state.paletteItems = items;
  state.paletteSelection = 0;
  const root = document.getElementById('pal-results');
  if (!items.length) {
    root.innerHTML = '<div class="pal-item sel">No matches</div>';
    return;
  }
  root.innerHTML = items.map((item, index) => `<div class="pal-item ${index === state.paletteSelection ? 'sel' : ''}" onclick="runPaletteItem(${index})">${esc(item.label)}</div>`).join('');
}

function palSearch(value) {
  renderPaletteItems(buildPaletteItems(value));
}

function palKey(event) {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    state.paletteSelection = Math.min(state.paletteItems.length - 1, state.paletteSelection + 1);
    refreshPaletteSelection();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    state.paletteSelection = Math.max(0, state.paletteSelection - 1);
    refreshPaletteSelection();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    runPaletteItem(state.paletteSelection);
  } else if (event.key === 'Escape') {
    closePalette();
  }
}

function refreshPaletteSelection() {
  document.querySelectorAll('#pal-results .pal-item').forEach((item, index) => {
    item.classList.toggle('sel', index === state.paletteSelection);
  });
}

function runPaletteItem(index) {
  const item = state.paletteItems[index];
  if (!item) return;
  closePalette();
  item.action();
}

function openFileSearch() {
  openPalette('files');
}

async function restoreSession(id) {
  try {
    const session = await GET(`/sessions/${encodeURIComponent(id)}`);
    state.session = {
      id: session.id,
      createdAt: session.createdAt,
      messages: session.messages || []
    };
    const stream = document.getElementById('stream');
    stream.innerHTML = '';
    for (const message of state.session.messages) {
      if (message.role === 'user') bubble('You', null, message.content, true);
      else {
        const agent = getAgentMeta(message.agentId);
        bubble(agent.name, agent, typeof message.content === 'string' ? message.content : JSON.stringify(message.content, null, 2));
      }
    }
    toast('Session restored', 'ok');
  } catch (error) {
    toast(error.message, 'err');
  }
}

async function saveFile() {
  const tab = currentTab();
  const blob = new Blob([tab.content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = tab.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function writeFileback() {
  const tab = currentTab();
  const defaultPath = tab.path || joinClientPath(state.workspaceRoot, tab.name);
  const path = tab.path || prompt('Save to path', defaultPath);
  if (!path) return;

  try {
    await POST('/fs/write', { path, content: tab.content });
    tab.path = path;
    tab.name = path.split(/[\\/]/).pop();
    tab.dirty = false;
    renderEditorTabs();
    toast(`Saved ${tab.name}`, 'ok');
    if (state.fileTreePath) await browseDir(state.fileTreePath);
  } catch (error) {
    toast(error.message, 'err');
  }
}

function bubble(name, agent, content, isUser = false) {
  const meta = agent || { orb: 'o-sh', emoji: isUser ? '🙂' : '✦' };
  document.getElementById('stream').insertAdjacentHTML('beforeend', `
    <div class="bbl ${isUser ? 'user' : ''}">
      <div class="bav ${meta.orb || 'o-sh'}">${meta.emoji || '✦'}</div>
      <div class="bbd">
        <div class="bhdr"><span>${esc(name)}</span><span class="bts">${ts()}</span></div>
        <div class="${typeof content === 'string' && content.includes('\n') ? 'bcode' : ''}">${esc(String(content))}</div>
      </div>
    </div>
  `);
  const stream = document.getElementById('stream');
  stream.scrollTop = stream.scrollHeight;
}

function toast(message, tone = 'info') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `on ${tone}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    el.className = '';
  }, 2400);
}

function ansi(text) {
  if (!text) return '';
  return esc(String(text).replace(/\x1B\[[0-9;]*m/g, ''));
}

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function encodeHtmlAttr(value) {
  return esc(value).replace(/"/g, '&quot;');
}

function escapeJs(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function ts() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function initResize() {
  const sidebar = document.getElementById('sidebar');
  const handle = document.getElementById('rh-side');
  let dragging = false;

  handle.addEventListener('mousedown', () => {
    dragging = true;
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (event) => {
    if (!dragging) return;
    const width = Math.min(420, Math.max(190, event.clientX));
    sidebar.style.width = `${width}px`;
  });

  document.addEventListener('mouseup', () => {
    dragging = false;
    document.body.style.userSelect = '';
  });
}
