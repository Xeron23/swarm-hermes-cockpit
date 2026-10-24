/* Shared motion and touch behavior for every Hermes dialog. No network dependencies. */
window.HermesUI = (() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const mobile = window.matchMedia('(max-width: 900px)');
  const ease = 'cubic-bezier(.22,1,.36,1)';
  let session = null;
  let lastView = '';
  let lastMessageCount = 0;
  let lastFeedId = '';

  function animate(element, frames, options = {}) {
    if (!element || reducedMotion.matches || !element.animate) return null;
    return element.animate(frames, { duration: 360, easing: ease, ...options });
  }

  function paint({ page, agent, messageCount = 0, feedId = '' }) {
    const filter = document.querySelector('.filter-row .filter-chip.active')?.textContent || '';
    const view = page === 'chat' ? `chat:${agent}` : `${page}:${filter}`;
    const entering = view !== lastView;
    if (entering) {
      animate(document.querySelector('#page-content'), [
        { opacity: 0, transform: 'translate3d(0,12px,0)' },
        { opacity: 1, transform: 'translate3d(0,0,0)' }
      ]);
      const cards = document.querySelectorAll('.mission-card,.quick-stats,.node-card,.agent-card,.fleet-row,.feed-item');
      cards.forEach((card, index) => animate(card, [
        { opacity: 0, transform: 'translate3d(0,14px,0)' },
        { opacity: 1, transform: 'translate3d(0,0,0)' }
      ], { duration: 470, delay: Math.min(index * 32, 210), fill: 'backwards' }));
      document.querySelectorAll('.metric-track>i,.segmented-progress .filled').forEach((bar, index) => animate(bar, [
        { transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }
      ], { duration: 700, delay: Math.min(index * 35, 220), fill: 'backwards' }));
      animate(document.querySelector('.bottom-nav button.active .icon'), [
        { transform: 'translateY(3px) scale(.88)' },
        { transform: 'translateY(-2px) scale(1.08)', offset: .65 },
        { transform: 'translateY(0) scale(1)' }
      ], { duration: 420 });
    }
    if (page === 'chat' && (entering || messageCount > lastMessageCount)) {
      animate(document.querySelector('.message:last-of-type'), [
        { opacity: 0, transform: 'translate3d(0,12px,0) scale(.98)' },
        { opacity: 1, transform: 'translate3d(0,0,0) scale(1)' }
      ], { duration: 320 });
    }
    if (!entering && feedId !== lastFeedId) {
      animate(document.querySelector('.feed-item'), [
        { opacity: 0, transform: 'translate3d(-10px,0,0)' },
        { opacity: 1, transform: 'translate3d(0,0,0)' }
      ]);
    }
    lastView = view;
    lastMessageCount = messageCount;
    lastFeedId = feedId;
  }

  function viewport() {
    const v = window.visualViewport;
    document.documentElement.style.setProperty('--viewport-height', `${v?.height || window.innerHeight}px`);
    document.documentElement.style.setProperty('--viewport-top', `${v?.offsetTop || 0}px`);
  }
  viewport();
  window.addEventListener('resize', viewport, { passive: true });
  window.visualViewport?.addEventListener('resize', viewport, { passive: true });
  window.visualViewport?.addEventListener('scroll', viewport, { passive: true });

  function unlock(s) {
    document.body.classList.remove('modal-open');
    document.body.style.removeProperty('--scroll-lock-top');
    document.getElementById('app').inert = false;
    window.scrollTo(0, s.scrollY);
  }

  function closeSheet() {
    const s = session;
    if (!s) return;
    session = null;
    s.controller.abort();
    s.overlay.style.pointerEvents = 'none';
    s.sheet.inert = true;
    s.sheet.getAnimations().forEach(a => a.cancel());
    unlock(s);
    s.onDismiss?.();
    const from = getComputedStyle(s.sheet).transform;
    const movement = animate(s.sheet, [
      { transform: from === 'none' ? 'translate3d(0,0,0)' : from, opacity: 1 },
      { transform: mobile.matches ? `translate3d(0,${s.sheet.offsetHeight + 35}px,0)` : 'translate3d(0,14px,0) scale(.98)', opacity: mobile.matches ? 1 : 0 }
    ], { duration: mobile.matches ? 250 : 160, easing: 'cubic-bezier(.32,0,.67,0)', fill: 'forwards' });
    animate(s.overlay, [{ backgroundColor: getComputedStyle(s.overlay).backgroundColor, backdropFilter: 'blur(5px)' },
      { backgroundColor: 'rgba(66,38,31,0)', backdropFilter: 'blur(0px)' }], { duration: 240, fill: 'forwards' });
    // Remove this overlay only: a new dialog may already have opened.
    let ended = false;
    let deadline;
    const finish = () => {
      if (ended) return;
      ended = true;
      clearTimeout(deadline);
      s.overlay.remove();
      if (!session && s.returnFocus?.isConnected && !document.activeElement?.matches('input,textarea,select')) {
        s.returnFocus.focus({ preventScroll: true });
      }
    };
    if (movement) {
      movement.finished.then(finish, finish);
      deadline = setTimeout(finish, 400);
    } else finish();
  }

  function openSheet({ title, subtitle, body, footer, wide, onDismiss }) {
    const root = document.getElementById('overlay-root');
    let s = session;
    const replacing = Boolean(s);
    const focused = document.activeElement;
    const focusedAction = focused?.dataset?.action;
    const focusedTab = focused?.dataset?.tab;
    if (!s) {
      // A previous exit animation must not leave an invisible hit target behind.
      root.replaceChildren();
      root.innerHTML = `<div class="overlay" id="overlay-backdrop"><section class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" aria-describedby="sheet-description"><div class="sheet-drag-zone" role="button" tabindex="0" aria-label="Swipe down or press Enter to close dialog"><span class="sheet-handle" aria-hidden="true"></span><span class="sheet-drag-hint">Tarik ke bawah untuk menutup</span></div><header class="sheet-header"></header><div class="sheet-body"></div><footer class="sheet-footer"></footer></section></div>`;
      s = session = {
        overlay: root.firstElementChild,
        sheet: root.querySelector('.sheet'),
        controller: new AbortController(),
        scrollY: window.scrollY,
        returnFocus: focused,
        onDismiss
      };
      document.body.style.setProperty('--scroll-lock-top', `${-s.scrollY}px`);
      document.body.classList.add('modal-open');
      bindGestures(s);
      animate(s.overlay, [{ backgroundColor: 'rgba(66,38,31,0)', backdropFilter: 'blur(0px)' },
        { backgroundColor: 'rgba(66,38,31,.28)', backdropFilter: 'blur(5px)' }], { duration: 260 });
      animate(s.sheet, [
        { transform: mobile.matches ? 'translate3d(0,100%,0)' : 'translate3d(0,18px,0) scale(.97)', opacity: mobile.matches ? 1 : 0 },
        { transform: 'translate3d(0,0,0) scale(1)', opacity: 1 }
      ], { duration: mobile.matches ? 480 : 300 });
    }
    s.onDismiss = onDismiss;
    s.sheet.classList.toggle('wide', wide);
    s.sheet.querySelector('.sheet-header').innerHTML = `<div><h2 id="sheet-title">${title}</h2><p id="sheet-description">${subtitle || ''}</p></div><button class="icon-button" data-action="close" aria-label="Close dialog"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button>`;
    const content = s.sheet.querySelector('.sheet-body');
    content.innerHTML = body;
    content.scrollTop = 0;
    const foot = s.sheet.querySelector('.sheet-footer');
    foot.innerHTML = footer || '';
    foot.hidden = !footer;
    if (replacing) animate(content, [{ opacity: .25, transform: 'translateY(5px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 220 });
    const nextFocus = focusedTab ? [...s.sheet.querySelectorAll('[data-tab]')].find(b => b.dataset.tab === focusedTab && b.dataset.action === focusedAction) : null;
    (nextFocus || s.sheet.querySelector('.sheet-header button')).focus({ preventScroll: true });
    document.getElementById('app').inert = true;
    viewport();
  }

  function bindGestures(s) {
    const { sheet, overlay, controller } = s;
    const signal = controller.signal;
    const body = sheet.querySelector('.sheet-body');
    const zone = sheet.querySelector('.sheet-drag-zone');
    const header = sheet.querySelector('.sheet-header');
    let drag = null;
    let swallowClick = false;
    const blocked = target => target.closest('button,input,textarea,select,a,[contenteditable="true"],.terminal pre');

    function start(x, y, source, id = null) {
      if (!mobile.matches) return;
      const t = performance.now();
      drag = { x, y, source, id, distance: 0, time: t, lastY: y, lastTime: t, velocity: 0, active: false };
    }

    function move(x, y, event) {
      if (!drag) return;
      const dx = x - drag.x;
      const dy = y - drag.y;
      if (!drag.active) {
        if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) { drag = null; return; }
        if (drag.source === 'content' && (dy < -5 || body.scrollTop > 1)) { drag = null; return; }
        if (dy < 5 || dy < Math.abs(dx) * 1.15) return;
        drag.active = true;
        sheet.getAnimations().forEach(a => a.cancel());
        sheet.classList.add('is-dragging');
        document.activeElement?.blur();
      }
      if (event.cancelable) event.preventDefault();
      const t = performance.now();
      drag.velocity = (y - drag.lastY) / Math.max(t - drag.lastTime, 1);
      drag.lastY = y;
      drag.lastTime = t;
      drag.distance = Math.max(0, dy);
      sheet.style.transform = `translate3d(0,${drag.distance}px,0)`;
      overlay.style.backgroundColor = `rgba(66,38,31,${.28 * (1 - Math.min(.8, drag.distance / sheet.offsetHeight))})`;
    }

    function finish(cancelled = false) {
      const d = drag;
      drag = null;
      if (!d?.active) return;
      swallowClick = true;
      setTimeout(() => { swallowClick = false; }, 350);
      sheet.classList.remove('is-dragging');
      const threshold = Math.min(125, sheet.offsetHeight * .22);
      const velocity = performance.now() - d.lastTime < 100 ? d.velocity : 0;
      if (!cancelled && (d.distance > threshold || (d.distance > 32 && velocity > .65))) {
        closeSheet();
        return;
      }
      animate(sheet, [{ transform: `translate3d(0,${d.distance}px,0)` }, { transform: 'translate3d(0,0,0)' }], {
        duration: 450, easing: 'cubic-bezier(.16,1.15,.3,1)'
      });
      sheet.style.transform = '';
      overlay.style.backgroundColor = '';
    }

    [zone, header].forEach(handle => {
      handle.addEventListener('pointerdown', event => {
        if (event.button !== 0 || blocked(event.target)) return;
        start(event.clientX, event.clientY, 'handle', event.pointerId);
        if (drag) handle.setPointerCapture(event.pointerId);
      }, { signal });
      handle.addEventListener('pointermove', event => {
        if (drag?.id === event.pointerId) move(event.clientX, event.clientY, event);
      }, { signal });
      handle.addEventListener('pointerup', event => {
        if (drag?.id === event.pointerId) finish();
      }, { signal });
      handle.addEventListener('pointercancel', () => finish(true), { signal });
      handle.addEventListener('lostpointercapture', () => finish(true), { signal });
    });
    // Preserve native content scrolling; dismiss from content only at its top edge.
    body.addEventListener('touchstart', event => {
      if (event.touches.length !== 1 || body.scrollTop > 1 || blocked(event.target)) return;
      const touch = event.touches[0];
      start(touch.clientX, touch.clientY, 'content', touch.identifier);
    }, { signal, passive: true });
    body.addEventListener('touchmove', event => {
      if (drag?.source !== 'content') return;
      if (event.touches.length !== 1) { finish(true); return; }
      const touch = event.touches[0];
      move(touch.clientX, touch.clientY, event);
    }, { signal, passive: false });
    body.addEventListener('touchend', () => { if (drag?.source === 'content') finish(); }, { signal });
    body.addEventListener('touchcancel', () => finish(true), { signal });
    sheet.addEventListener('click', event => {
      if (!swallowClick) return;
      event.preventDefault();
      event.stopPropagation();
    }, { signal, capture: true });
    zone.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); closeSheet(); }
    }, { signal });
  }

  document.addEventListener('pointerdown', event => {
    const button = event.target.closest('.primary-button,.secondary-button,.icon-button,.send-button,.filter-chip,.route-option,.bottom-nav button');
    if (!button || button.disabled || reducedMotion.matches) return;
    const rect = button.getBoundingClientRect();
    const ripple = document.createElement('span');
    const size = Math.max(rect.width, rect.height) * 2;
    ripple.className = 'touch-ripple';
    ripple.style.cssText = `width:${size}px;height:${size}px;left:${event.clientX - rect.left - size / 2}px;top:${event.clientY - rect.top - size / 2}px`;
    button.append(ripple);
    ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
  }, { passive: true });

  return { paint, openSheet, closeSheet };
})();
