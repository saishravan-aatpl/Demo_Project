// Pop-up menu for the ⋯ buttons
// ------------------------------
// ActionMenu.open(button, items) shows a small menu next to the button.
// items: [{ label, onClick, danger?, indent?, disabled? } | { heading }
//         | { label, submenu: [...items] }]   (a submenu opens inside the same box)
// Tapping outside, pressing Escape, or choosing an item closes it.

const ActionMenu = (() => {
  let menu = null;
  let anchor = null;

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
    menu.addEventListener('click', event => event.stopPropagation());
    menu.addEventListener('pointerdown', event => event.stopPropagation());
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
    menu.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
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
