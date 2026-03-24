import { describe, it, expect } from 'vitest';
import { LOCAL_AGENTS, WORKSPACE_ROOT, dispatchLocalAgent } from '../../services/local-agent.js';

describe('LOCAL_AGENTS registry', () => {
  const expectedIds = ['SHELL', 'PHANTOM', 'HYDRA', 'SCRIBE', 'CLAW'];

  it('exports all expected agents', () => {
    for (const id of expectedIds) {
      expect(LOCAL_AGENTS).toHaveProperty(id);
    }
  });

  it('each agent has id, name, role, description', () => {
    for (const agent of Object.values(LOCAL_AGENTS)) {
      expect(typeof agent.id).toBe('string');
      expect(typeof agent.name).toBe('string');
      expect(typeof agent.role).toBe('string');
      expect(typeof agent.description).toBe('string');
      expect(agent.id.length).toBeGreaterThan(0);
    }
  });

  it('agent id matches the registry key', () => {
    for (const [key, agent] of Object.entries(LOCAL_AGENTS)) {
      expect(agent.id).toBe(key);
    }
  });
});

describe('WORKSPACE_ROOT', () => {
  it('is a non-empty string', () => {
    expect(typeof WORKSPACE_ROOT).toBe('string');
    expect(WORKSPACE_ROOT.length).toBeGreaterThan(0);
  });
});

describe('dispatchLocalAgent', () => {
  it('returns agentId and parsed object', async () => {
    const result = await dispatchLocalAgent({ agentId: 'SHELL', command: 'echo hello' });
    expect(result).toHaveProperty('agentId');
    expect(result).toHaveProperty('parsed');
    expect(typeof result.parsed).toBe('object');
  });

  it('returns correct agentId when explicitly set to SHELL', async () => {
    const result = await dispatchLocalAgent({ agentId: 'SHELL', command: 'echo hello' });
    expect(result.agentId).toBe('SHELL');
  });

  it('infers CLAW agent for openclaw commands', async () => {
    const result = await dispatchLocalAgent({ agentId: 'AUTO', command: 'check openclaw relay status' });
    expect(result.agentId).toBe('CLAW');
  });

  it('infers HYDRA agent for SQL commands', async () => {
    const result = await dispatchLocalAgent({ agentId: 'AUTO', command: 'select all from properties table' });
    expect(result.agentId).toBe('HYDRA');
  });

  it('infers PHANTOM agent for file commands', async () => {
    const result = await dispatchLocalAgent({ agentId: 'AUTO', command: 'list files in directory' });
    expect(result.agentId).toBe('PHANTOM');
  });

  it('infers SCRIBE agent for code generation commands', async () => {
    const result = await dispatchLocalAgent({ agentId: 'AUTO', command: 'create a new component boilerplate' });
    expect(result.agentId).toBe('SCRIBE');
  });

  it('defaults to SHELL agent for unrecognised commands', async () => {
    const result = await dispatchLocalAgent({ agentId: 'AUTO', command: 'do something unrecognised' });
    expect(result.agentId).toBe('SHELL');
  });

  it('parsed object includes agentId field', async () => {
    const result = await dispatchLocalAgent({ agentId: 'SHELL', command: 'pwd' });
    expect(result.parsed).toHaveProperty('agentId', 'SHELL');
  });

  it('HYDRA returns a parsed object with type sql', async () => {
    const result = await dispatchLocalAgent({ agentId: 'HYDRA', command: 'select * from contacts limit 10' });
    expect(result.parsed).toHaveProperty('type', 'sql');
  });

  it('SCRIBE returns a parsed object with type code', async () => {
    const result = await dispatchLocalAgent({ agentId: 'SCRIBE', command: 'generate a node worker script' });
    expect(result.parsed).toHaveProperty('type', 'code');
  });

  it('CLAW returns a parsed object with type claw', async () => {
    const result = await dispatchLocalAgent({ agentId: 'CLAW', command: 'status openclaw' });
    expect(result.parsed).toHaveProperty('type', 'claw');
  });

  it('PHANTOM returns a parsed object with type fs', async () => {
    const result = await dispatchLocalAgent({ agentId: 'PHANTOM', command: 'read file README.md' });
    expect(result.parsed).toHaveProperty('type', 'fs');
  });

  it('handles commands that look like direct PowerShell/shell', async () => {
    const result = await dispatchLocalAgent({ agentId: 'SHELL', command: '$env:PATH' });
    expect(result.agentId).toBe('SHELL');
    expect(result.parsed.type).toBe('ps');
  });
});
