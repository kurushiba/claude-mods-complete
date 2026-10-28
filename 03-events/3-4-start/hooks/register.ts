import type { Register } from 'claude-code';

export const register: Register = (on) => {
  on('turn.complete', async ($, e, next) => {
    const done = await next(e);

    if (e.agentId !== undefined) {
      return done;
    }

    const seconds = Math.round(e.durationMs / 1000);
    const text = `${e.isAborted ? 'Stopped after' : 'Done in'} ${seconds} seconds`;

    return { ...done, text };
  });
};
