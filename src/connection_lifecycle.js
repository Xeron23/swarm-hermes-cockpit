// An OS/network hint is not proof that Hermes is reachable.
export function bindConnectionLifecycle(workspace, win = window, doc = document) {
  let hidden = doc.visibilityState === 'hidden';
  let resumeTimer;
  let blurredAt = null;
  const wake = () => {
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => {
      if (!hidden) workspace.resume().catch(() => {});
    }, 150);
  };
  const visibility = () => {
    hidden = doc.visibilityState === 'hidden';
    if (hidden) { clearTimeout(resumeTimer); workspace.suspend(); }
    else wake();
  };
  const leave = () => { hidden = true; clearTimeout(resumeTimer); workspace.suspend(); };
  const show = () => { hidden = doc.visibilityState === 'hidden'; wake(); };
  const blur = () => { blurredAt = Date.now(); };
  // Keep a healthy socket through a brief focus change; reopen after a longer pause.
  const focus = () => {
    if (!hidden && blurredAt !== null && Date.now() - blurredAt >= 15000 && workspace.state.status === 'connected') workspace.suspend();
    blurredAt = null;
    wake();
  };
  const listeners = [[doc, 'visibilitychange', visibility], [win, 'online', wake],
    [win, 'offline', () => { workspace.suspend(); wake(); }],
    [win, 'pageshow', show], [win, 'pagehide', leave], [win, 'blur', blur], [win, 'focus', focus]];
  for (const [target, name, handler] of listeners) target.addEventListener(name, handler);
  if (!hidden) wake();
  return () => {
    clearTimeout(resumeTimer);
    for (const [target, name, handler] of listeners) target.removeEventListener(name, handler);
    workspace.suspend();
  };
}
