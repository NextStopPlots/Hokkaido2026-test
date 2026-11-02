/* v165: one outer shadow for the middle grey tab and its flight card. */
(() => {
  const section = document.querySelector('.accommodation-view .accommodation-section');
  const tabs = section?.querySelector('.accommodation-tabs');
  const panel = section?.querySelector('#flight-panel');
  const flights = panel?.querySelector('.flights-section');
  if (!section || !tabs || !panel || !flights) return;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'booking-unified-shadow');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('preserveAspectRatio', 'none');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('fill', '#f3f2ef');
  svg.appendChild(path);
  section.insertBefore(svg, tabs);
  function sync() {
    const shown = !panel.hidden && !flights.hidden && tabs.classList.contains('middle-active');
    svg.style.display = shown ? 'block' : 'none';
    if (!shown) return;
    const sectionBox = section.getBoundingClientRect();
    const tabBox = tabs.getBoundingClientRect();
    const flightBox = flights.getBoundingClientRect();
    const w = tabBox.width;
    const h = flightBox.bottom - tabBox.top;
    if (!w || h <= 0) return;
    svg.style.left = `${tabBox.left - sectionBox.left}px`;
    svg.style.top = `${tabBox.top - sectionBox.top}px`;
    svg.style.width = `${w}px`;
    svg.style.height = `${h}px`;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const sx = w / 390;
    const sy = 48.6667 / 65;
    const base = tabBox.height - 48.6667;
    const x = n => +(n*sx).toFixed(3);
    const y = n => +(base+n*sy).toFixed(3);
    const radius = Math.min(22,w/8,h/8);
    // The active middle tab is taller than both side tabs. The lower
    // portion is a full-width card, joined without an internal shadow seam.
    path.setAttribute('d', [
      `M 0 ${y(65)} L 0 ${y(36.25)}`,
      `Q 0 ${y(14.25)} ${x(22)} ${y(14.25)}`,
      `L ${x(112)} ${y(14.25)}`,
      `Q ${x(121.019)} ${y(14.25)} ${x(123.547)} ${y(46.64)}`,
      `L ${x(130.167)} ${y(9.09)}`,
      `Q ${x(131.77)} ${y(0)} ${x(141)} ${y(0)}`,
      `L ${x(249)} ${y(0)}`,
      `Q ${x(258.23)} ${y(0)} ${x(259.833)} ${y(9.09)}`,
      `L ${x(266.453)} ${y(46.64)}`,
      `Q ${x(268.981)} ${y(14.25)} ${x(278)} ${y(14.25)}`,
      `L ${x(368)} ${y(14.25)}`,
      `Q ${w} ${y(14.25)} ${w} ${y(36.25)}`,
      `L ${w} ${h-radius} Q ${w} ${h} ${w-radius} ${h}`,
      `L ${radius} ${h} Q 0 ${h} 0 ${h-radius} Z`
    ].join(' '));
  }
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(sync);
    observer.observe(tabs);
    observer.observe(flights);
  }
  new MutationObserver(sync).observe(panel, {attributes:true,attributeFilter:['hidden']});
  new MutationObserver(sync).observe(tabs, {attributes:true,attributeFilter:['class']});
  new MutationObserver(sync).observe(flights, {attributes:true,attributeFilter:['hidden']});
  window.addEventListener('resize',sync);
  requestAnimationFrame(sync);
})();
