import { closeSync, openSync } from 'node:fs';
import { stdin as procIn, stdout as procOut } from 'node:process';
import { emitKeypressEvents } from 'node:readline';
import { createInterface } from 'node:readline/promises';
import { ReadStream, WriteStream } from 'node:tty';
import { openUrl } from './open-url.js';

/**
 * Block until the developer enters a response. Wrap in a vitest test only
 * when `harness.prompt` is set AND `INTERACTIVE=1` is in the environment.
 */
export async function readlinePrompt(message: string): Promise<string> {
  const rl = createInterface({ input: procIn, output: procOut });
  try {
    const answer = await rl.question(`\n[manual setup] ${message}\nPress enter when ready: `);
    return answer;
  } finally {
    rl.close();
  }
}

interface Terminal {
  readonly input: NodeJS.ReadStream & { setRawMode(mode: boolean): unknown };
  readonly output: NodeJS.WritableStream;
  close(): void;
}

/**
 * Vitest runs each test in a forked worker whose `stdin`/`stdout` are pipes,
 * and its reporter buffers stdout — so `process.std*` can neither show a
 * prompt nor receive keystrokes (the test just spins). The controlling
 * terminal is still reachable via `/dev/tty`; opening it directly gives a
 * real TTY for both directions, bypassing the runner entirely. Returns
 * `null` on Windows or when there is no controlling terminal (CI), where the
 * caller falls back to line mode (and the semi-manual suite is skipped
 * anyway unless `INTERACTIVE=1`).
 */
function openControllingTty(): Terminal | null {
  if (process.platform === 'win32') return null;
  try {
    const fd = openSync('/dev/tty', 'r+');
    const input = new ReadStream(fd);
    const output = new WriteStream(fd);
    return {
      input,
      output,
      close: () => {
        try {
          input.destroy();
        } catch {
          /* ignore */
        }
        try {
          output.destroy();
        } catch {
          /* ignore */
        }
        try {
          closeSync(fd);
        } catch {
          /* ignore */
        }
      },
    };
  } catch {
    return null;
  }
}

/**
 * Block until the developer signals a manual step is complete (Enter), with
 * an optional "press O to open the checkout in a browser" shortcut so they
 * don't have to copy/paste the URL out of the printed presentation payload.
 *
 * Drives the controlling terminal (`/dev/tty`) directly so it works inside a
 * vitest worker; `o`/`O` opens `opts.openUrl` (repeatable), Enter resolves,
 * Ctrl+C restores the terminal before exiting (raw mode otherwise swallows
 * SIGINT and wedges the shell). When no controlling terminal is reachable
 * (Windows, CI, piped input) it degrades to {@link readlinePrompt}'s
 * line-mode behavior so nothing hangs.
 *
 * Resolves with `''` (the line-mode variant resolves with the typed line) —
 * the semi-manual suite only cares that the step finished, not the text.
 */
export async function awaitManualStep(
  message: string,
  opts?: { openUrl?: string },
): Promise<string> {
  const url = opts?.openUrl;
  const hint = url
    ? 'Press O to open the checkout in your browser, then Enter when done.'
    : 'Press Enter when done.';

  const term = openControllingTty();
  if (term === null) {
    // No controlling terminal (CI / Windows / piped). Line-mode fallback;
    // surface the URL since there's no live keypress to open it.
    const lines = url ? `${message}\nOpen: ${url}` : message;
    return readlinePrompt(lines);
  }

  const { input, output } = term;
  output.write(`\n[manual setup] ${message}\n${hint}\n`);

  return await new Promise<string>((resolve) => {
    emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();

    const cleanup = (): void => {
      input.removeListener('keypress', onKeypress);
      try {
        input.setRawMode(false);
      } catch {
        /* ignore */
      }
      term.close();
    };

    const onKeypress = (_str: string | undefined, key: { name?: string; ctrl?: boolean }): void => {
      if (key.ctrl && key.name === 'c') {
        // Restore the terminal before dying — raw mode left on would make
        // the shell unusable after the forced exit.
        cleanup();
        process.exit(130);
        return;
      }
      if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        resolve('');
        return;
      }
      if (url && key.name === 'o') {
        openUrl(url);
        output.write(`Opening ${url} …\n${hint}\n`);
      }
    };

    input.on('keypress', onKeypress);
  });
}

export function isInteractiveMode(): boolean {
  return process.env.INTERACTIVE === '1' || process.env.INTERACTIVE === 'true';
}
