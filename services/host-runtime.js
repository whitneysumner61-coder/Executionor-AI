export const IS_WINDOWS = process.platform === 'win32';
export const SHELL_LABEL = IS_WINDOWS ? 'PowerShell' : 'Bash';
export const SHELL_EXECUTABLE = IS_WINDOWS ? 'powershell.exe' : (process.env.SHELL || '/bin/bash');
export const SHELL_ENV = IS_WINDOWS
  ? {
      ...process.env,
      PATH: `D:\\npm-global;C:\\Program Files\\nodejs;${process.env.PATH}`
    }
  : {
      ...process.env
    };

export function buildShellArgs(command) {
  if (IS_WINDOWS) {
    return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command];
  }

  return ['-lc', command];
}
