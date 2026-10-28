import {
  atom,
  read,
  update,
  type EngineInterface,
  type Register,
} from 'claude-code';
import type { ModelName } from '../types';

const SUBAGENT_AT = 0.7;
const MAIN_AT = 0.9;

const MODELS: Record<ModelName, string> = {
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-5-5',
};

const LOWER: Partial<Record<ModelName, ModelName>> = {
  opus: 'sonnet',
  sonnet: 'haiku',
};

const usage = atom({ plugin: 'budget-guard', key: 'usage' }, null);
const lowered = atom({ plugin: 'budget-guard', key: 'lowered' }, null);
let budget: number | undefined;

function findName(id: string): ModelName | undefined {
  return (Object.keys(MODELS) as ModelName[]).find((name) => id.includes(name));
}

async function usedRate($: EngineInterface): Promise<number> {
  if (budget === undefined) return 0;
  const now = await $.session.usage();
  return (now.cost?.usd ?? 0) / budget;
}

async function refreshUsage($: EngineInterface, model: string) {
  const now = await $.session.usage();
  await update($, usage, () => ({ model, usd: now.cost?.usd ?? 0 }));
}

function bar(rate: number): string {
  const filled = Math.min(10, Math.round(rate * 10));
  return '#'.repeat(filled) + '-'.repeat(10 - filled);
}

function barColor(rate: number): string {
  if (rate >= MAIN_AT) return 'red';
  if (rate >= SUBAGENT_AT) return 'yellow';

  return 'green';
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    budget = (await $.store.get('budget')) as number | undefined;
    await $.command.register({
      name: 'budget',
      description: 'このセッションの予算（ドル）を決める',
      argumentHint: '[金額|off]',
      immediate: true,
    });
    return next(e);
  });

  on('command.run', { command: 'budget' }, async ($, e, next) => {
    const arg = e.args.trim().toLowerCase();

    if (arg === '') {
      return {
        text:
          budget === undefined
            ? '予算は決めていません'
            : `予算は$${budget.toFixed(2)}です`,
      };
    }

    if (arg === 'off') {
      budget = undefined;
      await $.store.delete('budget');
      $.ui.invalidate('ui.render');
      return { text: '予算を外しました' };
    }

    const usd = Number(arg.replace('$', ''));
    if (!Number.isFinite(usd) || usd <= 0) {
      return { text: '使い方:/budget 0.5 | off' };
    }
    budget = usd;
    await $.store.set('budget', usd);
    $.ui.invalidate('ui.render');
    return { text: `予算を$${usd.toFixed(2)}にしました` };
  });

  on('agent.spawn', async ($, e, next) => {
    if (e.fork || (await usedRate($)) < SUBAGENT_AT) {
      return next(e);
    }

    $.ui.log(
      `予算の${SUBAGENT_AT * 100}%を超えたので、「${e.description}」をHaikuで動かします。`,
    );

    return next({ ...e, model: 'haiku' });
  });

  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) {
      return yield* next(e);
    }

    let to = await read($, lowered);
    if (to === null && (await usedRate($)) >= MAIN_AT) {
      const current = findName(e.model);
      to = current === undefined ? null : (LOWER[current] ?? null);
      if (to !== null) {
        await update($, lowered, () => to);
        $.ui.toast(
          `予算の${MAIN_AT * 100}%を超えました。メインを${to}に切り替えます`,
        );
      }
    }

    const step = to === null ? e : { ...e, model: MODELS[to] };
    const result = yield* next(step);
    await refreshUsage($, result.usage?.model ?? step.model);
    return result;
  });

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const now = await read($, usage);
    const to = await read($, lowered);
    if (e.props.hasSurvey || now === null) {
      return next(e);
    }

    const others = await next(e);
    const { Box, Text } = $.ui.resolve(e);
    const rate = budget === undefined ? 0 : now.usd / budget;

    return (
      <Box flexDirection="column">
        {others}
        <Box flexDirection="row" gap={1}>
          <Text>{findName(now.model) ?? now.model}</Text>
          {budget !== undefined && (
            <Text color={barColor(rate)}>{bar(rate)}</Text>
          )}
          <Text dimColor>
            {budget === undefined
              ? `$${now.usd.toFixed(2)}`
              : `$${now.usd.toFixed(2)} / $${budget.toFixed(2)}`}
          </Text>
          {to !== null && <Text dimColor>({to} に切り替え済み)</Text>}
        </Box>
      </Box>
    );
  });
};
