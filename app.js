const STORAGE_KEY = 'officeDailyDashboard.stable.v2';
const LEGACY_STORAGE_KEYS = [
  'officeDailyDashboard.stable.v1',
  'officeProjectDashboard.v2',
  'officeProjectDashboard.v1'
];

// Real work data is no longer stored inside the code.
// Use "Import Backup" to load your data on a new device.
const embeddedInitialState = {};

const defaultState = {
  projects: [],
  people: [],
  usualLeaveTime: '17:00',   // set once in the menu
  leaveTime: '17:00',        // today's leaving time, if changed for today...
  leaveDate: '',             // ...on this day (YYYY-MM-DD); other days use usualLeaveTime
  dayNotes: '',
  view: 'all',               // what the main list shows (this device only)
  tab: 'projects',           // phone tab (this device only)
  lastProjectId: ''          // quick add remembers the last project used
};

let storageAvailable = checkStorageAvailable();
let state = loadState();
let toastTimer = null;
const isTouchDevice = window.matchMedia('(hover: none) and (pointer: coarse)').matches;

const $id = id => document.getElementById(id);
const els = {
  appbar: $id('appbar'),
  todayDate: $id('todayDate'),
  currentTime: $id('currentTime'),
  timePill: $id('timePill'),
  ringFill: $id('ringFill'),
  remainingTime: $id('remainingTime'),
  remainingWord: $id('remainingWord'),
  remainingMessage: $id('remainingMessage'),
  timeDialog: $id('timeDialog'),
  timeTitle: $id('timeTitle'),
  timeChips: $id('timeChips'),
  timeNote: $id('timeNote'),
  leaveTime: $id('leaveTime'),
  searchInput: $id('searchInput'),
  copySummaryBtn: $id('copySummaryBtn'),
  addBtn: $id('addBtn'),
  fabAdd: $id('fabAdd'),
  menuBtn: $id('menuBtn'),
  menuDialog: $id('menuDialog'),
  usualLeaveBtn: $id('usualLeaveBtn'),
  usualLeaveLabel: $id('usualLeaveLabel'),
  layout: $id('layout'),
  rail: $id('rail'),
  chips: $id('chips'),
  viewTitle: $id('viewTitle'),
  viewTitleText: $id('viewTitleText'),
  listHead: $id('listHead'),
  listTitle: $id('listTitle'),
  toggleAllBtn: $id('toggleAllBtn'),
  projectList: $id('projectList'),
  emptyState: $id('emptyState'),
  noMatches: $id('noMatches'),
  peopleList: $id('peopleList'),
  tabbar: $id('tabbar'),
  progressFill: $id('progressFill'),
  progressText: $id('progressText'),
  dayNotes: $id('dayNotes'),
  exportBtn: $id('exportBtn'),
  importBtn: $id('importBtn'),
  importFile: $id('importFile'),
  saveStatus: $id('saveStatus'),
  addDialog: $id('addDialog'),
  addForm: $id('addForm'),
  addText: $id('addText'),
  addTaskOptions: $id('addTaskOptions'),
  addProjects: $id('addProjects'),
  addProjectMore: $id('addProjectMore'),
  addPin: $id('addPin'),
  addPinWrap: $id('addPinWrap'),
  addSubmit: $id('addSubmit'),
  addError: $id('addError'),
  toast: $id('toast'),
  undoToast: $id('undoToast'),
  undoMessage: $id('undoMessage'),
  undoBtn: $id('undoBtn'),
  focusPanel: $id('focusPanel'),
  focusList: $id('focusList'),
  focusCount: $id('focusCount'),
  focusEmpty: $id('focusEmpty'),
  focusCarry: $id('focusCarry'),
  focusCarryText: $id('focusCarryText'),
  planDialog: $id('planDialog'),
  planList: $id('planList'),
  planCount: $id('planCount'),
  planDone: $id('planDone')
};

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function checkStorageAvailable() {
  try {
    const testKey = '__office_dashboard_storage_test__';
    localStorage.setItem(testKey, 'ok');
    localStorage.removeItem(testKey);
    return true;
  } catch (error) {
    console.warn('Local storage is not available.', error);
    return false;
  }
}

function loadState() {
  try {
    if (!storageAvailable) {
      updateSaveStatus('Local autosave is blocked by this browser/session.', true);
      return normalizeState({ ...structuredClone(defaultState), ...structuredClone(embeddedInitialState) });
    }

    let raw = localStorage.getItem(STORAGE_KEY);
    let loadedFrom = raw ? STORAGE_KEY : '';

    if (!raw) {
      for (const legacyKey of LEGACY_STORAGE_KEYS) {
        raw = localStorage.getItem(legacyKey);
        if (raw) {
          loadedFrom = legacyKey;
          break;
        }
      }
    }

    if (!raw) {
      const seeded = normalizeState({ ...structuredClone(defaultState), ...structuredClone(embeddedInitialState) });
      setTimeout(() => {
        saveState(false);
        showToast('Initial dashboard loaded');
      }, 0);
      return seeded;
    }

    const parsed = JSON.parse(raw);
    const loaded = normalizeState({ ...structuredClone(defaultState), ...parsed });

    if (loadedFrom !== STORAGE_KEY) {
      setTimeout(() => saveState(false), 0);
    }

    return loaded;
  } catch (error) {
    console.warn('Could not load saved dashboard data.', error);
    updateSaveStatus('Could not read saved data. Import backup if needed.', true);
    return normalizeState({ ...structuredClone(defaultState), ...structuredClone(embeddedInitialState) });
  }
}

function normalizeState(data) {
  data.projects = Array.isArray(data.projects) ? data.projects : [];
  data.people = Array.isArray(data.people) ? data.people : [];
  data.projects.forEach(project => {
    project.id = project.id || uid();
    project.name = project.name || 'Untitled Project';
    project.collapsed = Boolean(project.collapsed);
    project.tasks = Array.isArray(project.tasks) ? project.tasks : [];
    project.tasks.forEach(task => {
      task.id = task.id || uid();
      task.text = task.text || 'Untitled task';
      task.done = Boolean(task.done);
      task.person = (task.person || '').trim();
      if (task.person) data.people.push(task.person);
      // pinnedOn: the day (YYYY-MM-DD) the task was pinned for; absent = not pinned
      if (!(typeof task.pinnedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(task.pinnedOn))) delete task.pinnedOn;
    });
    sortDoneTasksToBottom(project);
  });
  data.people = uniqueNames(data.people);
  const isTime = value => /^\d{2}:\d{2}$/.test(value || '');
  data.usualLeaveTime = isTime(data.usualLeaveTime) ? data.usualLeaveTime : (isTime(data.leaveTime) ? data.leaveTime : '17:00');
  data.leaveTime = isTime(data.leaveTime) ? data.leaveTime : data.usualLeaveTime;
  data.leaveDate = typeof data.leaveDate === 'string' ? data.leaveDate : '';
  data.dayNotes = data.dayNotes || '';
  data.view = typeof data.view === 'string' ? data.view : 'all';
  data.tab = ['projects', 'people', 'notes'].includes(data.tab) ? data.tab : 'projects';
  data.lastProjectId = data.lastProjectId || '';
  delete data.personFilter;
  delete data.peopleOpenOnly;
  return data;
}

function saveState(show = true) {
  // Don't write anything back while "Forgot PIN" is erasing this device's data.
  if (window.dashboardLock?.wiping) return false;
  // Let cloud sync know something may have changed (it checks whether anything really did).
  window.dashboardSync?.onLocalSave();
  if (!storageAvailable) {
    updateSaveStatus('Local autosave is blocked. Use Export Backup.', true);
    if (show) showToast('Autosave blocked');
    return false;
  }

  try {
    const payload = JSON.stringify(state);
    localStorage.setItem(STORAGE_KEY, payload);
    localStorage.setItem('officeProjectDashboard.v2', payload);
    updateSaveStatus(`Saved · ${formatClock(new Date())}`, false);
    if (show) showToast('Saved');
    return true;
  } catch (error) {
    console.warn('Could not save dashboard data.', error);
    updateSaveStatus('Could not autosave. Use Export Backup.', true);
    if (show) showToast('Autosave failed');
    return false;
  }
}

function formatClock(date) {
  return date.toLocaleTimeString('en-IN', {
    hour: 'numeric', minute: '2-digit', hour12: true
  }).toUpperCase();
}

function updateSaveStatus(message, warning = false) {
  const statusEl = document.getElementById('saveStatus');
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.toggle('warning', Boolean(warning));
}

// ---------- undo ----------
// Before a change that's easy to regret (delete, move, import), we keep a copy of the
// data. "Undo" puts that copy back. Up to 20 steps; Ctrl/Cmd+Z works on a laptop.
const UNDO_LIMIT = 20;
const UNDO_TOAST_MS = 6000;
const undoStack = [];
let undoTimer = null;

function snapshotData() {
  return structuredClone({ projects: state.projects, people: state.people, leaveTime: state.leaveTime, dayNotes: state.dayNotes });
}

// Run a change, remember how things were before it, and offer Undo.
function withUndo(message, change) {
  const before = snapshotData();
  const result = change();
  if (result === false) return;                 // the change was cancelled
  undoStack.push(before);
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  showUndoToast(message);
}

function undo() {
  const before = undoStack.pop();
  hideUndoToast();
  if (!before) return showToast('Nothing to undo');
  state = normalizeState({ ...state, ...before });
  saveState(false);
  render();
  showToast('Undone');
}

function showUndoToast(message) {
  els.toast.classList.remove('show');
  els.undoMessage.textContent = message;
  els.undoToast.classList.add('show');
  clearTimeout(undoTimer);
  undoTimer = setTimeout(hideUndoToast, UNDO_TOAST_MS);
}

function hideUndoToast() {
  clearTimeout(undoTimer);
  els.undoToast.classList.remove('show');
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 1000);
}

let renderedDay = null;
function formatDateTime() {
  const now = new Date();
  // A new day started while the app was open: refresh what's pinned for today.
  if (renderedDay && renderedDay !== todayKey()) render();
  els.todayDate.textContent = now.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  els.currentTime.textContent = formatClock(now);
  updateRemainingTime();
}

function formatTime12(hour24, minute) {
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`;
}

const timeLabel = value => { const [h, m] = value.split(':').map(Number); return formatTime12(h, m); };

// "2h 15m", or just "40m" when under an hour.
function formatDuration(hours, minutes) {
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

// ---------- leaving time ----------
// You set a usual time once. Changing it in the pill only applies to today;
// every new day starts from the usual time again.
function leaveTimeToday() {
  return state.leaveDate === todayKey() ? state.leaveTime : state.usualLeaveTime;
}

const RING_WINDOW_MIN = 8 * 60;   // the ring shows the last 8 hours before leaving
const RING_LENGTH = 2 * Math.PI * 7;

function updateRemainingTime() {
  const value = leaveTimeToday();
  const [h, m] = value.split(':').map(Number);
  const leaving = new Date();
  leaving.setHours(h, m, 0, 0);
  const diffMs = leaving - new Date();
  const absMinutes = Math.abs(Math.ceil(diffMs / 60000));
  const hours = Math.floor(absMinutes / 60);
  const minutes = absMinutes % 60;
  const leavingText = formatTime12(h, m);
  const over = diffMs < 0;
  const stateName = over ? 'over' : absMinutes <= 60 ? 'soon' : 'ok';

  els.remainingTime.textContent = formatDuration(hours, minutes);
  els.remainingWord.textContent = over ? 'over' : 'left';
  els.timePill.dataset.state = stateName;
  els.timePill.title = `Leaving at ${leavingText}`;
  const elapsed = over ? 1 : Math.max(0, Math.min(1, 1 - absMinutes / RING_WINDOW_MIN));
  els.ringFill.style.strokeDasharray = `${RING_LENGTH * elapsed} ${RING_LENGTH}`;
  els.remainingMessage.textContent = over
    ? `${formatDuration(hours, minutes)} past ${leavingText}`
    : `${formatDuration(hours, minutes)} left · until ${leavingText}`;
}

// The time pill and the menu's "Usual leaving time" share one small dialog.
let timeDialogMode = 'today';
const QUICK_TIMES = ['16:30', '17:00', '17:30', '18:00', '18:30'];

function openTimeDialog(mode, anchor) {
  timeDialogMode = mode;
  const current = mode === 'usual' ? state.usualLeaveTime : leaveTimeToday();
  els.timeTitle.textContent = mode === 'usual' ? 'Usual leaving time' : 'Leaving today';
  els.remainingMessage.hidden = mode === 'usual';
  els.timeNote.innerHTML = mode === 'usual'
    ? 'Every new day starts with this time. You can still change a single day from the time at the top.'
    : `Only for today. Tomorrow starts again at your usual <b>${escapeHtml(timeLabel(state.usualLeaveTime))}</b> (change it in the menu).`;
  const times = [...new Set([...QUICK_TIMES, current])].sort();
  els.timeChips.innerHTML = times.map(t => `<button type="button" class="time-chip ${t === current ? 'on' : ''}" data-time="${t}">${timeLabel(t).replace(' PM', '').replace(' AM', ' AM')}</button>`).join('');
  els.leaveTime.value = current;
  updateRemainingTime();
  openSheet(els.timeDialog, anchor);
}

function setLeaveTime(value) {
  if (!/^\d{2}:\d{2}$/.test(value)) return;
  if (timeDialogMode === 'usual') {
    state.usualLeaveTime = value;
    showToast(`Usual leaving time: ${timeLabel(value)}`);
  } else {
    state.leaveTime = value;
    state.leaveDate = todayKey();
    showToast(`Leaving today at ${timeLabel(value)}`);
  }
  saveState(false);
  updateRemainingTime();
  renderMenuLabels();
  els.timeDialog.close();
}

function renderMenuLabels() {
  els.usualLeaveLabel.textContent = timeLabel(state.usualLeaveTime);
}

// ---------- sheets: bottom sheet on a phone, small pop-up under its button on a laptop ----------
const wideScreen = () => window.matchMedia('(min-width: 700px)').matches;

function openSheet(dialog, anchor) {
  ActionMenu.close();
  document.querySelectorAll('dialog.sheet[open]').forEach(d => d !== dialog && d.close());
  dialog.classList.toggle('as-popover', wideScreen() && Boolean(anchor));
  dialog.style.top = dialog.style.left = dialog.style.right = '';
  if (!dialog.open) dialog.showModal();
  if (wideScreen() && anchor) {
    const a = anchor.getBoundingClientRect();
    const w = dialog.offsetWidth;
    const left = Math.min(Math.max(12, a.right - w), window.innerWidth - w - 12);
    dialog.style.top = `${a.bottom + 8}px`;
    dialog.style.left = `${left}px`;
  }
}

// Tapping the dimmed area around a sheet closes it.
document.querySelectorAll('dialog.sheet').forEach(dialog => {
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
});

// ---------- what the main list shows ----------
// state.view: 'all' | 'pinned' | 'project:<id>' | 'person:<name>' | 'unassigned'
// A search (laptop) temporarily overrides it.
let searchQuery = '';
let dragEnabled = true;
const sameName = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

function currentFilter() {
  if (searchQuery) return { kind: 'search', query: searchQuery.toLowerCase() };
  const view = state.view || 'all';
  if (view.startsWith('project:')) return { kind: 'project', id: view.slice(8) };
  if (view.startsWith('person:')) return { kind: 'person', name: view.slice(7) };
  if (view === 'pinned' || view === 'unassigned') return { kind: view };
  return { kind: 'all' };
}

function taskMatches(task, filter) {
  if (filter.kind === 'person') return sameName(task.person, filter.name);
  if (filter.kind === 'unassigned') return !task.person && !task.done;
  if (filter.kind === 'search') return task.text.toLowerCase().includes(filter.query) || (task.person || '').toLowerCase().includes(filter.query);
  return true;
}

function setView(view) {
  state.view = view;
  searchQuery = '';
  if (els.searchInput) els.searchInput.value = '';
  saveState(false);
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

const openTasks = tasks => tasks.filter(task => !task.done);
const peopleSummary = tasks => [...new Set(openTasks(tasks).map(t => t.person).filter(Boolean))].join(', ') || 'unassigned';

function render() {
  if (document.activeElement !== els.dayNotes) els.dayNotes.value = state.dayNotes || '';
  // Forget a view whose project or person no longer exists.
  const view = state.view || 'all';
  if (view.startsWith('project:') && !getProject(view.slice(8))) state.view = 'all';
  if (view.startsWith('person:') && !allTasks().some(({ task }) => sameName(task.person, view.slice(7)))) state.view = 'all';

  const filter = currentFilter();
  const filtered = ['person', 'unassigned', 'search'].includes(filter.kind);
  dragEnabled = filter.kind === 'all' || filter.kind === 'project';
  els.projectList.innerHTML = '';
  let shown = 0;

  state.projects.forEach(project => {
    sortDoneTasksToBottom(project);
    if (filter.kind === 'pinned') return;
    if (filter.kind === 'project' && project.id !== filter.id) return;
    const tasks = project.tasks.filter(task => taskMatches(task, filter));
    if (filtered && !tasks.length) return;
    shown += 1;

    const collapsed = filter.kind === 'all' ? project.collapsed : false;
    const open = openTasks(project.tasks).length;
    const card = document.createElement('article');
    card.className = `project-card ${collapsed ? 'collapsed' : ''}`;
    card.dataset.projectId = project.id;
    card.innerHTML = `
      <div class="project-header">
        <button class="collapse-btn" type="button" aria-expanded="${!collapsed}" aria-label="${collapsed ? 'Expand' : 'Collapse'} ${escapeHtml(project.name)}" ${filter.kind === 'all' ? '' : 'disabled'}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>
        <div class="project-title-wrap">
          <div class="project-title" role="button" tabindex="0" title="Rename">${escapeHtml(project.name)}</div>
          <div class="project-summary">${open ? `${open} open · ${escapeHtml(peopleSummary(project.tasks))}` : 'All done'}</div>
        </div>
        <span class="project-progress" title="Tasks done">${project.tasks.length - open}/${project.tasks.length}</span>
        <button class="icon-btn round show-task-form" type="button" title="Add task" aria-label="Add task to ${escapeHtml(project.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
        <button class="more-btn project-more" type="button" title="More" aria-label="More project actions" aria-haspopup="menu" aria-expanded="false">⋯</button>
      </div>
      <div class="project-body">
        <form class="task-form">
          <input type="text" class="new-task" placeholder="Task name" autocomplete="off" />
          <button type="submit">Add</button>
          <button type="button" class="btn-secondary cancel-task">Cancel</button>
        </form>
        <ul class="task-list"></ul>
      </div>`;

    const taskList = card.querySelector('.task-list');
    tasks.forEach(task => {
      const item = document.createElement('li');
      item.className = `task-item ${task.done ? 'done' : ''} ${isPinnedToday(task) ? 'pinned' : ''}`;
      item.dataset.taskId = task.id;
      item.innerHTML = `
        <span class="task-handle" title="Drag to reorder" aria-hidden="true">⋮⋮</span>
        <input type="checkbox" class="task-check" ${task.done ? 'checked' : ''} aria-label="Mark task done" />
        <div class="task-text" tabindex="0" role="button" aria-label="Edit task: ${escapeHtml(task.text)}">${escapeHtml(task.text)}</div>
        <div class="person-wrap">
          <button class="person-field" type="button" title="Assign person">${task.person ? escapeHtml(task.person) : ''}</button>
          <div class="person-menu" role="dialog" aria-label="Assign person">
            <input type="text" class="person-search" placeholder="Search or add person" autocomplete="off" />
            <div class="person-list"></div>
            <div class="person-menu-actions">
              <button type="button" class="btn-secondary clear-person">Clear</button>
              <button type="button" class="btn-secondary close-person">Close</button>
            </div>
          </div>
        </div>
        <button class="pin-btn task-pin" type="button" aria-pressed="${isPinnedToday(task)}" title="${isPinnedToday(task) ? 'Unpin' : 'Pin for today'}" aria-label="${isPinnedToday(task) ? 'Unpin from today' : 'Pin for today'}">${PIN_ICON}</button>
        <button class="more-btn task-more" type="button" title="More" aria-label="More task actions" aria-haspopup="menu" aria-expanded="false">⋯</button>`;
      taskList.appendChild(item);
    });

    bindProjectCardEvents(card, project.id);
    els.projectList.appendChild(card);
  });

  els.emptyState.hidden = state.projects.length > 0 || filter.kind === 'pinned';
  els.noMatches.hidden = !(state.projects.length && filtered && shown === 0);
  els.noMatches.textContent = filter.kind === 'search' ? `No tasks match "${searchQuery}".` : 'No open tasks here.';
  els.listHead.hidden = filter.kind === 'pinned' || !state.projects.length;
  els.toggleAllBtn.hidden = filter.kind !== 'all';
  els.toggleAllBtn.textContent = state.projects.some(p => !p.collapsed) ? 'Collapse all' : 'Expand all';
  els.focusPanel.hidden = !(filter.kind === 'all' || filter.kind === 'pinned');

  // Title for a narrowed view, with a way back.
  const titles = {
    project: () => getProject(filter.id)?.name,
    person: () => `${filter.name}'s tasks`,
    unassigned: () => 'Unassigned tasks',
    search: () => `Search: "${searchQuery}"`
  };
  els.viewTitle.hidden = !titles[filter.kind];
  if (titles[filter.kind]) els.viewTitleText.textContent = titles[filter.kind]();
  els.listTitle.textContent = filter.kind === 'all' ? 'Projects' : 'Tasks';

  renderFocus();
  renderRail();
  renderChips();
  renderPeopleTab();
  renderProgress();
  applyTab();
  renderMenuLabels();
  updateRemainingTime();
  autosizeAllTaskText();
}

// ---------- overview: laptop list, phone chips, People tab ----------
function peopleCounts() {
  const counts = new Map();
  let unassigned = 0;
  allTasks().forEach(({ task }) => {
    if (task.done) return;
    if (!task.person) { unassigned += 1; return; }
    const key = [...counts.keys()].find(name => sameName(name, task.person)) || task.person;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const people = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { people, unassigned };
}

function viewItems() {
  const open = allTasks().filter(({ task }) => !task.done).length;
  const pinnedOpen = allTasks().filter(({ task }) => isPinnedToday(task) && !task.done).length;
  return {
    top: [
      { view: 'all', label: 'All tasks', count: open },
      { view: 'pinned', label: 'Pinned today', count: pinnedOpen, pin: true }
    ],
    projects: state.projects.map(p => ({ view: `project:${p.id}`, label: p.name, count: openTasks(p.tasks).length })),
    people: peopleCounts()
  };
}

function renderRail() {
  const { top, projects, people } = viewItems();
  const item = ({ view, label, count, pin }) => `<button type="button" class="rail-item ${state.view === view && !searchQuery ? 'on' : ''}" data-view="${escapeHtml(view)}">${pin ? `<span class="rail-pin">${PIN_ICON}</span>` : ''}<span class="rail-label">${escapeHtml(label)}</span><span class="rail-count">${count}</span></button>`;
  els.rail.innerHTML = `
    ${top.map(item).join('')}
    <div class="rail-head"><span>Projects</span><button type="button" class="rail-add" id="railAddProject" title="New project" aria-label="New project">+</button></div>
    ${projects.map(item).join('')}
    ${people.people.length || people.unassigned ? '<div class="rail-head"><span>People</span></div>' : ''}
    ${people.people.map(([name, count]) => item({ view: `person:${name}`, label: name, count })).join('')}
    ${people.unassigned ? item({ view: 'unassigned', label: 'Unassigned', count: people.unassigned }) : ''}`;
}

function renderChips() {
  const { top, projects } = viewItems();
  els.chips.innerHTML = [...top, ...projects].map(({ view, label, count, pin }) =>
    `<button type="button" class="chip ${state.view === view ? 'on' : ''}" data-view="${escapeHtml(view)}" role="tab" aria-selected="${state.view === view}">${pin ? `<span class="chip-pin">${PIN_ICON}</span>` : ''}${escapeHtml(label === 'All tasks' ? 'All' : label === 'Pinned today' ? 'Pinned' : label)} <i>${count}</i></button>`).join('');
  const active = els.chips.querySelector('.chip.on');
  if (active && els.chips.scrollWidth > els.chips.clientWidth) {
    els.chips.scrollLeft = Math.max(0, active.offsetLeft - 16);
  }
}

const expandedPeople = new Set();
function renderPeopleTab() {
  const { people, unassigned } = peopleCounts();
  const rows = [...people.map(([name, count]) => ({ name, count, match: task => sameName(task.person, name) })),
    ...(unassigned ? [{ name: 'Unassigned', count: unassigned, match: task => !task.person, none: true }] : [])];
  if (!rows.length) {
    els.peopleList.innerHTML = '<p class="empty-state">No open tasks with people yet. Tap a task\'s person column to assign someone.</p>';
    return;
  }
  els.peopleList.innerHTML = '';
  rows.forEach(({ name, count, match, none }) => {
    const open = expandedPeople.has(name);
    const block = document.createElement('section');
    block.className = `person-block ${open ? 'open' : ''}`;
    const initials = none ? '—' : name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    block.innerHTML = `<button type="button" class="person-head" aria-expanded="${open}"><span class="pav">${escapeHtml(initials)}</span><span class="person-name"><b>${escapeHtml(name)}</b><span class="subtle">${count} open</span></span><span class="person-chev"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></span></button><ul class="person-tasks"></ul>`;
    block.querySelector('.person-head').addEventListener('click', () => {
      open ? expandedPeople.delete(name) : expandedPeople.add(name);
      renderPeopleTab();
    });
    if (open) {
      const list = block.querySelector('.person-tasks');
      allTasks().filter(({ task }) => !task.done && match(task)).forEach(({ project, task }) => list.appendChild(focusRow(project, task, { showPerson: false })));
    }
    els.peopleList.appendChild(block);
  });
}

function renderProgress() {
  const tasks = allTasks().map(({ task }) => task);
  const done = tasks.filter(t => t.done).length;
  const pinned = tasks.filter(isPinnedToday);
  const pinnedDone = pinned.filter(t => t.done).length;
  els.progressFill.style.width = `${tasks.length ? Math.round((done / tasks.length) * 100) : 0}%`;
  els.progressText.textContent = tasks.length
    ? `${done} of ${tasks.length} done${pinned.length ? ` · ${pinnedDone} of ${pinned.length} pinned done` : ''}`
    : 'No tasks yet';
}

// ---------- phone tabs ----------
function applyTab() {
  document.body.dataset.tab = state.tab;
  els.tabbar.querySelectorAll('button').forEach(button => {
    const on = button.dataset.tab === state.tab;
    button.classList.toggle('on', on);
    button.setAttribute('aria-current', on ? 'page' : 'false');
  });
}

function setTab(tab) {
  if (state.tab === tab) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  state.tab = tab;
  saveState(false);
  applyTab();
  window.scrollTo(0, 0);
}

// ---------- pinned for today ----------
const PIN_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3.5h6l-1 5 3.5 3.5H6.5L10 8.5z"/><path d="M12 12v8.5"/></svg>';
const todayKey = () => new Date().toLocaleDateString('en-CA');      // e.g. 2026-11-18
const isPinnedToday = task => task.pinnedOn === todayKey();
// Pinned on an earlier day and still not done: offered to keep or clear.
const isCarriedOver = task => Boolean(task.pinnedOn) && task.pinnedOn < todayKey() && !task.done;

function allTasks() {
  return state.projects.flatMap(project => project.tasks.map(task => ({ project, task })));
}

function setPinned(task, pinned) {
  if (pinned) task.pinnedOn = todayKey();
  else delete task.pinnedOn;
}

function togglePin(project, task) {
  const pin = !isPinnedToday(task);
  withUndo(pin ? 'Pinned for today' : 'Unpinned', () => {
    setPinned(task, pin);
    saveState(false);
    render();
  });
}

// A compact task row used in the pinned list and the People tab.
function focusRow(project, task, { showPerson = true } = {}) {
  const row = document.createElement('li');
  const pinned = isPinnedToday(task);
  row.className = `focus-item ${task.done ? 'done' : ''}`;
  row.innerHTML = `
    <input type="checkbox" class="task-check" ${task.done ? 'checked' : ''} aria-label="Mark task done" />
    <button type="button" class="focus-text" title="Show in ${escapeHtml(project.name)}">
      <span class="focus-task">${escapeHtml(task.text)}</span>
      <span class="focus-project">${escapeHtml(project.name)}</span>
    </button>
    ${showPerson ? `<span class="focus-person">${task.person ? escapeHtml(task.person) : '<span class="muted-dash">—</span>'}</span>` : '<span></span>'}
    <button type="button" class="pin-btn" aria-pressed="${pinned}" title="${pinned ? 'Unpin' : 'Pin for today'}" aria-label="${pinned ? 'Unpin from today' : 'Pin for today'}">${PIN_ICON}</button>`;
  row.querySelector('.task-check').addEventListener('change', event => {
    task.done = event.target.checked;
    sortDoneTasksToBottom(project);
    saveState(false);
    render();
  });
  row.querySelector('.pin-btn').addEventListener('click', () => togglePin(project, task));
  row.querySelector('.focus-text').addEventListener('click', () => revealTask(project, task));
  return row;
}

function renderFocus() {
  renderedDay = todayKey();
  const pinned = allTasks().filter(({ task }) => isPinnedToday(task));
  const carried = allTasks().filter(({ task }) => isCarriedOver(task));
  const openCount = pinned.filter(({ task }) => !task.done).length;

  els.focusCount.textContent = pinned.length ? `${openCount} open` : '';
  els.focusEmpty.hidden = pinned.length > 0 || carried.length > 0;
  els.focusCarry.hidden = carried.length === 0;
  els.focusCarryText.innerHTML = carried.length === 1
    ? '<b>1 task</b> you pinned earlier is still open.'
    : `<b>${carried.length} tasks</b> you pinned earlier are still open.`;
  els.focusPanel.classList.toggle('has-items', pinned.length > 0);

  els.focusList.innerHTML = '';
  // Open ones first, finished ones after (struck through, until tomorrow).
  [...pinned.filter(x => !x.task.done), ...pinned.filter(x => x.task.done)]
    .forEach(({ project, task }) => els.focusList.appendChild(focusRow(project, task)));
}

// Scroll to a task in its project (opening the project if collapsed) and flash it.
function revealTask(project, task) {
  const needsView = !(state.view === 'all' || state.view === `project:${project.id}`) || searchQuery;
  if (project.collapsed || needsView || state.tab !== 'projects') {
    project.collapsed = false;
    if (needsView) { state.view = 'all'; searchQuery = ''; els.searchInput.value = ''; }
    state.tab = 'projects';
    saveState(false);
    render();
  }
  const row = document.querySelector(`.task-item[data-task-id="${task.id}"]`);
  if (!row) return;
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  row.classList.remove('flash');
  void row.offsetWidth;
  row.classList.add('flash');
}

// "Plan today": tick several tasks at once.
function openPlanToday() {
  const groups = state.projects
    .map(project => ({ project, tasks: project.tasks.filter(task => !task.done) }))
    .filter(group => group.tasks.length);
  els.planList.innerHTML = '';
  if (!groups.length) {
    els.planList.innerHTML = '<p class="subtle">No open tasks yet.</p>';
  }
  groups.forEach(({ project, tasks }) => {
    const block = document.createElement('div');
    block.className = 'plan-group';
    block.innerHTML = `<div class="plan-project">${escapeHtml(project.name)}</div>`;
    tasks.forEach(task => {
      const label = document.createElement('label');
      label.className = 'plan-row';
      const checked = isPinnedToday(task) || isCarriedOver(task);
      label.innerHTML = `
        <input type="checkbox" value="${escapeHtml(task.id)}" ${checked ? 'checked' : ''} />
        <span class="plan-text">${escapeHtml(task.text)}${isCarriedOver(task) ? '<span class="plan-note">pinned earlier</span>' : ''}</span>
        <span class="plan-person">${task.person ? escapeHtml(task.person) : ''}</span>`;
      block.appendChild(label);
    });
    els.planList.appendChild(block);
  });
  updatePlanCount();
  els.planDialog.showModal();
}

function updatePlanCount() {
  const n = els.planList.querySelectorAll('input:checked').length;
  els.planCount.textContent = n ? `${n} picked` : '';
  els.planDone.textContent = n ? `Pin ${n} for today` : 'Done';
}

function applyPlanToday() {
  const picked = new Set([...els.planList.querySelectorAll('input:checked')].map(input => input.value));
  withUndo('Today planned', () => {
    allTasks().forEach(({ task }) => {
      if (task.done) return;
      setPinned(task, picked.has(task.id));
    });
    saveState(false);
    render();
  });
}

// Swipe a task to the right (touch screens) to pin or unpin it.
function enableSwipeToPin(item, project, task) {
  if (!isTouchDevice) return;
  let start = null;
  let swiping = false;
  const THRESHOLD = 72;
  const reset = () => {
    item.style.transition = 'transform 0.18s ease';
    item.style.transform = '';
    item.classList.remove('swiping', 'swipe-ready');
    setTimeout(() => { item.style.transition = ''; }, 200);
    start = null;
    swiping = false;
  };
  item.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' || event.target.closest(TASK_DRAG_IGNORE)) return;
    start = { x: event.clientX, y: event.clientY, id: event.pointerId };
  });
  item.addEventListener('pointermove', event => {
    if (!start || event.pointerId !== start.id || Drag.isDragging()) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!swiping) {
      if (Math.abs(dy) > 10) { start = null; return; }          // scrolling
      if (dx > 12 && dx > Math.abs(dy) * 1.5) {
        swiping = true;
        item.classList.add('swiping');
        item.dataset.swipeLabel = isPinnedToday(task) ? 'Unpin' : 'Pin for today';
      } else return;
    }
    const x = Math.max(0, Math.min(dx, 130));
    item.style.transform = `translateX(${x}px)`;
    item.classList.toggle('swipe-ready', x >= THRESHOLD);
  });
  const finish = event => {
    if (!start || event.pointerId !== start.id) return;
    const ready = swiping && item.classList.contains('swipe-ready');
    const wasSwiping = swiping;
    reset();
    if (wasSwiping) {
      // Don't let the end of a swipe also count as a tap (e.g. opening the task for
      // editing). Only for a moment: the next real tap must still work.
      const swallow = e => { e.stopPropagation(); e.preventDefault(); };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 350);
    }
    if (ready) togglePin(project, task);
  };
  item.addEventListener('pointerup', finish);
  item.addEventListener('pointercancel', finish);
}

// Task names wrap onto several lines; grow each box to fit its text.
function autosizeTaskText(el) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
}

function autosizeAllTaskText() {
  document.querySelectorAll('textarea.task-text').forEach(autosizeTaskText);
}

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(autosizeAllTaskText, 150);
});

// ---------- moving tasks and projects ----------
const TASK_DRAG_IGNORE = 'input, button, textarea, select, .person-menu';

function moveTask(taskId, fromProject, toProject, index) {
  const task = fromProject.tasks.find(t => t.id === taskId);
  if (!task) return;
  const message = fromProject !== toProject ? `Moved to ${toProject.name}` : 'Task moved';
  withUndo(message, () => {
    const oldOrder = fromProject.tasks.map(t => t.id).join();
    fromProject.tasks = fromProject.tasks.filter(t => t.id !== taskId);
    const position = index === undefined ? toProject.tasks.filter(t => !t.done).length : Math.max(0, Math.min(index, toProject.tasks.length));
    toProject.tasks.splice(position, 0, task);
    sortDoneTasksToBottom(toProject);
    saveState(false);
    render();
    // Dropped back where it started: nothing to undo.
    if (fromProject === toProject && toProject.tasks.map(t => t.id).join() === oldOrder) return false;
  });
}

function moveProject(projectId, index) {
  const project = getProject(projectId);
  if (!project) return;
  withUndo('Project moved', () => {
    const oldOrder = state.projects.map(p => p.id).join();
    state.projects = state.projects.filter(p => p.id !== projectId);
    state.projects.splice(Math.max(0, Math.min(index, state.projects.length)), 0, project);
    saveState(false);
    render();
    if (state.projects.map(p => p.id).join() === oldOrder) return false;
  });
}

// Where a dragged task would land: any project's list, including collapsed ones.
function resolveTaskDrop(x, y, el) {
  const under = document.elementFromPoint(x, y);
  const card = under?.closest('.project-card');
  if (!card) return null;
  const list = card.querySelector('.task-list');
  if (card.classList.contains('collapsed')) return { dropInto: list, highlight: card };
  const header = card.querySelector('.project-header');
  if (header.contains(under)) return { list, before: list.firstElementChild, highlight: card };
  return { list, before: Drag.itemAfterY(list, '.task-item', y, el), highlight: card };
}

function resolveProjectDrop(x, y, el) {
  return { list: els.projectList, before: Drag.itemAfterY(els.projectList, '.project-card', y, el) };
}

function bindProjectCardEvents(card, projectId) {
  const project = getProject(projectId);

  // Drag a project by its header (press and hold on a phone).
  if (currentFilter().kind === 'all') {
    Drag.attach(card, {
      itemSelector: '.project-card',
      wholeItem: true,
      area: '.project-header',
      ignore: 'button, input, textarea',
      resolveDrop: resolveProjectDrop,
      onDrop: ({ index }) => moveProject(projectId, index),
      onCancel: render
    });
  }

  card.querySelector('.collapse-btn').addEventListener('click', () => {
    project.collapsed = !project.collapsed;
    saveState(false);
    render();
  });

  // Tap the name to rename it.
  const title = card.querySelector('.project-title');
  const startRename = () => {
    if (Drag.isDragging()) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'project-title-input';
    input.value = project.name;
    input.setAttribute('aria-label', 'Project name');
    title.replaceWith(input);
    input.focus();
    input.select();
    let finished = false;
    const finish = save => {
      if (finished) return;
      finished = true;
      if (save) project.name = input.value.trim() || project.name || 'Untitled Project';
      saveState(false);
      render();
    };
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); finish(true); }
      if (event.key === 'Escape') { event.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  };
  title.addEventListener('click', startRename);
  title.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); startRename(); }
  });

  card.querySelector('.project-more').addEventListener('click', event => {
    event.stopPropagation();
    closeAllPersonMenus();
    ActionMenu.open(event.currentTarget, [
      { label: 'Rename', onClick: startRename },
      {
        label: project.collapsed ? 'Expand' : 'Collapse',
        disabled: currentFilter().kind !== 'all',
        onClick: () => { project.collapsed = !project.collapsed; saveState(false); render(); }
      },
      { label: 'Show only this project', onClick: () => setView(`project:${projectId}`) },
      {
        label: 'Delete project',
        danger: true,
        onClick: () => withUndo(`Deleted "${project.name}"`, () => {
          state.projects = state.projects.filter(p => p.id !== projectId);
          saveState(false);
          render();
        })
      }
    ]);
  });

  const taskForm = card.querySelector('.task-form');
  const newTaskInput = card.querySelector('.new-task');

  card.querySelector('.show-task-form').addEventListener('click', () => {
    if (project.collapsed) {
      project.collapsed = false;
      saveState(false);
      render();
      document.querySelector(`[data-project-id="${projectId}"] .show-task-form`)?.click();
      return;
    }
    taskForm.classList.add('open');
    newTaskInput.focus();
  });

  card.querySelector('.cancel-task').addEventListener('click', () => {
    newTaskInput.value = '';
    taskForm.classList.remove('open');
  });

  newTaskInput.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      newTaskInput.value = '';
      taskForm.classList.remove('open');
    }
  });

  taskForm.addEventListener('submit', event => {
    event.preventDefault();
    const { text, person } = parseTaskText(newTaskInput.value);
    if (!text) return;
    project.tasks.push({ id: uid(), text, done: false, person });
    if (person) addPersonName(person, false);
    sortDoneTasksToBottom(project);
    newTaskInput.value = '';
    saveState();
    render();
    requestAnimationFrame(() => {
      const reopenedCard = document.querySelector(`[data-project-id="${projectId}"]`);
      const reopenedForm = reopenedCard?.querySelector('.task-form');
      const reopenedInput = reopenedCard?.querySelector('.new-task');
      if (reopenedForm && reopenedInput) {
        reopenedForm.classList.add('open');
        reopenedInput.focus();
      }
    });
  });

  bindTaskEvents(card, project);
}

function bindTaskEvents(card, project) {
  card.querySelectorAll('.task-item').forEach(item => {
    const taskId = item.dataset.taskId;
    const task = project.tasks.find(t => t.id === taskId);

    if (dragEnabled) Drag.attach(item, {
      itemSelector: '.task-item',
      handle: '.task-handle',
      wholeItem: true,
      ignore: TASK_DRAG_IGNORE,
      resolveDrop: resolveTaskDrop,
      onDrop: ({ list, index }) => {
        const toProject = getProject(list.closest('.project-card').dataset.projectId);
        if (toProject) moveTask(taskId, project, toProject, index);
      },
      onCancel: render
    });

    item.querySelector('.task-check').addEventListener('change', event => {
      task.done = event.target.checked;
      sortDoneTasksToBottom(project);
      saveState(false);
      render();
    });

    // The task name is shown as text; tapping it turns it into an edit box.
    const taskTextView = item.querySelector('.task-text');
    const startEditing = () => {
      if (Drag.isDragging()) return;
      const editor = document.createElement('textarea');
      editor.className = 'task-text editing';
      editor.rows = 1;
      editor.value = task.text;
      editor.setAttribute('aria-label', 'Task text');
      editor.setAttribute('enterkeyhint', 'done');
      taskTextView.replaceWith(editor);
      autosizeTaskText(editor);
      editor.focus();
      editor.setSelectionRange(editor.value.length, editor.value.length);
      bindTaskEditor(editor, project, task);
    };
    taskTextView.addEventListener('click', startEditing);
    taskTextView.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); startEditing(); }
    });

    const personField = item.querySelector('.person-field');
    const personMenu = item.querySelector('.person-menu');
    const personInput = item.querySelector('.person-search');

    personField.addEventListener('click', event => {
      event.stopPropagation();
      ActionMenu.close();
      const isOpen = personMenu.classList.contains('open');
      closeAllPersonMenus(personMenu);
      personMenu.classList.toggle('open', !isOpen);
      if (!isOpen) {
        personInput.value = task.person || '';
        personMenu.dataset.activeIndex = '0';
        renderPersonList(personMenu, task);
        personInput.focus();
        personInput.select();
      }
    });

    personMenu.addEventListener('click', event => event.stopPropagation());

    personInput.addEventListener('input', () => {
      personMenu.dataset.activeIndex = '0';
      renderPersonList(personMenu, task);
    });

    personInput.addEventListener('keydown', event => {
      const options = Array.from(personMenu.querySelectorAll('.person-option'));
      let activeIndex = Number(personMenu.dataset.activeIndex || 0);

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (options.length) {
          activeIndex = Math.min(activeIndex + 1, options.length - 1);
          personMenu.dataset.activeIndex = String(activeIndex);
          updatePersonActiveOption(personMenu);
        }
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (options.length) {
          activeIndex = Math.max(activeIndex - 1, 0);
          personMenu.dataset.activeIndex = String(activeIndex);
          updatePersonActiveOption(personMenu);
        }
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        const activeOption = options[activeIndex];
        const highlightedName = activeOption ? activeOption.dataset.name : '';
        const name = highlightedName || addPersonName(personInput.value);
        if (!name) return;
        task.person = name;
        addPersonName(name, false);
        saveState();
        render();
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        personMenu.classList.remove('open');
      }
    });

    item.querySelector('.clear-person').addEventListener('click', () => {
      task.person = '';
      saveState();
      render();
    });

    item.querySelector('.close-person').addEventListener('click', () => {
      personMenu.classList.remove('open');
    });

    item.querySelector('.task-pin').addEventListener('click', event => {
      event.stopPropagation();
      togglePin(project, task);
    });
    enableSwipeToPin(item, project, task);

    item.querySelector('.task-more').addEventListener('click', event => {
      event.stopPropagation();
      closeAllPersonMenus();
      const others = state.projects.filter(p => p.id !== project.id);
      const isFirst = project.tasks[0]?.id === taskId;
      ActionMenu.open(event.currentTarget, [
        {
          label: isPinnedToday(task) ? 'Unpin from today' : 'Pin for today',
          disabled: task.done && !isPinnedToday(task),
          onClick: () => togglePin(project, task)
        },
        {
          label: 'Move to project',
          disabled: !others.length,
          submenu: [
            { heading: 'Move to project' },
            ...others.map(other => ({ label: other.name, indent: true, onClick: () => moveTask(taskId, project, other) }))
          ]
        },
        { label: 'Move to top', disabled: isFirst, onClick: () => moveTask(taskId, project, project, 0) },
        {
          label: 'Delete task',
          danger: true,
          onClick: () => withUndo('Task deleted', () => {
            project.tasks = project.tasks.filter(t => t.id !== taskId);
            saveState(false);
            render();
          })
        }
      ]);
    });
  });
}

function bindTaskEditor(editor, project, task) {
  const original = task.text;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (!editor.value.trim()) {
      task.text = original;                       // so Undo brings back the original text
      withUndo('Task deleted', () => {
        project.tasks = project.tasks.filter(t => t.id !== task.id);
        saveState(false);
        render();
      });
      return;
    }
    saveState();
    render();
  };

  editor.addEventListener('input', () => {
    // Tasks are one line of text that wraps on screen; turn pasted line breaks into spaces.
    if (/[\r\n]/.test(editor.value)) editor.value = editor.value.replace(/[\r\n]+/g, ' ');
    task.text = editor.value.trimStart();
    autosizeTaskText(editor);
    saveState(false);
  });

  editor.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      finish();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      task.text = original || 'Untitled task';
      finished = true;
      saveState(false);
      render();
    }
  });

  editor.addEventListener('blur', finish);
}

function uniqueNames(names) {
  const seen = new Set();
  return names
    .map(name => String(name || '').trim())
    .filter(Boolean)
    .filter(name => {
      const key = name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function addPersonName(name, shouldSave = true) {
  const clean = String(name || '').trim();
  if (!clean) return '';
  if (!state.people.some(person => person.toLowerCase() === clean.toLowerCase())) {
    state.people.push(clean);
    state.people = uniqueNames(state.people);
    if (shouldSave) saveState(false);
  }
  return clean;
}

function renderPersonList(menu, task) {
  const input = menu.querySelector('.person-search');
  const list = menu.querySelector('.person-list');
  const query = input.value.trim().toLowerCase();
  const filtered = state.people.filter(name => name.toLowerCase().includes(query));
  let activeIndex = Number(menu.dataset.activeIndex || 0);
  if (activeIndex >= filtered.length) activeIndex = Math.max(filtered.length - 1, 0);
  if (activeIndex < 0) activeIndex = 0;
  menu.dataset.activeIndex = String(activeIndex);
  list.innerHTML = '';

  filtered.forEach((name, index) => {
    const row = document.createElement('div');
    row.className = `person-option ${index === activeIndex ? 'active' : ''}`;
    row.dataset.name = name;
    row.innerHTML = `
      <span class="person-option-name">${escapeHtml(name)}</span>
      <button type="button" class="person-remove" title="Remove from suggestions" aria-label="Remove ${escapeHtml(name)} from suggestions">×</button>
    `;
    row.addEventListener('click', () => {
      task.person = name;
      addPersonName(name, false);
      saveState();
      render();
    });
    row.querySelector('.person-remove').addEventListener('click', event => {
      event.stopPropagation();
      const confirmed = confirm(`Remove "${name}" from future person suggestions? Existing task tags will remain unchanged.`);
      if (!confirmed) return;
      state.people = state.people.filter(person => person.toLowerCase() !== name.toLowerCase());
      saveState();
      render();
    });
    list.appendChild(row);
  });

  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'person-empty';
    empty.textContent = query ? `Press Enter to add "${input.value.trim()}".` : 'No saved people yet.';
    list.appendChild(empty);
  }
}

function updatePersonActiveOption(menu) {
  const options = Array.from(menu.querySelectorAll('.person-option'));
  const activeIndex = Number(menu.dataset.activeIndex || 0);
  options.forEach((option, index) => option.classList.toggle('active', index === activeIndex));
  if (options[activeIndex]) {
    options[activeIndex].scrollIntoView({ block: 'nearest' });
  }
}

function closeAllPersonMenus(exceptMenu = null) {
  document.querySelectorAll('.person-menu.open').forEach(menu => {
    if (menu !== exceptMenu) menu.classList.remove('open');
  });
}

function sortDoneTasksToBottom(project) {
  project.tasks = project.tasks
    .map((task, index) => ({ task, index }))
    .sort((a, b) => {
      if (a.task.done === b.task.done) return a.index - b.index;
      return a.task.done ? 1 : -1;
    })
    .map(item => item.task);
}

function getProject(projectId) {
  return state.projects.find(p => p.id === projectId);
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function buildSummaryText() {
  const now = new Date();
  const lines = [];
  lines.push(`Daily Work Summary - ${now.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`);
  lines.push('');

  const pinned = allTasks().filter(({ task }) => isPinnedToday(task));
  if (pinned.length) {
    lines.push('Focus today:');
    pinned.forEach(({ project, task }) => lines.push(`- [${task.done ? 'x' : ' '}] ${task.text} (${project.name}${task.person ? `, @${task.person}` : ''})`));
    lines.push('');
  }

  if (!state.projects.length) lines.push('No projects captured.');

  state.projects.forEach((project, index) => {
    const done = project.tasks.filter(t => t.done);
    const open = project.tasks.filter(t => !t.done);
    lines.push(`${index + 1}. ${project.name}`);
    if (done.length) {
      lines.push('Completed:');
      done.forEach(t => lines.push(`- ${t.text}${t.person ? ` (@${t.person})` : ''}`));
    }
    if (open.length) {
      lines.push('Pending:');
      open.forEach(t => lines.push(`- ${t.text}${t.person ? ` (@${t.person})` : ''}`));
    }
    if (!project.tasks.length) lines.push('- No tasks added.');
    lines.push('');
  });

  if (state.dayNotes.trim()) {
    lines.push('Notes:');
    lines.push(state.dayNotes.trim());
  }
  return lines.join('\n');
}



// ---------- quick add (+) ----------
// "Send RFQ @Prashanth" -> text "Send RFQ", person "Prashanth" (matches an existing name if there is one).
function parseTaskText(raw) {
  let person = '';
  const text = String(raw || '').replace(/(^|\s)@([^\s@]+)/, (match, space, name) => {
    person = state.people.find(p => sameName(p, name)) || name;
    return space;
  }).replace(/\s+/g, ' ').trim();
  return { text, person };
}

let addMode = 'task';
let addProjectId = '';

function addProjectChoices() {
  // Last used first, then the project you're looking at, then the rest in your order.
  const viewing = state.view.startsWith('project:') ? state.view.slice(8) : '';
  const ids = [...new Set([state.lastProjectId, viewing, ...state.projects.map(p => p.id)])].filter(id => getProject(id));
  return ids.map(getProject);
}

function setAddMode(mode) {
  addMode = state.projects.length ? mode : 'project';
  els.addForm.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.mode === addMode));
  els.addTaskOptions.hidden = addMode !== 'task';
  els.addPinWrap.hidden = addMode !== 'task';
  els.addText.placeholder = addMode === 'task' ? 'What needs doing? (@name assigns)' : 'New project name';
  els.addSubmit.textContent = addMode === 'task' ? 'Add task' : 'Add project';
  els.addError.textContent = state.projects.length ? '' : 'Start with a project, then add tasks to it.';
}

function renderAddProjects() {
  const choices = addProjectChoices();
  if (!getProject(addProjectId)) addProjectId = choices[0]?.id || '';
  const shown = choices.slice(0, 5);
  if (!shown.some(p => p.id === addProjectId) && getProject(addProjectId)) shown[4] = getProject(addProjectId);
  els.addProjects.innerHTML = shown.map(p => `<button type="button" class="chip ${p.id === addProjectId ? 'on' : ''}" data-id="${escapeHtml(p.id)}">${escapeHtml(p.name)}</button>`).join('');
  els.addProjectMore.hidden = choices.length <= 5;
  els.addProjectMore.innerHTML = '<option value="">More projects…</option>' + choices.slice(5).map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');
}

function openAdd(mode = 'task', anchor = null) {
  els.addText.value = '';
  els.addPin.checked = state.view === 'pinned';
  addProjectId = '';
  renderAddProjects();
  setAddMode(mode);
  openSheet(els.addDialog, anchor);
  els.addText.focus();
}

function submitAdd() {
  if (addMode === 'project') {
    const name = els.addText.value.trim();
    if (!name) return;
    const project = { id: uid(), name, collapsed: false, tasks: [] };
    withUndo(`Project "${name}" added`, () => {
      state.projects.push(project);
      state.lastProjectId = project.id;
      saveState(false);
      render();
    });
    els.addDialog.close();
    document.querySelector(`[data-project-id="${project.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const project = getProject(addProjectId);
  const { text, person } = parseTaskText(els.addText.value);
  if (!project || !text) {
    els.addError.textContent = text ? 'Pick a project.' : 'Type the task first.';
    return;
  }
  withUndo(`Added to ${project.name}`, () => {
    const task = { id: uid(), text, done: false, person };
    if (els.addPin.checked) setPinned(task, true);
    project.tasks.push(task);
    if (person) addPersonName(person, false);
    sortDoneTasksToBottom(project);
    state.lastProjectId = project.id;
    saveState(false);
    render();
  });
  els.addDialog.close();
}

els.addForm.addEventListener('submit', event => { event.preventDefault(); submitAdd(); });
els.addForm.querySelectorAll('.seg button').forEach(button => button.addEventListener('click', () => { setAddMode(button.dataset.mode); els.addText.focus(); }));
els.addProjects.addEventListener('click', event => {
  const chip = event.target.closest('[data-id]');
  if (!chip) return;
  addProjectId = chip.dataset.id;
  renderAddProjects();
  els.addText.focus();
});
els.addProjectMore.addEventListener('change', () => {
  if (els.addProjectMore.value) addProjectId = els.addProjectMore.value;
  renderAddProjects();
});
els.addBtn.addEventListener('click', () => openAdd('task', els.addBtn));
els.fabAdd.addEventListener('click', () => openAdd('task'));

// ---------- time pill and menu ----------
els.timePill.addEventListener('click', () => openTimeDialog('today', els.timePill));
els.timeChips.addEventListener('click', event => {
  const chip = event.target.closest('[data-time]');
  if (chip) setLeaveTime(chip.dataset.time);
});
els.leaveTime.addEventListener('change', event => setLeaveTime(event.target.value));

els.menuBtn.addEventListener('click', () => openSheet(els.menuDialog, els.menuBtn));
// Choosing anything in the menu closes it.
els.menuDialog.addEventListener('click', event => {
  if (event.target.closest('.menu-row, #syncSignInBtn')) els.menuDialog.close();
});
els.usualLeaveBtn.addEventListener('click', () => setTimeout(() => openTimeDialog('usual', null), 0));
$id('offlineSignIn').addEventListener('click', () => $id('syncSignInBtn').click());

// ---------- views, tabs, search ----------
function onViewClick(event) {
  const target = event.target.closest('[data-view]');
  if (target) setView(target.dataset.view);
}
els.rail.addEventListener('click', event => {
  if (event.target.closest('#railAddProject')) { openAdd('project', event.target.closest('#railAddProject')); return; }
  onViewClick(event);
});
els.chips.addEventListener('click', onViewClick);
$id('viewClear').addEventListener('click', () => setView('all'));
els.tabbar.addEventListener('click', event => {
  const button = event.target.closest('[data-tab]');
  if (button) setTab(button.dataset.tab);
});
els.toggleAllBtn.addEventListener('click', () => {
  const collapse = state.projects.some(p => !p.collapsed);
  state.projects.forEach(p => { p.collapsed = collapse; });
  saveState(false);
  render();
});

let searchTimer = null;
els.searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { searchQuery = els.searchInput.value.trim(); render(); }, 120);
});
els.searchInput.addEventListener('keydown', event => {
  if (event.key === 'Escape') { els.searchInput.value = ''; searchQuery = ''; render(); els.searchInput.blur(); }
});

// Keyboard: N = add, / = search (when you're not typing somewhere).
document.addEventListener('keydown', event => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target.closest?.('input, textarea, select, [contenteditable="true"], dialog')) return;
  if (document.documentElement.classList.contains('locked') || document.documentElement.classList.contains('needs-auth')) return;
  if (event.key === 'n' || event.key === 'N') { event.preventDefault(); openAdd('task', wideScreen() ? els.addBtn : null); }
  if (event.key === '/' && wideScreen()) { event.preventDefault(); els.searchInput.focus(); }
});

els.dayNotes.addEventListener('input', event => {
  state.dayNotes = event.target.value;
  saveState(false);
});

els.copySummaryBtn.addEventListener('click', async () => {
  const text = buildSummaryText();
  try {
    await navigator.clipboard.writeText(text);
    showToast('Summary copied');
  } catch {
    const temp = document.createElement('textarea');
    temp.value = text;
    document.body.appendChild(temp);
    temp.select();
    document.execCommand('copy');
    temp.remove();
    showToast('Summary copied');
  }
});

els.exportBtn.addEventListener('click', () => {
  els.menuDialog.close();
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `office-dashboard-backup-${stamp}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

els.importBtn.addEventListener('click', () => els.importFile.click());

els.importFile.addEventListener('change', event => {
  const file = event.target.files[0];
  if (!file) return;
  if (window.dashboardSync?.isSignedIn() && !confirm('Importing replaces your dashboard on ALL your synced devices. Continue?')) {
    event.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!Array.isArray(imported.projects)) throw new Error('Invalid backup format');
      withUndo('Backup imported', () => {
        state = normalizeState({ ...structuredClone(defaultState), ...imported });
        saveState(false);
        render();
      });
    } catch (error) {
      alert('Could not import this backup file.');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
});

document.addEventListener('click', () => closeAllPersonMenus());

els.undoBtn.addEventListener('click', event => { event.stopPropagation(); undo(); });

document.getElementById('planTodayBtn').addEventListener('click', openPlanToday);
document.getElementById('planCancel').addEventListener('click', () => els.planDialog.close());
els.planList.addEventListener('change', updatePlanCount);
document.getElementById('planForm').addEventListener('submit', event => {
  event.preventDefault();
  els.planDialog.close();
  applyPlanToday();
});
document.getElementById('carryKeep').addEventListener('click', () => withUndo('Kept pinned for today', () => {
  allTasks().forEach(({ task }) => { if (isCarriedOver(task)) setPinned(task, true); });
  saveState(false);
  render();
}));
document.getElementById('carryClear').addEventListener('click', () => withUndo('Cleared earlier pins', () => {
  allTasks().forEach(({ task }) => { if (isCarriedOver(task)) setPinned(task, false); });
  saveState(false);
  render();
}));
document.addEventListener('keydown', event => {
  const typing = event.target.closest?.('input, textarea, [contenteditable="true"]');
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z' && !typing) {
    event.preventDefault();
    undo();
  }
});

window.addEventListener('beforeunload', () => saveState(false));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveState(false);
});
setInterval(() => saveState(false), 15000);

// Small interface used by sync.js to read and replace the synced data.
window.dashboardApp = {
  getData() {
    return {
      projects: state.projects,
      people: state.people,
      usualLeaveTime: state.usualLeaveTime,
      leaveTime: state.leaveTime,
      leaveDate: state.leaveDate,
      dayNotes: state.dayNotes
    };
  },
  getLeaveTimeToday: () => leaveTimeToday(),
  applyData(data) {
    undoStack.length = 0;            // undoing now would wipe out the other device's changes
    hideUndoToast();
    state = normalizeState({ ...state, ...structuredClone(data) });
    saveState(false);
    render();
  },
  // True while you're typing in a text box, so incoming changes wait instead of redrawing under you.
  isEditing() {
    const el = document.activeElement;
    return Boolean(el && el.closest('.app') && el.matches('input[type="text"], textarea'));
  }
};

els.dayNotes.value = state.dayNotes;
render();
formatDateTime();
saveState(false);
setInterval(formatDateTime, 1000);

// Register the service worker so the app can be installed and opened offline.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(error => console.warn('Service worker failed', error));
  });
}
