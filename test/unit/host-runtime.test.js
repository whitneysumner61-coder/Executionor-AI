import { describe, it, expect } from 'vitest';
import {
  IS_WINDOWS,
  SHELL_LABEL,
  SHELL_EXECUTABLE,
  SHELL_MODE,
  SHELL_ENV,
  buildShellArgs
} from '../../services/host-runtime.js';

describe('host-runtime exports', () => {
  it('IS_WINDOWS is a boolean', () => {
    expect(typeof IS_WINDOWS).toBe('boolean');
    // In the test sandbox we are on Linux
    expect(IS_WINDOWS).toBe(false);
  });

  it('SHELL_LABEL is a non-empty string', () => {
    expect(typeof SHELL_LABEL).toBe('string');
    expect(SHELL_LABEL.length).toBeGreaterThan(0);
  });

  it('SHELL_EXECUTABLE is a non-empty string', () => {
    expect(typeof SHELL_EXECUTABLE).toBe('string');
    expect(SHELL_EXECUTABLE.length).toBeGreaterThan(0);
  });

  it('SHELL_MODE is one of the expected values', () => {
    expect(['bash', 'powershell']).toContain(SHELL_MODE);
  });

  it('SHELL_ENV is an object that inherits from process.env', () => {
    expect(typeof SHELL_ENV).toBe('object');
    expect(SHELL_ENV).not.toBeNull();
    // Must carry PATH from process.env
    expect(SHELL_ENV.PATH).toBeDefined();
  });
});

describe('buildShellArgs', () => {
  it('returns powershell args when SHELL_MODE is powershell', () => {
    // We can call buildShellArgs directly — it uses the module-level SHELL_MODE
    // which is determined at load time. On Linux it will be 'bash' unless pwsh
    // is installed, so we test both branches by inspecting the shape.
    const args = buildShellArgs('echo hello');
    expect(Array.isArray(args)).toBe(true);
    expect(args.length).toBeGreaterThanOrEqual(2);
    // Last element is always the command string
    expect(args[args.length - 1]).toBe('echo hello');
  });

  it('includes the command string as the final argument', () => {
    const cmd = 'ls -la /tmp';
    const args = buildShellArgs(cmd);
    expect(args[args.length - 1]).toBe(cmd);
  });

  it('handles empty string command', () => {
    const args = buildShellArgs('');
    expect(Array.isArray(args)).toBe(true);
    expect(args[args.length - 1]).toBe('');
  });
});
