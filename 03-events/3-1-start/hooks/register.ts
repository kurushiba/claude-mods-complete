import type { Register } from 'claude-code';

export const register: Register = (on) => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    $.ui.log(`Bashだけに反応: ${e.command}`);
    return next(e);
  });

  on('tool.call', { tool: ['Edit', 'Write'] }, async ($, e, next) => {
    $.ui.log(`EditかWriteに反応: ${e.tool}`);
    return next(e);
  });

  on('tool.call', { tool: /^Web/ }, async ($, e, next) => {
    $.ui.log(`Webのツールに反応: ${e.tool}`);
    return next(e);
  });

  on('turn.*', async ($, e, next) => {
    $.ui.log(`ターンのイベント: ${next.event}`);
    return next(e);
  });
};
