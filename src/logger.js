function createLogger(scope = 'moderation') {
  const write = (level, args) => {
    const payload = {
      ts: new Date().toISOString(),
      level,
      scope,
      message: args.map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '),
    };
    const line = JSON.stringify(payload);
    if (level === 'error' || level === 'warn') console.error(line);
    else console.log(line);
  };

  return {
    info: (...args) => write('info', args),
    warn: (...args) => write('warn', args),
    error: (...args) => write('error', args),
    debug: (...args) => {
      if (process.env.MODERATION_DEBUG === '1') write('debug', args);
    },
  };
}

module.exports = { createLogger };
