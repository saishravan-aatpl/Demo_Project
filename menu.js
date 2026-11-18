// Pop-up menu for the ⋯ buttons
// ------------------------------
// ActionMenu.open(button, items) shows a small menu next to the button.
// items: [{ label, onClick, danger?, indent?, disabled? } | { heading }
//         | { label, submenu: [...items] }]   (a submenu opens inside the same box)
// Tapping outside, pressing Escape, or choosing an item closes it.
// Works with the keyboard too: arrow keys move between items.

const ActionMenu = (() => {
  let menu = null;
  let anchor = null;
  let lastPointer = 0;   // opened with mouse/finger: don't pre-highlight the first item
  document.addEventListener('pointerdown', () => { lastPointer = Date.now(); }, true);

  function close() {
    if (!menu) return;
    menu.remove();
    menu = null;
    anchor?.setAttribute('aria-expanded', 'false');
    anchor = null;
  }

  function open(anchorEl, items) {
    const sameButton = anchor === anchorEl;
    close();
    if (sameButton) return;               // second tap on the same ⋯ closes it

    anchor = anchorEl;
    anchor.setAttribute('aria-expanded', 'true');
    menu = document.createElement('div');
    menu.className = 'action-menu';
    menu.setAttribute('role', 'menu');
    menu.tabIndex = -1;
    menu.addEventListener('click', event => event.stopPropagation());
    menu.addEventListener('pointerdown', event => event.stopPropagation());
    menu.addEventListener('keydown', onMenuKey);
    document.body.appendChild(menu);
    show(items);
  }

  function show(items, parentItems = null) {
    menu.innerHTML = '';
    if (parentItems) {
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'action-menu-item back';
      back.textContent = '‹ Back';
      back.addEventListener('click', event => { event.stopPropagation(); show(parentItems); });
      menu.appendChild(back);
    }

    items.forEach(item => {
      if (item.heading) {
        const heading = document.createElement('div');
        heading.className = 'action-menu-heading';
        heading.textContent = item.heading;
        menu.appendChild(heading);
        return;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `action-menu-item${item.danger ? ' danger' : ''}${item.indent ? ' indent' : ''}${item.submenu ? ' has-submenu' : ''}`;
      button.textContent = item.label;
      button.setAttribute('role', 'menuitem');
      button.disabled = Boolean(item.disabled);
      button.addEventListener('click', event => {
        event.stopPropagation();
        if (item.submenu) return show(item.submenu, items);
        close();
        item.onClick();
      });
      menu.appendChild(button);
    });

    place();
    // From the keyboard: highlight the first item. From a mouse/tap: just listen
    // for arrow keys (the first ↓ then highlights the first item).
    if (Date.now() - lastPointer < 800) menu.focus({ preventScroll: true });
    else menu.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
  }

  // Keyboard: ↑/↓ move, Home/End jump, → opens a submenu, ← goes back,
  // Enter/Space choose, Escape closes and returns to the ⋯ button.
  function onMenuKey(event) {
    const items = [...menu.querySelectorAll('button:not(:disabled)')];
    const index = items.indexOf(document.activeElement);
    const focusAt = i => items[(i + items.length) % items.length]?.focus();
    if (event.key === 'ArrowDown') focusAt(index + 1);
    else if (event.key === 'ArrowUp') focusAt(index < 0 ? items.length - 1 : index - 1);
    else if (event.key === 'Home') focusAt(0);
    else if (event.key === 'End') focusAt(items.length - 1);
    else if (event.key === 'ArrowRight' && document.activeElement?.classList.contains('has-submenu')) document.activeElement.click();
    else if (event.key === 'ArrowLeft' && menu.querySelector('.back')) menu.querySelector('.back').click();
    else if (event.key === 'Escape' || event.key === 'Tab') {
      const button = anchor;
      close();
      if (event.key === 'Escape') button?.focus();
      if (event.key === 'Tab') return;
    } else return;
    event.preventDefault();
    event.stopPropagation();
  }

  // Below the button, right-aligned, kept on screen; above it if there's no room below.
  function place() {
    const a = anchor.getBoundingClientRect();
    const m = menu.getBoundingClientRect();
    const viewWidth = document.documentElement.clientWidth;
    const viewHeight = window.innerHeight;
    const left = Math.min(Math.max(8, a.right - m.width), viewWidth - m.width - 8);
    let top = a.bottom + 6;
    if (top + m.height > viewHeight - 8) top = Math.max(8, a.top - m.height - 6);
    menu.style.left = `${left + window.scrollX}px`;
    menu.style.top = `${top + window.scrollY}px`;
  }

  document.addEventListener('click', close);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  window.addEventListener('resize', close);

  return { open, close };
})();
