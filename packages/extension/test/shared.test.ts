import { describe, expect, it } from 'vitest';
import { cssFetchAllowed, isPrivateHost } from '../src/shared.js';

describe('isPrivateHost', () => {
  it.each(['localhost', 'app.localhost', '127.0.0.1', '10.1.2.3', '192.168.1.1', '172.16.0.5', '172.31.255.1', '169.254.1.1', '100.64.0.1', '[::1]', 'nas.local', 'fd00::1'])(
    '%s je lokalna adresa',
    (h) => expect(isPrivateHost(h)).toBe(true),
  );
  it.each(['drmozgovich.top', 'cdn.jsdelivr.net', '172.32.0.1', '8.8.8.8', '192.169.0.1'])('%s nije lokalna adresa', (h) =>
    expect(isPrivateHost(h)).toBe(false),
  );
});

describe('cssFetchAllowed', () => {
  const page = 'https://drmozgovich.top/';
  it('javni CSS je dozvoljen', () => {
    expect(cssFetchAllowed('https://cdn.example.com/a.css', page)).toBeNull();
  });
  it('samo http(s)', () => {
    expect(cssFetchAllowed('file:///etc/passwd', page)).toMatch(/http/);
    expect(cssFetchAllowed('chrome-extension://abc/x.css', page)).toMatch(/http/);
  });
  it('lokalna mreža samo sa iste lokalne stranice', () => {
    expect(cssFetchAllowed('http://192.168.1.1/admin.css', page)).toMatch(/lokalna/);
    expect(cssFetchAllowed('http://localhost:3000/a.css', 'http://localhost:3000/')).toBeNull();
  });
  it('nevalidan URL', () => {
    expect(cssFetchAllowed('nije url', page)).toBe('nevalidan URL');
  });
});
