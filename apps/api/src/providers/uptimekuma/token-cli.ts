/**
 * pnpm --filter @weblion/api kuma:token -- --url https://status.example.ch --user admin
 *
 * Signs in to Uptime Kuma once (password and, if enabled, the two-factor code read from the
 * terminal without echo) and prints only the session token, for UPTIMEKUMA_SESSION_TOKEN.
 * Prompts and errors go to stderr. The password is never written anywhere.
 */
import { createInterface, type Interface } from 'node:readline';
import { AppError } from '../../lib/errors';
import { kumaSignIn } from './socket';

const USAGE = 'Usage: pnpm --filter @weblion/api kuma:token -- --url https://status.example.ch --user admin';

function argValue(args: string[], name: string): string | null {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (arg === `--${name}`) return args[i + 1] ?? null;
    if (arg.startsWith(`--${name}=`)) return arg.slice(name.length + 3);
  }
  return null;
}

/** The base URL as the console stores it: http(s), no path, no credentials, no trailing slash. */
function baseUrl(raw: string): string | null {
  if (!URL.canParse(raw)) return null;
  const u = new URL(raw);
  const ok =
    (u.protocol === 'https:' || u.protocol === 'http:') &&
    (u.pathname === '/' || u.pathname === '') &&
    !u.search &&
    !u.hash &&
    !u.username &&
    !u.password;
  return ok ? raw.trim().replace(/\/+$/, '') : null;
}

/**
 * Questions on stdin, answered line by line. Lines that arrive before their question (piped
 * input) are queued, so "printf 'pw\ncode\n' | kuma:token ..." works as well as a terminal.
 */
class Prompter {
  private readonly lines: string[] = [];
  private waiting: ((line: string | null) => void) | null = null;
  private closed = false;

  constructor(private readonly rl: Interface) {
    rl.on('line', (line) => {
      const waiting = this.waiting;
      this.waiting = null;
      if (waiting) waiting(line);
      else this.lines.push(line);
    });
    rl.on('close', () => {
      this.closed = true;
      this.waiting?.(null);
      this.waiting = null;
    });
  }

  /** One answer, or null when stdin ended. With `hidden`, nothing typed is echoed on a terminal. */
  async ask(question: string, hidden: boolean): Promise<string | null> {
    const out = this.rl as unknown as { _writeToOutput?: (text: string) => void };
    const original = out._writeToOutput;
    process.stderr.write(question);
    if (hidden && process.stdin.isTTY) out._writeToOutput = () => undefined;
    try {
      const queued = this.lines.shift();
      if (queued !== undefined) return queued;
      if (this.closed) return null;
      return await new Promise<string | null>((resolve) => (this.waiting = resolve));
    } finally {
      out._writeToOutput = original;
      // Nothing was echoed (hidden, or piped input): end the prompt line.
      if (hidden || !process.stdin.isTTY) process.stderr.write('\n');
    }
  }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const rawUrl = argValue(args, 'url');
  const username = argValue(args, 'user');
  if (!rawUrl || !username) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const url = baseUrl(rawUrl);
  if (!url) {
    process.stderr.write('The URL must be https://<Kuma address>[:port] without path or credentials.\n');
    return 2;
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: !!process.stdin.isTTY,
  });
  const prompter = new Prompter(rl);
  try {
    const password = await prompter.ask(`Password for ${username} at ${url}: `, true);
    if (!password) {
      process.stderr.write('No password entered.\n');
      return 1;
    }
    let totp: string | undefined;
    for (let attempt = 0; ; attempt++) {
      try {
        const { token, version } = await kumaSignIn(url, { username, password, totp });
        process.stderr.write(`Signed in${version ? ` (Uptime Kuma ${version})` : ''}. Session token:\n`);
        process.stdout.write(`${token}\n`);
        return 0;
      } catch (err) {
        const code = err instanceof AppError ? err.code : null;
        if (code !== 'totp_required' && code !== 'totp_invalid') throw err;
        if (code === 'totp_invalid') process.stderr.write('The two-factor code was not accepted.\n');
        // The first attempt goes without a code, then up to three codes.
        if (attempt >= 3) {
          process.stderr.write('No valid two-factor code after 3 attempts.\n');
          return 1;
        }
        totp = (await prompter.ask('Two-factor code: ', true))?.trim();
        if (!totp) {
          process.stderr.write('No two-factor code entered.\n');
          return 1;
        }
      }
    }
  } finally {
    rl.close();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    // Messages of kumaSignIn never contain the password or the code.
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  },
);
