/* v168: accessible two-tab preparation page; existing forms and state are untouched. */
(() => {
  const tabs = [...document.querySelectorAll('.prep-tab')];
  const panels = [document.getElementById('prep-panel-memo'), document.getElementById('prep-panel-inspiration')];
  const root = document.querySelector('.prep-tabs');
  if (!root || tabs.length !== 2 || panels.some(p => !p)) return;
  function select(index, focus = false) {
    root.classList.toggle('right-active', index === 1);
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
      panels[i].hidden = i !== index;
    });
    if (focus) tabs[index].focus();
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(i));
    tab.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      select(e.key === 'Home' ? 0 : e.key === 'End' ? 1 : e.key === 'ArrowRight' ? (i + 1) % 2 : (i + 1) % 2, true);
    });
  });
  select(0);
})();
