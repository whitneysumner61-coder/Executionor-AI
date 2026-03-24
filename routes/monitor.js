// ── Process monitor route ─────────────────────────────────
// Cross-platform process and system stats for the host.
//
// GET /api/monitor/processes?sort=cpu|mem|name&limit=30
// GET /api/monitor/system   — CPU%, RAM%, disk info
// POST /api/monitor/kill    { pid } — kill a process by PID

import os from 'os';
import { Router } from 'express';

import { runPSSync } from './ps.js';
import { IS_WINDOWS } from '../services/host-runtime.js';

const router = Router();

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function toFloat(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value || '').trim());
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parsePosixProcessLines(lines) {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/, 5);
      const [pid, threads, cpu, rss, ...nameParts] = parts;
      return {
        Name: nameParts.join(' ') || 'unknown',
        Id: toInt(pid),
        CPU: toFloat(cpu),
        RAM_MB: Number((toInt(rss) / 1024).toFixed(1)),
        Threads: toInt(threads)
      };
    })
    .filter((proc) => proc.Id > 0);
}

router.get('/processes', async (req, res) => {
  const sort = req.query.sort || 'cpu';
  const limit = Number.parseInt(req.query.limit || '35', 10) || 35;

  try {
    if (IS_WINDOWS) {
      const sortCol = sort === 'mem' ? 'WorkingSet' : sort === 'name' ? 'Name' : 'CPU';
      const lines = await runPSSync(
        `Get-Process | Sort-Object ${sortCol} -Descending | Select-Object -First ${limit} |` +
        ` Select-Object Name, Id, @{N='CPU';E={[math]::Round($_.CPU,1)}}, @{N='RAM_MB';E={[math]::Round($_.WorkingSet/1MB,1)}},` +
        ` @{N='Threads';E={$_.Threads.Count}}, Responding |` +
        ` ConvertTo-Json -Compress`
      );
      const json = lines.join('').trim();
      const procs = JSON.parse(json);
      return res.json({ processes: Array.isArray(procs) ? procs : [procs], ts: new Date().toISOString() });
    }

    const sortArg = sort === 'mem' ? '--sort=-rss' : sort === 'name' ? '--sort=comm' : '--sort=-pcpu';
    const lines = await runPSSync(`ps -eo pid=,nlwp=,pcpu=,rss=,comm= ${sortArg} | head -n ${limit}`);
    res.json({ processes: parsePosixProcessLines(lines), ts: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/system', async (req, res) => {
  try {
    if (IS_WINDOWS) {
      const lines = await runPSSync(`
$cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
$os  = Get-CimInstance Win32_OperatingSystem
$ram_total = [math]::Round($os.TotalVisibleMemorySize / 1MB, 2)
$ram_free  = [math]::Round($os.FreePhysicalMemory / 1MB, 2)
$ram_used  = [math]::Round(($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / 1MB, 2)
$disk = Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Root -match '^[CD]:' } |
  Select-Object Name, @{N='Used_GB';E={[math]::Round($_.Used/1GB,1)}}, @{N='Free_GB';E={[math]::Round($_.Free/1GB,1)}}
@{ cpu_pct=$cpu; ram_total_gb=$ram_total; ram_used_gb=$ram_used; ram_free_gb=$ram_free;
   ram_pct=[math]::Round($ram_used/$ram_total*100,1); disks=$disk } | ConvertTo-Json -Depth 3 -Compress`
      );
      return res.json(JSON.parse(lines.join('').trim()));
    }

    const total = os.totalmem() / 1024 / 1024 / 1024;
    const free = os.freemem() / 1024 / 1024 / 1024;
    const used = total - free;
    const load = os.loadavg()[0];
    const cpuPct = Math.min(100, Number(((load / Math.max(os.cpus().length, 1)) * 100).toFixed(1)));
    const diskLines = await runPSSync('df -kP /');
    const diskLine = diskLines.map((line) => line.trim()).filter(Boolean).slice(-1)[0] || '';
    const diskParts = diskLine.split(/\s+/);
    const freeGb = Number(((toInt(diskParts[3]) / 1024 / 1024)).toFixed(1));
    const usedGb = Number(((toInt(diskParts[2]) / 1024 / 1024)).toFixed(1));

    res.json({
      cpu_pct: cpuPct,
      ram_total_gb: Number(total.toFixed(2)),
      ram_used_gb: Number(used.toFixed(2)),
      ram_free_gb: Number(free.toFixed(2)),
      ram_pct: Number(((used / total) * 100).toFixed(1)),
      disks: [{ Name: '/', Used_GB: usedGb, Free_GB: freeGb }]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/kill', async (req, res) => {
  const { pid } = req.body;
  if (!pid) return res.status(400).json({ error: 'pid required' });
  const pidNum = Number.parseInt(pid, 10);
  if (Number.isNaN(pidNum) || pidNum <= 4) return res.status(400).json({ error: 'Invalid PID' });

  try {
    if (IS_WINDOWS) {
      await runPSSync(`Stop-Process -Id ${pidNum} -Force -ErrorAction Stop`);
    } else {
      process.kill(pidNum, 'SIGKILL');
    }
    res.json({ success: true, pid: pidNum });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
