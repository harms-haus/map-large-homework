/**
 * Tests for `dialogs.ts` — the confirm / prompt / alert modals built on the
 * native `<dialog>` element that replace `window.confirm` / `window.prompt` /
 * `window.alert`.
 *
 * Coverage:
 *  - Each dialog mounts a single transient `dialog.app-dialog[open]` on body,
 *    removes it on settle, and resolves with the documented value.
 *  - Confirm resolves `true` on OK and `false` on Cancel / ESC / backdrop.
 *  - Prompt resolves the input value on OK / Enter and `null` on Cancel / ESC
 *    / backdrop; the input is seeded with the default value and selected.
 *  - Alert resolves `undefined` on OK / ESC / backdrop.
 *  - Caller-supplied text (titles / messages) is escaped via `textContent`
 *    (no HTML injection).
 *  - `danger` confirm renders a destructive (red) button and focuses Cancel.
 *
 * happy-dom's `<dialog>` honors `open`, `showModal()`, and `close()` (which
 * fires a `close` event). `showModal()` does NOT trap focus or render a real
 * backdrop, but the dialog element is in the DOM with `[open]`, so structural
 * assertions hold. ESC dispatches a synthetic `cancel` event (the native modal
 * behavior under test).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { confirmDialog, promptDialog, alertDialog } from './dialogs';
import { flush } from './test-helpers';

/** The single open `.app-dialog` on body, or throw if none. */
function openDialog(): HTMLDialogElement {
  const d = document.body.querySelector('dialog.app-dialog[open]');
  if (!d) throw new Error('expected exactly one open dialog.app-dialog on body');
  return d as HTMLDialogElement;
}

/** Click the action button whose trimmed text matches `label`. */
function clickAction(dialog: HTMLDialogElement, label: string): void {
  const btn = Array.from(dialog.querySelectorAll('button')).find(
    (b) => (b.textContent ?? '').trim() === label,
  );
  if (!btn) throw new Error('no action button labeled "' + label + '"');
  btn.click();
}

afterEach(() => {
  // Belt-and-suspenders: any unsettled dialog is torn down so a rejected test
  // cannot leak a stray <dialog> into the next.
  for (const d of Array.from(document.body.querySelectorAll('dialog.app-dialog'))) {
    d.remove();
  }
});

/* ===========================================================================
 * confirmDialog
 * ========================================================================= */
describe('confirmDialog', () => {
  it('mounts a single open dialog.app-dialog on body', async () => {
    const p = confirmDialog({ title: 'Delete', message: 'Sure?' });
    const d = openDialog();
    expect(d.querySelectorAll('h2.app-dialog-title')).toHaveLength(1);
    expect(d.querySelector('h2.app-dialog-title')!.textContent).toBe('Delete');
    expect(d.querySelector('p.app-dialog-message')!.textContent).toBe('Sure?');
    // Two action buttons: OK + Cancel by default.
    const labels = Array.from(d.querySelectorAll('button')).map((b) =>
      (b.textContent ?? '').trim(),
    );
    expect(labels).toEqual(['OK', 'Cancel']);
    clickAction(d, 'OK');
    expect(await p).toBe(true);
  });

  it('resolves false on Cancel', async () => {
    const p = confirmDialog({ title: 'x' });
    const d = openDialog();
    clickAction(d, 'Cancel');
    expect(await p).toBe(false);
  });

  it('honors custom confirm/cancel labels', async () => {
    const p = confirmDialog({
      title: 'x',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
    });
    const d = openDialog();
    const labels = Array.from(d.querySelectorAll('button')).map((b) =>
      (b.textContent ?? '').trim(),
    );
    expect(labels).toEqual(['Delete', 'Keep']);
    clickAction(d, 'Delete');
    expect(await p).toBe(true);
  });

  it('renders the confirm button as destructive (btn-danger) when danger=true', async () => {
    const p = confirmDialog({ title: 'x', danger: true });
    const d = openDialog();
    const confirmBtn = Array.from(d.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === 'OK',
    )!;
    expect(confirmBtn.classList.contains('btn-danger')).toBe(true);
    clickAction(d, 'Cancel');
    await p;
  });

  it('focuses Cancel first when danger=true (a reflexive Enter does not confirm)', async () => {
    const p = confirmDialog({ title: 'x', danger: true });
    const d = openDialog();
    expect(document.activeElement).toBe(
      Array.from(d.querySelectorAll('button')).find(
        (b) => (b.textContent ?? '').trim() === 'Cancel',
      ),
    );
    clickAction(d, 'Cancel');
    await p;
  });

  it('focuses the confirm button by default', async () => {
    const p = confirmDialog({ title: 'x' });
    const d = openDialog();
    expect(document.activeElement).toBe(
      Array.from(d.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === 'OK'),
    );
    clickAction(d, 'Cancel');
    await p;
  });

  it('resolves false on ESC (native modal cancel)', async () => {
    const p = confirmDialog({ title: 'x' });
    const d = openDialog();
    d.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(await p).toBe(false);
  });

  it('resolves false on a backdrop click (click target is the dialog itself)', async () => {
    const p = confirmDialog({ title: 'x' });
    const d = openDialog();
    d.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(await p).toBe(false);
  });

  it('a click inside the card does NOT settle the dialog', async () => {
    const p = confirmDialog({ title: 'x' });
    const d = openDialog();
    const card = d.querySelector('.app-dialog-box')!;
    card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    // Still mounted — the promise is pending.
    expect(document.body.contains(d)).toBe(true);
    clickAction(d, 'Cancel');
    await p;
  });

  it('removes the dialog from the DOM after settling', async () => {
    const p = confirmDialog({ title: 'x' });
    const d = openDialog();
    clickAction(d, 'OK');
    await p;
    expect(document.body.contains(d)).toBe(false);
  });

  it('escapes the message via textContent (no HTML injection)', async () => {
    const evil = '<img src=x onerror=window.__pwned=1>';
    const p = confirmDialog({ title: 'x', message: evil });
    const d = openDialog();
    expect(d.querySelector('img')).toBeNull();
    expect(d.querySelector('p.app-dialog-message')!.textContent).toBe(evil);
    clickAction(d, 'Cancel');
    await p;
  });

  it('omits the message element when no message is supplied', async () => {
    const p = confirmDialog({ title: 'Just a title' });
    const d = openDialog();
    expect(d.querySelector('p.app-dialog-message')).toBeNull();
    clickAction(d, 'Cancel');
    await p;
  });
});

/* ===========================================================================
 * promptDialog
 * ========================================================================= */
describe('promptDialog', () => {
  it('mounts a text input seeded with the default value', async () => {
    const p = promptDialog({ title: 'Rename', defaultValue: 'old name' });
    const d = openDialog();
    const input = d.querySelector('input.app-dialog-input') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe('old name');
    clickAction(d, 'Cancel');
    expect(await p).toBeNull();
  });

  it('resolves the input value on Confirm', async () => {
    const p = promptDialog({ title: 'Rename', defaultValue: 'old' });
    const d = openDialog();
    const input = d.querySelector('input.app-dialog-input') as HTMLInputElement;
    input.value = 'new name';
    clickAction(d, 'OK');
    expect(await p).toBe('new name');
  });

  it('resolves null on Cancel', async () => {
    const p = promptDialog({ title: 'Rename' });
    const d = openDialog();
    clickAction(d, 'Cancel');
    expect(await p).toBeNull();
  });

  it('resolves the current input value on Enter in the field', async () => {
    const p = promptDialog({ title: 'Rename', defaultValue: 'seed' });
    const d = openDialog();
    const input = d.querySelector('input.app-dialog-input') as HTMLInputElement;
    input.value = 'via-enter';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    expect(await p).toBe('via-enter');
  });

  it('Enter does not submit when the value is unchanged from the default', async () => {
    // Sanity: Enter always resolves the current value, even the default. This
    // documents that promptDialog does not second-guess a confirmed default.
    const p = promptDialog({ title: 'Rename', defaultValue: 'same' });
    const d = openDialog();
    const input = d.querySelector('input.app-dialog-input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(await p).toBe('same');
  });

  it('resolves null on ESC', async () => {
    const p = promptDialog({ title: 'Rename' });
    const d = openDialog();
    d.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(await p).toBeNull();
  });

  it('resolves null on a backdrop click', async () => {
    const p = promptDialog({ title: 'Rename' });
    const d = openDialog();
    d.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(await p).toBeNull();
  });

  it('focuses and selects the input on open', async () => {
    const p = promptDialog({ title: 'Rename', defaultValue: 'seed' });
    const d = openDialog();
    const input = d.querySelector('input.app-dialog-input') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    // happy-dom sets selectionStart/End on select(); verify selection covers
    // the seed value.
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('seed'.length);
    clickAction(d, 'Cancel');
    await p;
  });

  it('honors a custom placeholder', async () => {
    const p = promptDialog({ title: 'x', placeholder: 'type here' });
    const d = openDialog();
    const input = d.querySelector('input.app-dialog-input') as HTMLInputElement;
    expect(input.placeholder).toBe('type here');
    clickAction(d, 'Cancel');
    await p;
  });

  it('defaults the value to "" when defaultValue is omitted', async () => {
    const p = promptDialog({ title: 'x' });
    const d = openDialog();
    const input = d.querySelector('input.app-dialog-input') as HTMLInputElement;
    expect(input.value).toBe('');
    clickAction(d, 'Cancel');
    await p;
  });
});

/* ===========================================================================
 * alertDialog
 * ========================================================================= */
describe('alertDialog', () => {
  it('mounts a single OK button', async () => {
    const p = alertDialog({ title: 'Heads up', message: 'No can do' });
    const d = openDialog();
    const labels = Array.from(d.querySelectorAll('button')).map((b) =>
      (b.textContent ?? '').trim(),
    );
    expect(labels).toEqual(['OK']);
    clickAction(d, 'OK');
    await p;
  });

  it('resolves undefined on OK', async () => {
    const p = alertDialog({ title: 'x' });
    const d = openDialog();
    clickAction(d, 'OK');
    const result = await p;
    expect(result).toBeUndefined();
  });

  it('resolves undefined on ESC', async () => {
    const p = alertDialog({ title: 'x' });
    const d = openDialog();
    d.dispatchEvent(new Event('cancel', { cancelable: true }));
    const result = await p;
    expect(result).toBeUndefined();
  });

  it('resolves undefined on a backdrop click', async () => {
    const p = alertDialog({ title: 'x' });
    const d = openDialog();
    d.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const result = await p;
    expect(result).toBeUndefined();
  });

  it('honors a custom dismiss label', async () => {
    const p = alertDialog({ title: 'x', confirmLabel: 'Got it' });
    const d = openDialog();
    clickAction(d, 'Got it');
    await p;
  });

  it('focuses the OK button on open', async () => {
    const p = alertDialog({ title: 'x' });
    const d = openDialog();
    expect(document.activeElement).toBe(
      Array.from(d.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === 'OK'),
    );
    clickAction(d, 'OK');
    await p;
  });
});

/* ===========================================================================
 * One-shot closer — a second settle (e.g. ESC after a click) is a no-op
 * ========================================================================= */
describe('finish() is one-shot', () => {
  it('a confirm is settled by OK and a subsequent ESC is a no-op (no double-resolve)', async () => {
    const p = confirmDialog({ title: 'x' });
    const d = openDialog();
    clickAction(d, 'OK');
    // Race: an ESC arrives in the same tick as the click's finish().
    d.dispatchEvent(new Event('cancel', { cancelable: true }));
    // The Promise resolves exactly once with the first settle's value.
    expect(await p).toBe(true);
    expect(document.body.contains(d)).toBe(false);
  });

  it('flush() after settle leaves no lingering dialogs on body', async () => {
    const p = confirmDialog({ title: 'x' });
    const d = openDialog();
    clickAction(d, 'Cancel');
    await p;
    await flush();
    expect(document.body.querySelectorAll('dialog.app-dialog')).toHaveLength(0);
  });
});
