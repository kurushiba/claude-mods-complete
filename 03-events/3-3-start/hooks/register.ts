import type { Register } from 'claude-code';

export const register: Register = (on) => {
  on('prompt.submit', async ($, e, next) => {
    if (!/\bPR\b|プルリク/i.test(e.text)) {
      return next(e);
    }

    try {
      const { exitCode, stdout } = await $.process.run([
        'git',
        'branch',
        '--show-current',
      ]);
      const branch = stdout.trim();

      if (exitCode !== 0 || branch === '') {
        return next(e);
      }

      const context = [...(e.context ?? []), `Current branch: ${branch}`];
      return next({ ...e, context });
    } catch {
      return next(e);
    }
  });
};
