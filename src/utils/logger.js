let _controlCenter = null;

export function setControlCenterForLogger(cc) {
  _controlCenter = cc;
}

export function log(level, message, meta = {}) {
  if (_controlCenter && typeof _controlCenter.log === 'function') {
    _controlCenter.log(level, message, meta);
  } else {
    const out = level === 'error' ? console.error : console.log;
    out(`[${level.toUpperCase()}] ${message}`, meta);
  }
}
