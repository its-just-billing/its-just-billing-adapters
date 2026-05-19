import { spawn } from 'node:child_process';
import { platform } from 'node:process';

/**
 * Best-effort "open this URL in the user's default browser", used by the
 * semi-manual conformance suite's "press O to open the checkout" affordance.
 *
 * Fire-and-forget: the child is detached, its stdio ignored, and unref'd so
 * it never keeps the test process (or vitest) alive. Spawn failures are
 * swallowed — a missing `xdg-open` on a headless box must never fail a test;
 * the developer can always fall back to copy/pasting the printed payload.
 */
export function openUrl(url: string): void {
  const [command, args]: [string, string[]] =
    platform === 'darwin'
      ? ['open', [url]]
      : platform === 'win32'
        ? // `start` is a cmd builtin; the empty "" is the (ignored) window
          // title so a URL containing `&` isn't parsed as the title.
          ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];

  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    // Don't crash the test run if the opener binary is missing.
    child.on('error', () => {});
    child.unref();
  } catch {
    // Ignore — opening is a convenience, never a test dependency.
  }
}
