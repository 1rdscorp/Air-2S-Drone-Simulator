import { describe, expect, it } from 'vitest';
import { MAX_TOASTS, TOAST_SECONDS, ToastList, type ToastMessage } from './toasts';

const info = (key: string, text = key): ToastMessage => ({ key, text, kind: 'info' });
const warning = (key: string, text = key): ToastMessage => ({ key, text, kind: 'warning' });

const texts = (list: ToastList, now: number): string[] => list.active(now).map((t) => t.text);

describe('ToastList', () => {
  it('starts empty', () => {
    expect(new ToastList().active(0)).toEqual([]);
  });

  it('shows a message for a few simulated seconds, then drops it', () => {
    const list = new ToastList();
    list.push(info('a', 'Taking off'), 10);

    expect(texts(list, 10)).toEqual(['Taking off']);
    expect(texts(list, 10 + TOAST_SECONDS.info - 0.01)).toEqual(['Taking off']);
    expect(texts(list, 10 + TOAST_SECONDS.info)).toEqual([]);
  });

  it('keeps a message for as long as simulated time stands still', () => {
    const list = new ToastList();
    list.push(info('a'), 3);

    for (let i = 0; i < 1000; i++) {
      expect(list.active(3)).toHaveLength(1);
    }
  });

  it('shows warnings longer than plain messages', () => {
    const list = new ToastList();
    list.push(info('a', 'plain'), 0);
    list.push(warning('b', 'warning'), 0);

    expect(TOAST_SECONDS.warning).toBeGreaterThan(TOAST_SECONDS.info);
    expect(texts(list, TOAST_SECONDS.info + 0.5)).toEqual(['warning']);
    expect(list.active(TOAST_SECONDS.info + 0.5)[0]?.kind).toBe('warning');
  });

  it('lists the oldest message first', () => {
    const list = new ToastList();
    list.push(info('a', 'first'), 0);
    list.push(info('b', 'second'), 1);

    expect(texts(list, 1)).toEqual(['first', 'second']);
  });

  it('replaces a message about the same subject and restarts its time', () => {
    const list = new ToastList();
    list.push(info('mode', 'Sport mode'), 0);
    list.push(info('other', 'something else'), 1);
    list.push(info('mode', 'Cine mode'), 3);

    expect(texts(list, 3)).toEqual(['something else', 'Cine mode']);
    expect(texts(list, 6)).toEqual(['Cine mode']);
  });

  it('never shows more than a few at once: the oldest gives way', () => {
    const list = new ToastList();
    for (let i = 0; i < MAX_TOASTS + 2; i++) {
      list.push(info(`key${i}`, `message ${i}`), i * 0.1);
    }

    expect(texts(list, 1)).toEqual(['message 2', 'message 3', 'message 4']);
  });

  it('gives every message its own id, also when the text repeats', () => {
    const list = new ToastList();
    list.push(info('a', 'Landing'), 0);
    const first = list.active(0)[0]?.id;
    list.push(info('a', 'Landing'), 1);
    const second = list.active(1)[0]?.id;

    expect(first).toBeDefined();
    expect(second).not.toBe(first);
  });

  it('can be emptied', () => {
    const list = new ToastList();
    list.push(info('a'), 0);
    list.push(warning('b'), 0);
    list.clear();

    expect(list.active(0)).toEqual([]);
  });
});
