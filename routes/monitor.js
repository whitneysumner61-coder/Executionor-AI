// ── Process monitor route ─────────────────────────────────
// Real-time Windows process list with CPU/RAM stats.
// Runs Get-Process via PowerShell, returns JSON.
//
// GET /api/monitor/processes?sort=cpu|mem|name&limit=30
// GET /api/monitor/system   — CPU%, RAM%, disk info
// POST /api/monitor/kill    { pid } — kill a process by PID

import { Router } from 'express';
import { runPSSync } from './ps.js';

const router = Router();

router.get('/processes', async (req, res) => {
  const sort  = req.query.sort  || 'cpu';
  const limit = parseInt(req.query.limit || '35');
  const sortCol = sort === 'mem' ? 'WorkingSet' : sort === 'name' ? 'Name' : 'CPU';

  try {
    const lines = await runPSSync(
      `Get-Process | Sort-Object ${sortCol} -Descending | Select-Object -First ${limit} |` +
      ` Select-Object Name, Id, @{N='CPU';E={[math]::Round($_.CPU,1)}}, @{N='RAM_MB';E={[math]::Round($_.WorkingSet/1MB,1)}},` +
      ` @{N='Threads';E={$_.Threads.Count}}, Responding |` +
      ` ConvertTo-Json -Compress`
    );
    const json = lines.join('').trim();
    const procs = JSON.parse(json);
    res.json({ processes: Array.isArray(procs) ? procs : [procs], ts: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/system', async (req, res) => {
  try {
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
    res.json(JSON.parse(lines.join('').trim()));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/kill', async (req, res) => {
  const { pid } = req.body;
  if (!pid) return res.status(400).json({ error: 'pid required' });
  const pidNum = parseInt(pid);
  if (isNaN(pidNum) || pidNum <= 4) return res.status(400).json({ error: 'Invalid PID' });
  try {
    await runPSSync(`Stop-Process -Id ${pidNum} -Force -ErrorAction Stop`);
    res.json({ success: true, pid: pidNum });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
