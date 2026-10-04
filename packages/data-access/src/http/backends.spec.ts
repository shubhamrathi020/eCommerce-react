import { BACKENDS, resolveBackend } from './backends';

describe('resolveBackend', () => {
  it('uses the mock data unless a real backend is named', () => {
    expect(resolveBackend(undefined).real).toBe(false);
    expect(resolveBackend('mock').real).toBe(false);
    expect(resolveBackend('something-else').real).toBe(false);
    expect(resolveBackend('toString').real).toBe(false);
  });

  it('maps each backend to its port', () => {
    expect(resolveBackend('nest')).toEqual({ real: true, url: 'http://localhost:3333' });
    expect(resolveBackend('go')).toEqual({ real: true, url: 'http://localhost:3334' });
    expect(resolveBackend('node')).toEqual({ real: true, url: 'http://localhost:3335' });
    expect(resolveBackend('dotnet')).toEqual({ real: true, url: 'http://localhost:3336' });
    expect(Object.keys(BACKENDS)).toEqual(['nest', 'go', 'node', 'dotnet']);
  });
});
