import { describe, it, expect } from 'vitest';
import { GHIBLI_LOOK, supportedVisualSearch } from './look-mode.mjs';

describe('the supported visual setup', () => {
  it('uses Ghibli without consulting a saved style preference', () => {
    expect(GHIBLI_LOOK).toBe(true);
  });

  it.each(['?v2=0', '?v2=1', '?v2=require', '?ghibli=0', '?ghibli=false',
    '?ghibli=1', '?look=real', '?look=ghibli', '?ground=mesh', '?trees=procedural'])
  ('accepts historical %s links without restoring retired modes', search => {
    expect(supportedVisualSearch(search)).toBe('');
  });

  it('preserves views, quality, backend and diagnostics while removing all duplicate old flags', () => {
    const search = '?bana=visby&hal=3&vy=tee&ljus=kvall&tee=1&gl=1&q=lo&det=1&hero=0&dev=1&v2=0&ghibli=0&ghibli=1&look=real&ground=mesh&trees=procedural';
    expect(supportedVisualSearch(search)).toBe('?bana=visby&hal=3&vy=tee&ljus=kvall&tee=1&gl=1&q=lo&det=1&hero=0&dev=1');
  });

  it('is idempotent and leaves the bare chooser URL bare', () => {
    expect(supportedVisualSearch('')).toBe('');
    const query = supportedVisualSearch('?bana=upsala&q=hi&gl=0&ghibli=0');
    expect(supportedVisualSearch(query)).toBe(query);
  });
});
