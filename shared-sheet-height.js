/* v198: keep the two entry sheets the same natural height without pinning either to viewport height. */
(() => {
  const selectors = [
    ['#wishlist-dialog', '.wishlist-entry-scroll', '.v178-sheet-handle-space'],
    ['.ledger-entry-sheet', '.ledger-entry-sheet-scroll', '.ledger-entry-sheet-handle-zone']
  ];
  let scheduled = false;
  function intrinsicHeight(selector, scrollSelector, handleSelector) {
    const original = document.querySelector(selector);
    if (!original) return 0;
    const clone = original.cloneNode(true);
    clone.removeAttribute('id');
    if (selector === '#wishlist-dialog') {
      clone.id = 'wishlist-dialog';
      clone.setAttribute('open', '');
    }
    Object.assign(clone.style, {
      position: 'fixed', left: '0', right: 'auto', top: '0', bottom: 'auto',
      width: Math.min(window.innerWidth, 560) + 'px',
      height: 'auto', maxHeight: 'none', minHeight: '0',
      visibility: 'hidden', pointerEvents: 'none', transform: 'none',
      overflow: 'visible', zIndex: '-1'
    });
    clone.style.setProperty('--shared-entry-sheet-height', 'auto');
    document.body.appendChild(clone);
    const scroll = clone.querySelector(scrollSelector);
    const handle = clone.querySelector(handleSelector);
    const actions = clone.querySelector('.ledger-entry-sheet-actions');
    if (scroll) {
      scroll.style.flex = '0 0 auto';
      scroll.style.height = 'auto';
      scroll.style.maxHeight = 'none';
      scroll.style.overflow = 'visible';
    }
    const h = (handle?.getBoundingClientRect().height || 0)
      + (scroll?.scrollHeight || 0)
      + (actions?.getBoundingClientRect().height || 0);
    clone.remove();
    return h;
  }
  function update() {
    scheduled = false;
    const sizes = selectors.map(args => intrinsicHeight(...args));
    if (sizes.every(Boolean)) {
      const height = Math.ceil(Math.max(...sizes));
      document.documentElement.style.setProperty('--shared-entry-sheet-height', height + 'px');
    }
  }
  function schedule() {
    if (!scheduled) { scheduled = true; requestAnimationFrame(update); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule);
  else schedule();
  window.addEventListener('resize', schedule);
  document.addEventListener('click', schedule, true);
  document.addEventListener('input', schedule, true);
  const dialog = document.getElementById('wishlist-dialog');
  if (dialog) new MutationObserver(schedule).observe(dialog, {attributes:true, attributeFilter:['open']});
  const root = document.getElementById('ledger-root');
  if (root) new MutationObserver(schedule).observe(root, {childList:true});
})();
