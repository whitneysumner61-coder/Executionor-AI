import { spawnSync } from 'child_process';

export const IS_WINDOWS = process.platform === 'win32';

function detectShell() {
  if (IS_WINDOWS) {
    return { label: 'PowerShell', executable: 'powershell.exe', mode: 'powershell' };
  }

  const pwshCheck = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], { encoding: 'utf8' });
  if (pwshCheck.status === 0) {
    return { label: 'PowerShell', executable: 'pwsh', mode: 'powershell' };
  }

  return { label: 'Bash', executable: process.env.SHELL || '/bin/bash', mode: 'bash' };
}

const detectedShell = detectShell();
export const SHELL_LABEL = detectedShell.label;
export const SHELL_EXECUTABLE = detectedShell.executable;
export const SHELL_MODE = detectedShell.mode;
export const SHELL_ENV = IS_WINDOWS
  ? {
      ...process.env,
      PATH: `D:\\npm-global;C:\\Program Files\\nodejs;${process.env.PATH}`
    }
  : {
      ...process.env
    };

export function buildShellArgs(command) {
  if (SHELL_MODE === 'powershell') {
    return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command];
  }

  return ['-lc', command];
}
