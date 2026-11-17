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
  leaveTime: '17:00',
  dayNotes: '',
  personFilter: 'all',
  peopleOpenOnly: true
};

let storageAvailable = checkStorageAvailable();
let state = loadState();
let toastTimer = null;
const isTouchDevice = window.matchMedia('(hover: none) and (pointer: coarse)').matches;

const els = {
  todayDate: document.getElementById('todayDate'),
  currentTime: document.getElementById('currentTime'),
  leaveTime: document.getElementById('leaveTime'),
  remainingTime: document.getElementById('remainingTime'),
  remainingMessage: document.getElementById('remainingMessage'),
  addProjectForm: document.getElementById('addProjectForm'),
  projectName: document.getElementById('projectName'),
  projectList: document.getElementById('projectList'),
  emptyState: document.getElementById('emptyState'),
  projectCount: document.getElementById('projectCount'),
  openTaskCount: document.getElementById('openTaskCount'),
  doneTaskCount: document.getElementById('doneTaskCount'),
  completionRate: document.getElementById('completionRate'),
  dayNotes: document.getElementById('dayNotes'),
  copySummaryBtn: document.getElementById('copySummaryBtn'),
  exportBtn: document.getElementById('exportBtn'),
  importBtn: document.getElementById('importBtn'),
  importFile: document.getElementById('importFile'),
  saveStatus: document.getElementById('saveStatus'),
  personFilter: document.getElementById('personFilter'),
  personSelect: document.getElementById('personSelect'),
  personSelectButton: document.getElementById('personSelectButton'),
  personSelectLabel: document.getElementById('personSelectLabel'),
  personSelectCount: document.getElementById('personSelectCount'),
  personSelectMenu: document.getElementById('personSelectMenu'),
  peopleOpenOnly: document.getElementById('peopleOpenOnly'),
  peopleResults: document.getElementById('peopleResults'),
  peopleResultsTitle: document.getElementById('peopleResultsTitle'),
  peopleResultsCount: document.getElementById('peopleResultsCount'),
  peopleTaskList: document.getElementById('peopleTaskList'),
  toast: document.getElementById('toast'),
  undoToast: document.getElementById('undoToast'),
  undoMessage: document.getElementById('undoMessage'),
  undoBtn: document.getElementById('undoBtn')
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
    });
    sortDoneTasksToBottom(project);
  });
  data.people = uniqueNames(data.people);
  data.leaveTime = data.leaveTime || '17:00';
  data.dayNotes = data.dayNotes || '';
  data.personFilter = data.personFilter || 'all';
  data.peopleOpenOnly = typeof data.peopleOpenOnly === 'boolean' ? data.peopleOpenOnly : true;
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
    updateSaveStatus(`Autosaved locally at ${formatClock(new Date())}`, false);
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

function formatDateTime() {
  const now = new Date();
  els.todayDate.textContent = now.toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  els.currentTime.textContent = formatClock(now);
  updateRemainingTime();
}

function formatTime12(hour24, minute) {
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`;
}


function populateLeaveTimeOptions() {
  // Native time input is used for easier editing. Step is 5 minutes.
}

function updateRemainingTime() {
  const value = state.leaveTime;
  if (!value) {
    els.remainingTime.textContent = '--';
    els.remainingMessage.textContent = 'Set your leaving time.';
    return;
  }

  const [h, m] = value.split(':').map(Number);
  const now = new Date();
  const leaving = new Date();
  leaving.setHours(h, m, 0, 0);

  const diffMs = leaving - now;
  const absMinutes = Math.abs(Math.ceil(diffMs / 60000));
  const hours = Math.floor(absMinutes / 60);
  const minutes = absMinutes % 60;
  const leavingText = formatTime12(h, m);

  if (diffMs >= 0) {
    els.remainingTime.textContent = `${hours}h ${minutes}m`;
    if (absMinutes <= 60) {
      els.remainingMessage.textContent = `Wrap-up mode before ${leavingText}.`;
    } else if (absMinutes <= 180) {
      els.remainingMessage.textContent = `Focus window until ${leavingText}.`;
    } else {
      els.remainingMessage.textContent = `Work window active until ${leavingText}.`;
    }
  } else {
    els.remainingTime.textContent = `+${hours}h ${minutes}m`;
    els.remainingMessage.textContent = `Past planned leaving time of ${leavingText}.`;
  }
}

function render() {
  els.leaveTime.value = state.leaveTime || '';
  els.dayNotes.value = state.dayNotes || '';
  els.projectList.innerHTML = '';
  els.emptyState.style.display = state.projects.length ? 'none' : 'block';

  state.projects.forEach(project => {
    sortDoneTasksToBottom(project);
    const card = document.createElement('article');
    card.className = `project-card ${project.collapsed ? 'collapsed' : ''}`;
    card.dataset.projectId = project.id;

    card.innerHTML = `
      <div class="project-header">
        <span class="drag-handle" title="Drag to reorder projects" aria-hidden="true">☰</span>
        <input class="project-title" type="text" value="${escapeHtml(project.name)}" aria-label="Project name" />
        <span class="project-progress" title="Tasks done">${project.tasks.filter(t => t.done).length}/${project.tasks.length}</span>
        <button class="btn-secondary btn-icon show-task-form" type="button" title="Add task" aria-label="Add task">+</button>
        <button class="more-btn project-more" type="button" title="More" aria-label="More project actions" aria-haspopup="menu" aria-expanded="false">⋯</button>
      </div>
      <div class="project-body">
        <form class="task-form">
          <input type="text" class="new-task" placeholder="Task name" autocomplete="off" />
          <button type="submit">Add</button>
          <button type="button" class="btn-secondary cancel-task">Cancel</button>
        </form>
        <ul class="task-list"></ul>
      </div>
    `;

    const taskList = card.querySelector('.task-list');
    project.tasks.forEach(task => {
      const item = document.createElement('li');
      item.className = `task-item ${task.done ? 'done' : ''}`;
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
        <button class="more-btn task-more" type="button" title="More" aria-label="More task actions" aria-haspopup="menu" aria-expanded="false">⋯</button>
      `;
      taskList.appendChild(item);
    });

    bindProjectCardEvents(card, project.id);
    els.projectList.appendChild(card);
  });

  renderSummary();
  renderPeopleView();
  updateRemainingTime();
  autosizeAllTaskText();
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

function renderSummary() {
  const totalProjects = state.projects.length;
  const tasks = state.projects.flatMap(p => p.tasks);
  const done = tasks.filter(t => t.done).length;
  const open = tasks.length - done;
  const rate = tasks.length ? Math.round((done / tasks.length) * 100) : 0;

  els.projectCount.textContent = totalProjects;
  els.openTaskCount.textContent = open;
  els.doneTaskCount.textContent = done;
  els.completionRate.textContent = `${rate}%`;
}



function renderPeopleView() {
  const openOnly = state.peopleOpenOnly !== false;
  const currentValue = state.personFilter || 'all';
  const personCounts = new Map();
  let unassignedCount = 0;

  state.projects.forEach(project => {
    project.tasks.forEach(task => {
      if (openOnly && task.done) return;
      const person = String(task.person || '').trim();
      if (person) {
        const existingName = [...personCounts.keys()].find(name => name.toLowerCase() === person.toLowerCase());
        const key = existingName || person;
        personCounts.set(key, (personCounts.get(key) || 0) + 1);
      } else {
        unassignedCount += 1;
      }
    });
  });

  const peopleOptions = [...personCounts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ value: `person:${name}`, label: name, rawLabel: name, count }));

  const options = [
    { value: 'all', label: 'All', rawLabel: 'All', count: null },
    ...peopleOptions
  ];

  if (unassignedCount > 0) {
    options.push({ value: 'unassigned', label: 'Unassigned', rawLabel: 'Unassigned', count: unassignedCount });
  }

  const validValues = new Set(options.map(option => option.value));
  if (!validValues.has(currentValue)) state.personFilter = 'all';

  els.personFilter.innerHTML = options
    .map(option => `<option value="${escapeHtml(option.value)}" ${option.value === state.personFilter ? 'selected' : ''}>${escapeHtml(option.label)}</option>`)
    .join('');
  els.personFilter.value = state.personFilter;
  renderPersonFilterDropdown(options);
  els.peopleOpenOnly.checked = openOnly;

  if (state.personFilter === 'all') {
    els.peopleResults.classList.remove('open');
    els.peopleTaskList.innerHTML = '';
    els.peopleResultsTitle.textContent = 'Tasks linked to person';
    els.peopleResultsCount.textContent = '0 tasks';
    return;
  }

  const selectedPerson = state.personFilter.startsWith('person:') ? state.personFilter.slice(7) : '';
  const rows = [];

  state.projects.forEach(project => {
    project.tasks.forEach(task => {
      const matchesPerson = selectedPerson
        ? (task.person || '').toLowerCase() === selectedPerson.toLowerCase()
        : !(task.person || '').trim();
      const matchesStatus = !openOnly || !task.done;
      if (matchesPerson && matchesStatus) rows.push({ project, task });
    });
  });

  const label = selectedPerson || 'Unassigned';
  const countLabel = `${rows.length} ${openOnly ? 'open' : 'total'}`;
  els.peopleResults.classList.add('open');
  els.peopleResultsTitle.textContent = `Tasks linked to ${label}`;
  els.peopleResultsCount.textContent = countLabel;
  els.peopleTaskList.innerHTML = '';

  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'people-empty';
    empty.textContent = openOnly ? 'No open tasks for this view.' : 'No tasks for this view.';
    els.peopleTaskList.appendChild(empty);
    return;
  }

  rows.forEach(({ project, task }) => {
    const row = document.createElement('div');
    row.className = `people-task-row ${task.done ? 'done' : ''}`;
    row.innerHTML = `
      <input type="checkbox" class="people-task-check" ${task.done ? 'checked' : ''} aria-label="Mark task done" />
      <span class="people-task-text" title="${escapeHtml(task.text)}">${escapeHtml(task.text)}</span>
      <span class="people-project-name" title="${escapeHtml(project.name)}">${escapeHtml(project.name)}</span>
    `;
    row.querySelector('.people-task-check').addEventListener('change', event => {
      task.done = event.target.checked;
      sortDoneTasksToBottom(project);
      saveState(false);
      render();
    });
    els.peopleTaskList.appendChild(row);
  });
}


function formatTaskCountText(count) {
  return `${count} task/s`;
}

function renderPersonFilterDropdown(options) {
  if (!els.personSelect || !els.personSelectMenu) return;

  const selected = options.find(option => option.value === state.personFilter) || options[0];
  els.personSelectLabel.textContent = `View: ${selected.rawLabel || selected.label}`;
  els.personSelectCount.textContent = '';
  els.personSelectMenu.innerHTML = '';

  options.forEach((option, index) => {
    const row = document.createElement('div');
    row.className = `person-select-option ${option.value === state.personFilter ? 'active' : ''}`;
    row.dataset.value = option.value;
    row.dataset.index = String(index);
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', option.value === state.personFilter ? 'true' : 'false');
    row.innerHTML = `
      <span class="person-select-option-name">${escapeHtml(option.rawLabel || option.label)}</span>
      <span class="person-select-option-count">${option.count ? escapeHtml(formatTaskCountText(option.count)) : ''}</span>
    `;
    row.addEventListener('click', () => selectPersonFilterOption(option.value));
    els.personSelectMenu.appendChild(row);
  });

  const activeIndex = Math.max(0, options.findIndex(option => option.value === state.personFilter));
  els.personSelect.dataset.activeIndex = String(activeIndex);
}

function selectPersonFilterOption(value) {
  state.personFilter = value;
  els.personSelect?.classList.remove('open');
  els.personSelectButton?.setAttribute('aria-expanded', 'false');
  saveState(false);
  renderPeopleView();
}

function openPersonFilterDropdown() {
  if (!els.personSelect) return;
  els.personSelect.classList.add('open');
  els.personSelectButton.setAttribute('aria-expanded', 'true');
  updatePersonFilterActiveOption();
}

function closePersonFilterDropdown() {
  if (!els.personSelect) return;
  els.personSelect.classList.remove('open');
  els.personSelectButton.setAttribute('aria-expanded', 'false');
}

function updatePersonFilterActiveOption() {
  const options = Array.from(els.personSelectMenu.querySelectorAll('.person-select-option'));
  let activeIndex = Number(els.personSelect.dataset.activeIndex || 0);
  if (activeIndex < 0) activeIndex = 0;
  if (activeIndex >= options.length) activeIndex = options.length - 1;
  els.personSelect.dataset.activeIndex = String(activeIndex);
  options.forEach((option, index) => option.classList.toggle('active', index === activeIndex));
  if (options[activeIndex]) options[activeIndex].scrollIntoView({ block: 'nearest' });
}

function bindProjectCardEvents(card, projectId) {
  const project = getProject(projectId);

  Drag.attach(card, {
    itemSelector: '.project-card',
    handle: '.drag-handle',
    resolveDrop: resolveProjectDrop,
    onDrop: ({ index }) => moveProject(projectId, index),
    onCancel: render
  });

  const projectTitleInput = card.querySelector('.project-title');

  projectTitleInput.addEventListener('focus', event => {
    event.target.dataset.original = project.name;
  });

  projectTitleInput.addEventListener('input', event => {
    project.name = event.target.value.trimStart();
    saveState(false);
  });

  projectTitleInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!event.target.value.trim()) project.name = 'Untitled Project';
      saveState();
      render();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      project.name = event.target.dataset.original || project.name || 'Untitled Project';
      saveState(false);
      render();
    }
  });

  projectTitleInput.addEventListener('blur', event => {
    if (!event.target.value.trim()) project.name = 'Untitled Project';
    saveState();
    render();
  });


  card.querySelector('.project-more').addEventListener('click', event => {
    event.stopPropagation();
    closeAllPersonMenus();
    ActionMenu.open(event.currentTarget, [
      {
        label: project.collapsed ? 'Expand' : 'Collapse',
        onClick: () => { project.collapsed = !project.collapsed; saveState(false); render(); }
      },
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
    const text = newTaskInput.value.trim();
    if (!text) return;
    project.tasks.push({ id: uid(), text, done: false, person: '' });
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

    Drag.attach(item, {
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

    item.querySelector('.task-more').addEventListener('click', event => {
      event.stopPropagation();
      closeAllPersonMenus();
      const others = state.projects.filter(p => p.id !== project.id);
      const isFirst = project.tasks[0]?.id === taskId;
      ActionMenu.open(event.currentTarget, [
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



els.personSelectButton.addEventListener('click', event => {
  event.stopPropagation();
  const isOpen = els.personSelect.classList.contains('open');
  closeAllPersonMenus();
  isOpen ? closePersonFilterDropdown() : openPersonFilterDropdown();
});

els.personSelect.addEventListener('click', event => event.stopPropagation());

els.personSelectButton.addEventListener('keydown', event => {
  const options = Array.from(els.personSelectMenu.querySelectorAll('.person-select-option'));
  let activeIndex = Number(els.personSelect.dataset.activeIndex || 0);

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    openPersonFilterDropdown();
    activeIndex = Math.min(activeIndex + 1, options.length - 1);
    els.personSelect.dataset.activeIndex = String(activeIndex);
    updatePersonFilterActiveOption();
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    openPersonFilterDropdown();
    activeIndex = Math.max(activeIndex - 1, 0);
    els.personSelect.dataset.activeIndex = String(activeIndex);
    updatePersonFilterActiveOption();
  }

  if (event.key === 'Enter') {
    event.preventDefault();
    if (!els.personSelect.classList.contains('open')) {
      openPersonFilterDropdown();
      return;
    }
    const active = options[Number(els.personSelect.dataset.activeIndex || 0)];
    if (active) selectPersonFilterOption(active.dataset.value);
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    closePersonFilterDropdown();
  }
});

els.personFilter.addEventListener('change', event => {
  state.personFilter = event.target.value;
  saveState(false);
  renderPeopleView();
});

els.peopleOpenOnly.addEventListener('change', event => {
  state.peopleOpenOnly = event.target.checked;
  saveState(false);
  renderPeopleView();
});

els.addProjectForm.addEventListener('submit', event => {
  event.preventDefault();
  const name = els.projectName.value.trim();
  if (!name) return;
  state.projects.push({
    id: uid(),
    name,
    collapsed: false,
    tasks: []
  });
  els.projectName.value = '';
  saveState();
  render();
});

els.leaveTime.addEventListener('change', event => {
  state.leaveTime = event.target.value;
  saveState();
  updateRemainingTime();
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

document.addEventListener('click', () => { closeAllPersonMenus(); closePersonFilterDropdown(); });

els.undoBtn.addEventListener('click', event => { event.stopPropagation(); undo(); });
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
      leaveTime: state.leaveTime,
      dayNotes: state.dayNotes
    };
  },
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

populateLeaveTimeOptions();
els.leaveTime.value = state.leaveTime || '17:00';
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
