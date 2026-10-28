import type { Register, EngineInterface } from 'claude-code';

const NPM_TEST = /^\s*npm\s+(test|t|run\s+test)(\s[\s\S]*)?$/;

export const register: Register = (on) => {
  const last = new Map<string, { hash: string; result: unknown }>();

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!NPM_TEST.test(e.command)) return next(e);
    const command = e.command.trim();

    const hash = await stateHash($);
    if (hash === undefined) return next(e);

    const prev = last.get(command);
    if (prev?.hash === hash) return { result: prev.result } as never;

    const ran = await next(e);
    if (ran.deny === undefined && ran.isError !== true)
      last.set(command, { hash, result: ran.result });
    return ran;
  });
};

async function git(
  $: EngineInterface,
  argv: string[],
  stdin?: string,
): Promise<string> {
  const r = await $.process.run(
    ['git', ...argv],
    stdin === undefined ? undefined : { stdin },
  );
  if (r.exitCode !== 0) throw new Error(`git ${argv[0]} failed`);
  return r.stdout;
}

// One hash from HEAD plus every uncommitted change (tracked diff and untracked names and contents).
async function stateHash($: EngineInterface): Promise<string | undefined> {
  try {
    const head = await git($, ['rev-parse', 'HEAD']);
    const diff = await git($, ['diff', 'HEAD']);
    const untracked = await git($, [
      'ls-files',
      '--others',
      '--exclude-standard',
    ]);
    const files = untracked.split('\n').filter((f) => f !== '');
    const contents =
      files.length === 0 ? '' : await git($, ['hash-object', '--', ...files]);
    const hash = await git(
      $,
      ['hash-object', '--stdin'],
      `${head}\n${diff}\n${untracked}\n${contents}`,
    );
    return hash.trim() || undefined;
  } catch {
    return undefined;
  }
}
