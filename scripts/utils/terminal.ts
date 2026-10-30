import { TIME } from '../../src/constants/time';
import { TERMINAL } from '../constants/terminal';

/** Progress UI degrades to plain, stable output when redirected or NO_COLOR is set. */
export function terminal(output: { isTTY?: boolean; write(message: string): unknown } = process.stdout, environment: Readonly<Record<string, string | undefined>> = process.env) {
  const animated = Boolean(output.isTTY && !('NO_COLOR' in environment) && environment.TERM !== 'dumb');
  function line(message: string, color = TERMINAL.cyan) { output.write(`${animated ? color : ''}${message}${animated ? TERMINAL.reset : ''}\n`); }
  async function wait<T>(message: string, work: () => Promise<T>): Promise<T> {
    if (!animated) { line(message); return work(); }
    let frame = 0;
    const started = Date.now();
    const timer = setInterval(() => {
      output.write(`\r\u001b[2K${TERMINAL.cyan}${TERMINAL.spinnerFrames[frame++ % TERMINAL.spinnerFrames.length]} ${message} (${Math.floor((Date.now() - started) / TIME.secondMs)} s)${TERMINAL.reset}`);
    }, TERMINAL.spinnerIntervalMs);
    try { return await work(); }
    finally { clearInterval(timer); output.write('\r\u001b[2K'); }
  }
  return { line, wait, success: (message: string) => line(message, TERMINAL.green), error: (message: string) => line(message, TERMINAL.red) };
}
