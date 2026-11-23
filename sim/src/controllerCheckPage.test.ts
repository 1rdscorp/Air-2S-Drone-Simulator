import { readFileSync } from 'node:fs';
import { parse } from 'acorn';
import { describe, expect, it } from 'vitest';

const page = readFileSync(new URL('../public/controller-check.html', import.meta.url), 'utf8');

/** The page's own script: everything between its one pair of script tags. */
function inlineScript(): string {
  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  expect(scripts).toHaveLength(1);
  return scripts[0] ?? '';
}

describe('controller check page', () => {
  it('is written in JavaScript that a years-old browser can read', () => {
    // Part of Step 04 is opening this page in the Smart Controller's own browser
    // (Android 7.1). One piece of newer syntax would stop the whole script there.
    expect(() => parse(inlineScript(), { ecmaVersion: 5 })).not.toThrow();
  });

  it('stands on its own: no script, style sheet or picture from anywhere else', () => {
    expect(page).not.toMatch(/<script[^>]+src=/);
    expect(page).not.toMatch(/<link[^>]+href=/);
    expect(page).not.toMatch(/<img/);
    expect(page).not.toMatch(/https?:\/\/(?!schemas)/);
  });

  it('uses the same Bluetooth test ids as the RC Probe app', () => {
    const probe = readFileSync(
      new URL('../../rc-probe/app/src/main/java/com/air2ssim/rcprobe/BleProbe.kt', import.meta.url),
      'utf8',
    );
    const ids = [...inlineScript().matchAll(/'(6a1e000\d-[0-9a-f-]{27})'/g)].map((m) => m[1]);

    expect(ids).toHaveLength(2);
    for (const id of ids) {
      expect(probe).toContain(`"${id}"`);
    }
  });

  it('carries the safety notice', () => {
    expect(page).toContain('switch the aircraft OFF before you start');
  });
});
