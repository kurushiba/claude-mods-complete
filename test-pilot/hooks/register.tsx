import {
  type Register,
  type EngineInterface,
  atom,
  read,
  update,
} from 'claude-code';
import type { CacheEntry, TestRun } from '../types';

const NPM_TEST = /^\s*npm\s+(test|t|run\s+test)(\s[\s\S]*)?$/;
const PANE = 'test-pilot';

const last = atom({ plugin: 'test-pilot', key: 'last' }, null);

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tests',
      description: '最新のテスト結果を専用の画面で開く',
    });

    await restoreLast($);
    const started = await next(e);

    $.clock.every(60000, () => $.ui.invalidate('ui.render'));

    return started;
  });

  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'clear') {
      await restoreLast($);
    }
    return next(e);
  });

  on('command.run', { command: 'tests' }, async ($, e, next) => {
    await $.ui.open({
      id: PANE,
      title: 'Tests',
      focus: true,
      closeOnEscape: true,
    });
    return { text: 'Testsの画面を開きました' };
  });

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!NPM_TEST.test(e.command)) return next(e);
    const command = e.command.trim();

    const hash = await stateHash($);
    if (hash === undefined) return next(e);

    const prev = (await $.store.get(`cache:${command}`)) as
      | CacheEntry
      | undefined;
    if (prev?.hash === hash) {
      const result = prev.result as { stdout: string };
      const header = `(cached) ${summarize(result.stdout)} - 前回のテストからコードが変わっていないため、実行せずに前回の結果を返しています`;
      return {
        result: { ...result, stdout: `${header}\n\n${result.stdout}` },
      } as never;
    }

    const ran = await next(e);
    if (ran.deny === undefined) {
      const output = ran.text ?? '';
      const isPassed = ran.isError !== true && !/fail [1-9]/.test(output);

      const run: TestRun = {
        summary: summarize(output),
        isPassed,
        at: await $.clock.now(),
        output,
      };
      await update($, last, () => run);
      await $.store.set('last', run);

      if (isPassed) {
        await $.store.set(`cache:${command}`, { hash, result: ran.result });
      } else {
        const opened = await $.ui.open({ id: PANE, title: 'Tests' });
        if (!opened.isPlaced) {
          $.ui.toast('テストが失敗しました。/testsで確認できます');
        }
      }
    }
    return ran;
  });

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const run = await read($, last);
    if (e.props.hasSurvey || run === null) {
      return next(e);
    }

    const others = await next(e);

    const { Box, Text } = $.ui.resolve(e);
    const minutes = Math.floor(((await $.clock.now()) - run.at) / 60000);
    const ago = minutes < 1 ? 'たった今' : `${minutes}分前`;

    return (
      <Box flexDirection="column">
        {others}
        <Box flexDirection="row" gap={1}>
          <Text color={run.isPassed ? 'green' : 'red'}>
            {run.isPassed ? '✔︎' : '×'} {run.summary}
          </Text>
          <Text dimColor>({ago})</Text>
        </Box>
      </Box>
    );
  });

  on(
    'ui.render',
    { component: 'Pane', requestId: PANE },
    async ($, e, next) => {
      const { Box, Text } = $.ui.resolve(e);
      const run = await read($, last);

      if (run === null) {
        return <Text dimColor>まだテストを実行していません</Text>;
      }

      const lines = run.output.split('\n').filter((line) => line.trim() !== '');

      return (
        <Box flexDirection="column" gap={1}>
          <Text color={run.isPassed ? 'green' : 'red'}>
            {run.isPassed ? '✔︎' : '×'} {run.summary}
          </Text>
          {run.isPassed ? (
            <Text dimColor>すべてのテストが通っています</Text>
          ) : (
            <Box flexDirection="column">
              {lines.map((line) => (
                <Text>{line}</Text>
              ))}
            </Box>
          )}
        </Box>
      );
    },
  );
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

function summarize(stdout: string): string {
  const passed = Number(stdout.match(/pass (\d+)/)?.[1] ?? 0);
  const failed = Number(stdout.match(/fail (\d+)/)?.[1] ?? 0);

  return failed > 0 ? `${passed} passed, ${failed} failed` : `${passed} passed`;
}

async function restoreLast($: EngineInterface) {
  const stored = (await $.store.get('last')) as TestRun | undefined;
  if (stored !== undefined) {
    await update($, last, () => stored);
  }
}
