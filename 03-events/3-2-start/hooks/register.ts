import type { Register } from 'claude-code';

export const register: Register = (on) => {
  on('tool.call', { tool: ['Edit', 'Write'] }, async ($, e, next) => {
    const ran = await next(e);
    const isDone = ran.deny === undefined && ran.isError !== true;

    if (isDone && e.file_path.endsWith('.md')) {
      $.ui.log(`Claude changed ${e.file_path}`);
    }

    return ran;
  });

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (e.command.includes('rm -rf')) {
      return {
        deny: 'rm -rfは使わないでください。消すファイルをひとつづつ指定してrmしてください。',
      };
    }

    if (e.command.trim() === 'whoami') {
      return {
        result: {
          stdout: 'claude-mods-student',
          stderr: '',
          interrupted: false,
        },
      };
    }

    $.ui.log(`Bash: ${e.command}`);
    return next(e);
  });
};
