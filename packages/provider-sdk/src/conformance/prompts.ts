import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';

/**
 * Block until the developer enters a response. Wrap in a vitest test only
 * when `harness.prompt` is set AND `INTERACTIVE=1` is in the environment.
 */
export async function readlinePrompt(message: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`\n[manual setup] ${message}\nPress enter when ready: `);
    return answer;
  } finally {
    rl.close();
  }
}

export function isInteractiveMode(): boolean {
  return process.env.INTERACTIVE === '1' || process.env.INTERACTIVE === 'true';
}
