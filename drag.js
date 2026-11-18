// Smooth drag-to-reorder
// ----------------------
// One drag engine for mouse, touch and pen, used for tasks and projects.
//
// - Mouse: press and move a few pixels to start dragging.
// - Touch: press and HOLD for a moment (so normal swipes still scroll the page),
//   or drag a handle straight away.
// - While dragging, the item floats under your finger, a gap shows where it will
//   land, and the other items slide out of the way (a "FLIP" animation).
// - Near the top or bottom of the screen the page scrolls by itself.
//
// Usage: Drag.attach(element, options)
//   itemSelector  which elements are reorderable siblings (e.g. '.task-item')
//   handle        optional selector inside the element that starts a drag at once
//   wholeItem     true = press anywhere on the element (except `ignore`) to drag
//   ignore        selector for controls that must keep working (buttons, inputs…)
//   area          optional: only presses inside this part of the element count
//   resolveDrop(x, y, el)  -> { list, before, highlight? } where the gap should go,
//                             or { dropInto, highlight } to drop into a list without
//                             moving the gap (used for collapsed projects, so the page
//                             doesn't shift under your finger)
//   onDrop({ list, index }) called with the final position (index excludes the item)

const Drag = (() => {
  const HOLD_MS = 350;        // touch: how long to hold before the item lifts
  const TOUCH_SLOP = 8;       // touch: moving more than this before the hold = scrolling
  const MOUSE_SLOP = 5;       // mouse: move this far to start a drag
  const EDGE = 80;            // auto-scroll zone at the top/bottom of the screen

  let pending = null;         // pressed, not yet dragging
  let active = null;          // currently dragging
  let suppressClickUntil = 0; // swallow the click that ends a drag

  // Stop the page from scrolling while a finger drags an item.
  document.addEventListener('touchmove', event => { if (active) event.preventDefault(); }, { passive: false });
  // Long-press would otherwise open the phone's copy/share menu.
  document.addEventListener('contextmenu', event => { if (pending || active) event.preventDefault(); });
  document.addEventListener('click', event => {
    if (Date.now() < suppressClickUntil) { event.stopPropagation(); event.preventDefault(); }
  }, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && active) cancel(); });

  function attach(el, opts) {
    el.addEventListener('pointerdown', event => {
      if (event.button !== 0 || pending || active) return;
      const onHandle = Boolean(opts.handle && event.target.closest(opts.handle));
      if (!onHandle && (!opts.wholeItem || (opts.ignore && event.target.closest(opts.ignore)))) return;
      // `area`: only presses inside this part of the element start a drag (e.g. a project's header).
      if (!onHandle && opts.area && !event.target.closest(opts.area)) return;

      const isTouch = event.pointerType !== 'mouse';
      pending = { el, opts, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, isTouch, timer: null };

      if (isTouch && onHandle) {
        event.preventDefault();
        begin();
      } else if (isTouch) {
        el.classList.add('drag-pressing');
        pending.timer = setTimeout(() => { if (pending) begin(); }, HOLD_MS);
      }
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerCancel);
    });
  }

  function onPointerMove(event) {
    if (pending && event.pointerId === pending.pointerId && !active) {
      pending.x = event.clientX;
      pending.y = event.clientY;
      const distance = Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY);
      if (pending.isTouch && distance > TOUCH_SLOP) return stopPending();   // it's a scroll
      if (!pending.isTouch && distance > MOUSE_SLOP) begin();
      return;
    }
    if (active && event.pointerId === active.pointerId) {
      event.preventDefault();
      active.x = event.clientX;
      active.y = event.clientY;
      update();
    }
  }

  function onPointerUp(event) {
    if (active && event.pointerId === active.pointerId) return finish();
    if (pending && event.pointerId === pending.pointerId) stopPending();
  }

  function onPointerCancel(event) {
    if (active && event.pointerId === active.pointerId) return cancel();
    if (pending && event.pointerId === pending.pointerId) stopPending();
  }

  function stopPending() {
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.el.classList.remove('drag-pressing');
    pending = null;
    if (!active) removeWindowListeners();
  }

  function removeWindowListeners() {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
  }

  function begin() {
    const { el, opts, pointerId, x, y } = pending;
    clearTimeout(pending.timer);
    el.classList.remove('drag-pressing');
    pending = null;

    document.activeElement?.blur?.();
    const rect = el.getBoundingClientRect();
    const placeholder = document.createElement(el.tagName);
    placeholder.className = 'drag-placeholder';
    placeholder.style.height = `${rect.height}px`;
    el.parentNode.insertBefore(placeholder, el);

    el.classList.add('drag-floating');
    el.style.width = `${rect.width}px`;
    el.style.left = `${rect.left}px`;
    el.style.top = `${rect.top}px`;
    document.body.classList.add('is-dragging');
    navigator.vibrate?.(12);

    active = { el, opts, pointerId, placeholder, offsetY: y - rect.top, x, y, scrollTimer: null, highlight: null };
    update();
  }

  // Where an element sits without any in-progress slide animation.
  function layoutRect(node) {
    const rect = node.getBoundingClientRect();
    const transform = getComputedStyle(node).transform;
    const shift = transform && transform !== 'none' ? new DOMMatrixReadOnly(transform).m42 : 0;
    return { top: rect.top - shift, bottom: rect.bottom - shift, height: rect.height };
  }

  // Helper for resolveDrop: first item whose middle is below y.
  function itemAfterY(list, itemSelector, y, skip) {
    for (const child of list.children) {
      if (child === skip || !child.matches(itemSelector)) continue;
      const r = layoutRect(child);
      if (y < r.top + r.height / 2) return child;
    }
    return null;
  }

  function update() {
    const { el, opts, placeholder } = active;
    el.style.top = `${active.y - active.offsetY}px`;
    autoScroll();

    const target = opts.resolveDrop(active.x, active.y, el);
    if (active.highlight !== (target?.highlight || null)) {
      active.highlight?.classList.remove('drop-target');
      active.highlight = target?.highlight || null;
      active.highlight?.classList.add('drop-target');
    }
    active.dropInto = target?.dropInto || null;
    if (!target || !target.list) return;

    let before = target.before;
    while (before === el || before === placeholder) before = before.nextElementSibling;
    let current = placeholder.nextElementSibling;
    while (current === el) current = current.nextElementSibling;
    if (placeholder.parentElement === target.list && current === before) return;

    animateMoves(opts.itemSelector, el, () => target.list.insertBefore(placeholder, before));
  }

  // FLIP: remember positions, change the layout, then slide everything from old to new.
  function animateMoves(itemSelector, skip, change) {
    const nodes = [...document.querySelectorAll(`${itemSelector}, .drag-placeholder`)].filter(n => n !== skip && n.offsetParent);
    const before = new Map(nodes.map(n => [n, layoutRect(n).top]));
    change();
    nodes.forEach(node => {
      if (!node.offsetParent) return;
      const delta = before.get(node) - node.getBoundingClientRect().top;
      if (!delta) return;
      node.style.transition = 'none';
      node.style.transform = `translateY(${delta}px)`;
      void node.offsetWidth;
      node.style.transition = 'transform 170ms ease';
      node.style.transform = '';
    });
  }

  function autoScroll() {
    clearInterval(active.scrollTimer);
    const y = active.y;
    // The pinned header covers the top of the screen, so the scroll zone starts below it.
    const top = (document.getElementById('appbar')?.getBoundingClientRect().bottom || 0) + EDGE;
    const speed = y < top ? -Math.ceil((top - y) / 6) : y > window.innerHeight - EDGE ? Math.ceil((y - (window.innerHeight - EDGE)) / 6) : 0;
    if (!speed) return;
    active.scrollTimer = setInterval(() => {
      window.scrollBy(0, speed);
      if (active) update();
    }, 16);
  }

  function cleanup() {
    const { el, placeholder } = active;
    clearInterval(active.scrollTimer);
    active.highlight?.classList.remove('drop-target');
    placeholder.remove();
    el.classList.remove('drag-floating');
    el.style.width = el.style.left = el.style.top = el.style.transition = '';
    document.body.classList.remove('is-dragging');
    document.querySelectorAll('.task-item, .project-card').forEach(n => { n.style.transform = ''; n.style.transition = ''; });
    active = null;
    removeWindowListeners();
  }

  function finish() {
    const { el, opts, placeholder } = active;
    clearInterval(active.scrollTimer);
    suppressClickUntil = Date.now() + 400;
    if (active.dropInto) {
      const list = active.dropInto;
      cleanup();
      opts.onDrop({ list, index: undefined });   // add to the end of that (collapsed) list
      return;
    }
    const list = placeholder.parentElement;
    const index = [...list.children].filter(c => c !== el && (c === placeholder || c.matches(opts.itemSelector))).indexOf(placeholder);
    const visible = Boolean(placeholder.offsetParent);

    // Glide into the gap, then hand over the result.
    if (visible) {
      el.style.transition = 'top 140ms ease';
      el.style.top = `${placeholder.getBoundingClientRect().top}px`;
    }
    const done = () => { if (!active) return; cleanup(); opts.onDrop({ list, index }); };
    visible ? setTimeout(done, 150) : done();
  }

  function cancel() {
    const { opts } = active;
    cleanup();
    opts.onCancel?.();
  }

  return { attach, itemAfterY, isDragging: () => Boolean(active) };
})();
