import { readdir, readFile } from 'fs/promises';
import { basename, extname, isAbsolute, join, normalize } from 'path';

export const WORKSPACE_ROOT = process.cwd();
const DEFAULT_BROWSE_ROOT = WORKSPACE_ROOT;
const KNOWN_TABLES = ['properties', 'contacts', 'transactions', 'mhp_lots', 'notes'];

export const LOCAL_AGENTS = {
  SHELL: {
    id: 'SHELL',
    name: 'Shell',
    role: 'Real PowerShell Executor',
    description: 'Runs real PowerShell commands against the local machine.'
  },
  PHANTOM: {
    id: 'PHANTOM',
    name: 'Phantom',
    role: 'Filesystem Operator',
    description: 'Browses, opens, creates, and manages real files and folders.'
  },
  HYDRA: {
    id: 'HYDRA',
    name: 'Hydra',
    role: 'SQL and Data Router',
    description: 'Builds SQL against real Supabase or PostgreSQL data.'
  },
  SCRIBE: {
    id: 'SCRIBE',
    name: 'Scribe',
    role: 'Template Builder',
    description: 'Generates starter files and boilerplate without paid APIs.'
  },
  CLAW: {
    id: 'CLAW',
    name: 'Claw',
    role: 'OpenClaw Relay Operator',
    description: 'Routes status and messaging requests to the OpenClaw bridge.'
  }
};

function shorten(text = '', max = 120) {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}...` : flat;
}

function extractQuoted(command = '') {
  const match = command.match(/["']([^"']+)["']/);
  return match?.[1] || '';
}

function extractWindowsPath(command = '') {
  const quoted = extractQuoted(command);
  if (quoted && /[\\/]|^[A-Za-z]:/.test(quoted)) return quoted;

  const absolute = command.match(/[A-Za-z]:\\[^"'`\r\n]+/);
  if (absolute) return absolute[0].trim();

  const relative = command.match(/(?:\.{1,2}[\\/][^\s"'`]+|[\w .-]+[\\/][^\s"'`]+|[\w.-]+\.(?:ps1|psm1|js|mjs|cjs|json|md|txt|sql|py|html|css))/i);
  return relative?.[0]?.trim() || '';
}

function resolvePath(inputPath = '', fallback = DEFAULT_BROWSE_ROOT) {
  if (!inputPath) return fallback;
  const cleaned = inputPath.replace(/^["']|["']$/g, '').trim();
  return normalize(isAbsolute(cleaned) ? cleaned : join(fallback, cleaned));
}

function inferAgent(command = '') {
  const lower = command.toLowerCase();
  if (/\b(openclaw|relay|channel|bridge|send message)\b/.test(lower)) return 'CLAW';
  if (/\b(sql|table|database|supabase|schema|select |insert |update |delete |from )\b/i.test(command)) return 'HYDRA';
  if (/\b(file|folder|directory|read |open |browse |find file|search file|rename |delete file|mkdir|touch )\b/.test(lower)) return 'PHANTOM';
  if (/\b(create|generate|scaffold|boilerplate|component|template|write code|starter)\b/.test(lower)) return 'SCRIBE';
  return 'SHELL';
}

function looksLikePowerShell(command = '') {
  return /^\s*(\$|Get-|Set-|New-|Remove-|Start-|Stop-|Invoke-|Test-|Select-|Where-|ForEach-|Write-|cd\s|dir\s|ls\s|cat\s|type\s|git\s|npm\s|node\s|pnpm\s|yarn\s|npx\s|pwsh\s|powershell\.exe\s|\.\\|&\s|[A-Za-z]:\\)/i.test(command)
    || /[|;{}]/.test(command);
}

function escapePS(text = '') {
  return String(text).replace(/'/g, "''");
}

function parseNumber(command = '', fallback = 25) {
  const match = command.match(/\b(?:limit|top|first)\s+(\d+)\b/i);
  return match ? Number.parseInt(match[1], 10) : fallback;
}

function inferTable(command = '') {
  const lower = command.toLowerCase();
  return KNOWN_TABLES.find((table) => lower.includes(table)) || '';
}

function buildShellAction(command) {
  const trimmed = command.trim();
  const lower = trimmed.toLowerCase();
  const path = resolvePath(extractWindowsPath(trimmed), WORKSPACE_ROOT);

  if (looksLikePowerShell(trimmed)) {
    return {
      type: 'ps',
      command: trimmed,
      explanation: 'Running the PowerShell you entered directly on this machine.'
    };
  }

  if (/\b(current dir|current directory|where am i|pwd)\b/.test(lower)) {
    return { type: 'ps', command: 'Get-Location', explanation: 'Showing the current working directory.' };
  }
  if (/\b(list|show|browse).*\b(files|folders|directory|tree)\b/.test(lower)) {
    return {
      type: 'ps',
      command: `Get-ChildItem -Force '${escapePS(path)}' | Sort-Object PSIsContainer -Descending, Name | Format-Table Mode,LastWriteTime,Length,Name -AutoSize`,
      explanation: `Listing real files from ${path}.`
    };
  }
  if (/\b(processes|running processes|tasks)\b/.test(lower)) {
    return {
      type: 'ps',
      command: "Get-Process | Sort-Object CPU -Descending | Select-Object -First 25 Name,Id,@{N='CPU';E={[math]::Round($_.CPU,1)}},@{N='RAM_MB';E={[math]::Round($_.WorkingSet/1MB,1)}} | Format-Table -AutoSize",
      explanation: 'Showing the live process list from Windows.'
    };
  }
  if (/\b(ports|listening ports|open ports|tcp)\b/.test(lower)) {
    return {
      type: 'ps',
      command: 'Get-NetTCPConnection -State Listen | Sort-Object LocalPort | Format-Table LocalAddress,LocalPort,OwningProcess,State -AutoSize',
      explanation: 'Showing live listening ports from the host machine.'
    };
  }
  if (/\b(cpu|memory|ram|system info|disk usage)\b/.test(lower)) {
    return {
      type: 'ps',
      command: "$cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average; $os = Get-CimInstance Win32_OperatingSystem; $drives = Get-PSDrive -PSProvider FileSystem | Select-Object Name,@{N='UsedGB';E={[math]::Round($_.Used/1GB,1)}},@{N='FreeGB';E={[math]::Round($_.Free/1GB,1)}}; Write-Host ('CPU: ' + $cpu + '%'); Write-Host ('RAM Used: ' + [math]::Round((($os.TotalVisibleMemorySize - $os.FreePhysicalMemory)/1MB),2) + ' GB'); $drives | Format-Table -AutoSize",
      explanation: 'Gathering live CPU, RAM, and disk information.'
    };
  }
  if (/\bgit status\b/.test(lower)) {
    return { type: 'ps', command: 'git status --short --branch', explanation: 'Showing the current git status.' };
  }
  if (/\bgit log\b/.test(lower)) {
    return { type: 'ps', command: 'git log --oneline -10', explanation: 'Showing the latest git commits.' };
  }
  if (/\bnpm install\b/.test(lower)) {
    return { type: 'ps', command: 'npm install', explanation: 'Installing dependencies with npm.' };
  }
  if (/\bnpm (run )?(dev|start|build|test)\b/.test(lower)) {
    const script = lower.match(/\bnpm (?:run )?(dev|start|build|test)\b/)?.[1] || 'start';
    return { type: 'ps', command: `npm run ${script}`, explanation: `Running the npm ${script} script.` };
  }
  if (/\bopen\b/.test(lower) && extractWindowsPath(trimmed)) {
    return {
      type: 'ps',
      command: `Invoke-Item '${escapePS(path)}'`,
      explanation: `Opening ${path} with the default Windows handler.`
    };
  }

  return {
    type: 'ps',
    command: trimmed,
    explanation: 'Passing your input straight to PowerShell because it already looks executable.'
  };
}

function buildFsAction(command) {
  const lower = command.toLowerCase();
  const inputPath = extractWindowsPath(command);
  const path = resolvePath(inputPath, WORKSPACE_ROOT);
  const query = extractQuoted(command) || command.match(/\bfind\s+(.+?)(?:\s+in\s+|\s*$)/i)?.[1]?.trim() || '';

  if (/\b(read|open|show file|cat|view)\b/.test(lower) && inputPath) {
    return { type: 'fs', operation: 'read', path, explanation: `Opening the real file at ${path}.` };
  }
  if (/\b(find|search)\b/.test(lower)) {
    return {
      type: 'fs',
      operation: 'find',
      path: path || WORKSPACE_ROOT,
      query: query.replace(/^["']|["']$/g, ''),
      explanation: `Searching the real workspace under ${path || WORKSPACE_ROOT}.`
    };
  }
  if (/\b(create|new)\b.*\b(folder|directory)\b/.test(lower)) {
    return { type: 'fs', operation: 'mkdir', path, explanation: `Creating the folder ${path}.` };
  }
  if (/\b(delete|remove)\b/.test(lower) && inputPath) {
    return { type: 'fs', operation: 'delete', path, explanation: `Deleting ${path} from disk.` };
  }
  if (/\brename\b/.test(lower) && inputPath) {
    const newName = command.match(/\brename\b.+?\bto\b\s+["']?([^"']+)["']?/i)?.[1]?.trim();
    return {
      type: 'fs',
      operation: 'rename',
      path,
      newName: newName || `renamed-${basename(path)}`,
      explanation: `Renaming ${path}.`
    };
  }
  if (/\b(create|new|write)\b.*\bfile\b/.test(lower) || /\b\w+\.(?:ps1|js|mjs|json|md|txt|sql|py|html|css)\b/i.test(command)) {
    const filename = inputPath || command.match(/\b([\w.-]+\.(?:ps1|js|mjs|json|md|txt|sql|py|html|css))\b/i)?.[1] || 'untitled.txt';
    const filePath = resolvePath(filename, WORKSPACE_ROOT);
    return {
      type: 'fs',
      operation: 'write',
      path: filePath,
      content: '',
      explanation: `Preparing a file write for ${filePath}.`
    };
  }

  return { type: 'fs', operation: 'list', path: path || WORKSPACE_ROOT, explanation: `Listing the real folder at ${path || WORKSPACE_ROOT}.` };
}

function buildSqlAction(command) {
  const trimmed = command.trim();
  const lower = trimmed.toLowerCase();
  const table = inferTable(trimmed);
  const limit = parseNumber(trimmed, 25);

  if (/^\s*(select|with|insert|update|delete|create|alter|drop)\b/i.test(trimmed)) {
    return {
      type: 'sql',
      table: table || '',
      query: trimmed,
      explanation: 'Running the SQL you supplied against the configured database.'
    };
  }
  if (/\b(list|show)\b.*\btables\b/.test(lower)) {
    return {
      type: 'sql',
      table: '',
      query: "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;",
      explanation: 'Listing the real public tables from the configured database.'
    };
  }
  if (/\b(schema|columns)\b/.test(lower) && table) {
    return {
      type: 'sql',
      table,
      query: `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='${table}' ORDER BY ordinal_position;`,
      explanation: `Inspecting the schema for ${table}.`
    };
  }
  if (/\b(count|how many)\b/.test(lower) && table) {
    return {
      type: 'sql',
      table,
      query: `SELECT COUNT(*) AS total FROM ${table};`,
      explanation: `Counting rows in ${table}.`
    };
  }
  if (table) {
    const status = trimmed.match(/\bstatus\s+([A-Za-z0-9_-]+)/i)?.[1];
    const city = trimmed.match(/\bcity\s+([A-Za-z .-]+)/i)?.[1]?.trim();
    const filters = [];
    if (status) filters.push(`status = '${status.replace(/'/g, "''")}'`);
    if (city) filters.push(`city = '${city.replace(/'/g, "''")}'`);
    const where = filters.length ? ` WHERE ${filters.join(' AND ')}` : '';
    return {
      type: 'sql',
      table,
      query: `SELECT * FROM ${table}${where} ORDER BY 1 DESC LIMIT ${limit};`,
      explanation: `Querying live rows from ${table}.`
    };
  }

  return {
    type: 'sql',
    table: '',
    query: "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;",
    explanation: 'No table was specified, so this will show the available database tables.'
  };
}

function buildCodeAction(command) {
  const lower = command.toLowerCase();
  const filenameMatch = command.match(/\b([\w.-]+\.(?:ps1|js|mjs|json|md|txt|sql|py|html|css))\b/i);
  const filename = filenameMatch?.[1]
    || (lower.includes('html') ? 'index.html'
      : lower.includes('css') ? 'styles.css'
      : lower.includes('python') ? 'script.py'
      : lower.includes('sql') ? 'query.sql'
      : lower.includes('markdown') ? 'notes.md'
      : lower.includes('powershell') ? 'script.ps1'
      : 'module.js');
  const ext = extname(filename).toLowerCase();
  const summary = shorten(command, 80);

  const templates = {
    '.js': `export function main() {\n  console.log('TODO: ${summary.replace(/'/g, "\\'")}');\n}\n\nif (import.meta.url === \`file://\${process.argv[1]}\`) {\n  main();\n}\n`,
    '.mjs': `export function main() {\n  console.log('TODO: ${summary.replace(/'/g, "\\'")}');\n}\n\nif (import.meta.url === \`file://\${process.argv[1]}\`) {\n  main();\n}\n`,
    '.ps1': `# ${summary}\n$ErrorActionPreference = 'Stop'\nWrite-Host \"TODO: ${summary.replace(/"/g, '\\"')}\"\n`,
    '.py': `def main():\n    print(\"TODO: ${summary.replace(/"/g, '\\"')}\")\n\n\nif __name__ == '__main__':\n    main()\n`,
    '.sql': `-- ${summary}\nSELECT NOW() AS generated_at;\n`,
    '.html': `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>${basename(filename, ext)}</title>\n</head>\n<body>\n  <main>\n    <h1>${summary}</h1>\n  </main>\n</body>\n</html>\n`,
    '.css': `:root {\n  color-scheme: dark;\n}\n\nbody {\n  margin: 0;\n  font-family: system-ui, sans-serif;\n}\n`,
    '.json': `{\n  "generatedFrom": ${JSON.stringify(summary)}\n}\n`,
    '.md': `# ${basename(filename, ext)}\n\n${summary}\n`,
    '.txt': `${summary}\n`
  };

  return {
    type: 'code',
    lang: ext.replace('.', '') || 'txt',
    filename,
    code: templates[ext] || templates['.txt'],
    explanation: 'Generating a free local starter file with no paid model dependency.'
  };
}

function buildClawAction(command) {
  const lower = command.toLowerCase();
  const channel = command.match(/\bchannel\s+([A-Za-z0-9:_-]+)/i)?.[1] || '';
  const payload = command.match(/\b(?:say|send|message)\b(.+)$/i)?.[1]?.trim() || command.trim();

  if (/\bstatus\b/.test(lower)) {
    return { type: 'claw', action: 'status', channel: '', payload: '', explanation: 'Checking the live OpenClaw relay status.' };
  }
  if (/\b(list|show)\b.*\bchannels\b/.test(lower)) {
    return { type: 'claw', action: 'list_channels', channel: '', payload: '', explanation: 'Listing live OpenClaw channels.' };
  }
  if (/\b(list|show)\b.*\bagents\b/.test(lower)) {
    return { type: 'claw', action: 'list_agents', channel: '', payload: '', explanation: 'Listing live OpenClaw agents.' };
  }
  return {
    type: 'claw',
    action: 'send_message',
    channel,
    payload,
    explanation: 'Preparing a real OpenClaw bridge request.'
  };
}

async function enrichFsAction(action) {
  try {
    if (action.operation === 'read') {
      const content = await readFile(action.path, 'utf8');
      return {
        ...action,
        preview: content.slice(0, 1200),
        bytes: Buffer.byteLength(content, 'utf8')
      };
    }
    if (action.operation === 'list') {
      const entries = await readdir(action.path, { withFileTypes: true });
      return {
        ...action,
        preview: entries.slice(0, 10).map((entry) => `${entry.isDirectory() ? '[DIR]' : '[FILE]'} ${entry.name}`).join('\n'),
        count: entries.length
      };
    }
  } catch (error) {
    return { ...action, previewError: error.message };
  }
  return action;
}

export async function dispatchLocalAgent({ agentId, command }) {
  const resolvedAgentId = agentId === 'AUTO' ? inferAgent(command) : agentId;
  let parsed;

  switch (resolvedAgentId) {
    case 'PHANTOM':
      parsed = await enrichFsAction(buildFsAction(command));
      break;
    case 'HYDRA':
      parsed = buildSqlAction(command);
      break;
    case 'SCRIBE':
      parsed = buildCodeAction(command);
      break;
    case 'CLAW':
      parsed = buildClawAction(command);
      break;
    case 'SHELL':
    default:
      parsed = buildShellAction(command);
      break;
  }

  return {
    agentId: resolvedAgentId,
    parsed: {
      ...parsed,
      agentId: resolvedAgentId
    }
  };
}
