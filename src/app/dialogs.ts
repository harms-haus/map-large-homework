/**
 * Modal dialogs — confirm / prompt / alert — built on the native `<dialog>`
 * element. These replace `window.confirm` / `window.prompt` / `window.alert`,
 * which render as un-styled, host-OS chrome that breaks out of the app's dark
 * theme and block the JS call stack until dismissed.
 *
 * Each helper builds a transient `<dialog>`, shows it modally, resolves a
 * one-shot Promise on the user's choice, then removes itself from the DOM. The
 * native modal gives us top-layer rendering, focus trapping, and ESC-to-cancel
 * (the `cancel` event); a click on the dimmed backdrop also cancels — safe for
 * every caller (confirm → `false`, prompt → `null`, alert → `void`). Caller-
 * supplied text (file names interpolated into titles/messages) is inserted via
 * `textContent` — never `innerHTML` — matching the rest of the app's XSS
 * hygiene.
 */

/** Default action-button labels. */
const DEFAULT_CONFIRM_LABEL = 'OK';
const DEFAULT_CANCEL_LABEL = 'Cancel';

/** Text options shared by every dialog kind. */
export interface DialogTextOptions {
  /** Dialog heading, rendered in an `<h2>`. */
  title: string;
  /** Body message, rendered in a `<p>`. Omit for a heading-only dialog. */
  message?: string;
}

export interface ConfirmOptions extends DialogTextOptions {
  /** Confirm-button label (default "OK"). */
  confirmLabel?: string;
  /** Cancel-button label (default "Cancel"). */
  cancelLabel?: string;
  /**
   * Render the confirm button as destructive (red) and focus Cancel first, so
   * a reflexive Enter does not confirm a destructive action (e.g. Delete).
   */
  danger?: boolean;
}

export interface PromptOptions extends DialogTextOptions {
  /** Initial input value (default ""). */
  defaultValue?: string;
  /** Input placeholder. */
  placeholder?: string;
  /** Confirm-button label (default "OK"). */
  confirmLabel?: string;
  /** Cancel-button label (default "Cancel"). */
  cancelLabel?: string;
}

export interface AlertOptions extends DialogTextOptions {
  /** Dismiss-button label (default "OK"). */
  confirmLabel?: string;
}

/**
 * Internal skeleton builder shared by all three dialogs. Builds a native
 * `<dialog class="app-dialog">` wrapping a `.app-dialog-box` card (title +
 * optional message + optional `beforeFooter` element + `.app-dialog-actions`
 * footer), appends it to `document.body`, shows it modally, and returns:
 *  - `footer`: the actions row, for the caller to append its buttons to,
 *  - `finish(value)`: the one-shot closer — resolves the Promise, closes +
 *    removes the dialog, and is a no-op after the first call.
 *
 * ESC (the native modal `cancel` event) and a backdrop click both resolve with
 * `cancelValue`. The caller appends its buttons and focuses its target element
 * AFTER this returns (so the elements are in the document before `focus()`).
 */
function openDialog<T>(args: {
  opts: DialogTextOptions;
  cancelValue: T;
  resolve: (value: T) => void;
  beforeFooter?: HTMLElement;
}): { footer: HTMLElement; finish: (value: T) => void } {
  const { opts, cancelValue, resolve } = args;

  const dialog = document.createElement('dialog');
  dialog.className = 'app-dialog';

  const box = document.createElement('div');
  box.className = 'app-dialog-box';

  const heading = document.createElement('h2');
  heading.className = 'app-dialog-title';
  heading.textContent = opts.title;
  box.append(heading);

  if (opts.message) {
    const message = document.createElement('p');
    message.className = 'app-dialog-message';
    message.textContent = opts.message;
    box.append(message);
  }

  if (args.beforeFooter) {
    box.append(args.beforeFooter);
  }

  const footer = document.createElement('div');
  footer.className = 'app-dialog-actions';
  box.append(footer);

  dialog.append(box);

  let settled = false;
  function finish(value: T): void {
    if (settled) {
      return;
    }
    settled = true;
    if (dialog.open) {
      dialog.close();
    }
    dialog.remove();
    resolve(value);
  }

  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    finish(cancelValue);
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      finish(cancelValue);
    }
  });

  document.body.append(dialog);
  dialog.showModal();

  return { footer, finish };
}

/** Build a `.btn` action button, optionally styled destructive (`.btn-danger`). */
function makeButton(label: string, danger = false): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn' + (danger ? ' btn-danger' : '');
  btn.textContent = label;
  return btn;
}

/**
 * Show a confirmation modal. Resolves `true` if confirmed, `false` if
 * cancelled (Cancel button, ESC, or backdrop click). When `danger` is set the
 * confirm button is red and Cancel is focused first.
 */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const confirmBtn = makeButton(opts.confirmLabel ?? DEFAULT_CONFIRM_LABEL, opts.danger);
    const cancelBtn = makeButton(opts.cancelLabel ?? DEFAULT_CANCEL_LABEL);
    const { footer, finish } = openDialog({ opts, cancelValue: false, resolve });

    confirmBtn.addEventListener('click', () => finish(true));
    cancelBtn.addEventListener('click', () => finish(false));
    footer.append(confirmBtn, cancelBtn);
    // Focus AFTER the buttons are in the document. For destructive actions,
    // focus Cancel so a reflexive Enter does not destroy.
    (opts.danger ? cancelBtn : confirmBtn).focus();
  });
}

/**
 * Show a single-line text-input modal. Resolves the input's value if
 * confirmed (Confirm button or Enter in the field), or `null` if cancelled
 * (Cancel button, ESC, or backdrop click). The input is pre-selected so typing
 * replaces the default value, mirroring how a rename field is typically used.
 */
export function promptDialog(opts: PromptOptions): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'app-dialog-input';
    input.value = opts.defaultValue ?? '';
    if (opts.placeholder !== undefined) {
      input.placeholder = opts.placeholder;
    }

    const confirmBtn = makeButton(opts.confirmLabel ?? DEFAULT_CONFIRM_LABEL);
    const cancelBtn = makeButton(opts.cancelLabel ?? DEFAULT_CANCEL_LABEL);
    const { footer, finish } = openDialog<string | null>({
      opts,
      cancelValue: null,
      resolve,
      beforeFooter: input,
    });

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(input.value);
      }
    });
    confirmBtn.addEventListener('click', () => finish(input.value));
    cancelBtn.addEventListener('click', () => finish(null));
    footer.append(confirmBtn, cancelBtn);
    input.focus();
    input.select();
  });
}

/**
 * Show an informational modal with a single dismiss button. Resolves `void`
 * once dismissed (OK button, ESC, or backdrop click). The `window.alert`
 * replacement — used for messages that need acknowledgment but no choice.
 */
export function alertDialog(opts: AlertOptions): Promise<void> {
  return new Promise<void>((resolve) => {
    const okBtn = makeButton(opts.confirmLabel ?? DEFAULT_CONFIRM_LABEL);
    const { footer, finish } = openDialog({ opts, cancelValue: undefined, resolve });

    okBtn.addEventListener('click', () => finish(undefined));
    footer.append(okBtn);
    okBtn.focus();
  });
}
