export const BUILD_INFO = typeof __HERMES_BUILD_INFO__ === 'undefined'
  ? { version: 'development', commit: 'local', run: null, attempt: null }
  : __HERMES_BUILD_INFO__;
