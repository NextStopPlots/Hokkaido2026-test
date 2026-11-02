/* v170: one floating creation action for prep tabs and ledger. */
(() => {
  const fab = document.getElementById('v170-fab');
  if (!fab) return;
  const todo = document.getElementById('todo-dialog');
  const wishlist = document.getElementById('wishlist-dialog');
  const open = (dialog, input) => {
    if (!dialog || dialog.open) return;
    dialog.showModal();
    if (dialog === wishlist) dialog.querySelector('.v178-sheet-handle')?.focus({ preventScroll: true });
    if (dialog === todo) { const el=dialog.querySelector(input); if(el) { el.value=''; /* memo focus intentionally not forced */ } }
  };
  fab.addEventListener('click', () => {
    const view = document.body.dataset.activeView;
    if (view === 'prep') {
      if (document.getElementById('prep-tab-inspiration')?.getAttribute('aria-selected') === 'true') open(wishlist, null);
      else open(todo, '#todo-input');
    } else if (view === 'ledger') {
      const root = document.getElementById('ledger-root');
      const original = root?.querySelector('[data-ledger-action="open-entry-sheet"]');
      if (original) original.click();
      else window.dispatchEvent(new CustomEvent('hokkaido:open-ledger-entry'));
    }
  });
  document.querySelectorAll('[data-close-dialog]').forEach(btn => btn.addEventListener('click', () => document.getElementById(btn.dataset.closeDialog)?.close()));
  [todo,wishlist].forEach(dialog => dialog?.addEventListener('click', e => { if (e.target === dialog) dialog.close(); }));
})();


/* v178: swipe down from wishlist sheet handle/heading to cancel. */
(() => {
 const sheet=document.getElementById('wishlist-dialog');
 if(!sheet)return;
 let start=null, delta=0;
 sheet.addEventListener('pointerdown',e=>{if(!e.target.closest('.v178-sheet-handle,.v170-dialog-heading'))return;start=e.clientY;delta=0;});
 sheet.addEventListener('pointermove',e=>{if(start===null)return;delta=Math.max(0,e.clientY-start);sheet.style.transform=`translateY(${delta}px)`;});
 const end=()=>{if(start===null)return;const shouldClose=delta>=120;start=null;delta=0;sheet.style.transform='';if(shouldClose&&sheet.open)sheet.close();};
 sheet.addEventListener('pointerup',end);sheet.addEventListener('pointercancel',()=>{start=null;delta=0;sheet.style.transform='';});
 sheet.addEventListener('close',()=>{start=null;delta=0;sheet.style.transform='';});
})();
