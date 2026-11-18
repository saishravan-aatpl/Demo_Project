// Merging changes from two devices
// --------------------------------
// When two devices both changed the dashboard since they last synced, we combine
// the changes instead of letting one overwrite the other. This is a "three-way
// merge": we compare each side against the last version both agreed on ("base").
//
//   - Changed on one side only     -> keep that change
//   - Added on either side         -> keep it
//   - Deleted on one side only     -> delete it (unless the other side edited it)
//   - Same field changed on both   -> this device's version wins
//
// Only the synced data is merged: projects, tasks, people, leave time and notes.

(function (root) {
  const SYNCED_FIELDS = ['projects', 'people', 'leaveTime', 'dayNotes'];
  const PROJECT_FIELDS = ['name', 'collapsed', 'priority'];
  const TASK_FIELDS = ['text', 'done', 'person', 'pinnedOn'];

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

  function emptyData() {
    return { projects: [], people: [], leaveTime: '', dayNotes: '' };
  }

  // Pick the right value for one field.
  function pick(base, local, remote) {
    if (same(local, remote)) return clone(local);
    if (same(local, base)) return clone(remote);   // only remote changed
    if (same(remote, base)) return clone(local);   // only local changed
    return clone(local);                            // both changed: this device wins
  }

  function mergeFields(base, local, remote, fields) {
    const result = {};
    fields.forEach(field => {
      const value = pick(base ? base[field] : undefined, local[field], remote[field]);
      if (value !== undefined) result[field] = value;
    });
    return result;
  }

  // Merge two lists of objects that have an "id".
  function mergeList(baseList = [], localList = [], remoteList = [], mergeItem) {
    const byId = list => new Map(list.map(item => [item.id, item]));
    const baseMap = byId(baseList);
    const localMap = byId(localList);
    const remoteMap = byId(remoteList);

    const allIds = [...new Set([...remoteList, ...localList].map(item => item.id))];
    const merged = new Map();

    allIds.forEach(id => {
      const b = baseMap.get(id);
      const l = localMap.get(id);
      const r = remoteMap.get(id);

      if (b) {
        if (!l && !r) return;                                  // deleted on both
        if (!l) { if (!same(r, b)) merged.set(id, clone(r)); return; } // deleted here; keep only if edited remotely
        if (!r) { if (!same(l, b)) merged.set(id, clone(l)); return; } // deleted remotely; keep only if edited here
        merged.set(id, mergeItem(b, l, r));
      } else if (l && r) {
        merged.set(id, mergeItem(null, l, r));                 // added on both (e.g. same backup imported twice)
      } else {
        merged.set(id, clone(l || r));                         // added on one side
      }
    });

    // Order: if only this device re-ordered, use its order; otherwise the remote order.
    // Compare order using only items that exist everywhere, so additions and
    // deletions on the other device don't count as "re-ordering".
    const ids = list => list.map(item => item.id);
    const inAll = id => baseMap.has(id) && localMap.has(id) && remoteMap.has(id);
    const commonOrder = list => ids(list).filter(inAll);
    const localReordered = !same(commonOrder(localList), commonOrder(baseList));
    const remoteReordered = !same(commonOrder(remoteList), commonOrder(baseList));
    const useLocalOrder = localReordered && !remoteReordered;
    const primary = useLocalOrder ? ids(localList) : ids(remoteList);
    const secondary = useLocalOrder ? ids(remoteList) : ids(localList);
    const order = [...new Set([...primary, ...secondary])].filter(id => merged.has(id));
    return order.map(id => merged.get(id));
  }

  function mergeTask(base, local, remote) {
    return { id: local.id, ...mergeFields(base, local, remote, TASK_FIELDS) };
  }

  function mergeProject(base, local, remote) {
    return {
      id: local.id,
      ...mergeFields(base, local, remote, PROJECT_FIELDS),
      tasks: mergeList(base ? base.tasks : [], local.tasks || [], remote.tasks || [], mergeTask)
    };
  }

  // People are a simple list of names (case-insensitive).
  function mergePeople(base = [], local = [], remote = []) {
    const key = name => String(name || '').trim().toLowerCase();
    const baseKeys = new Set(base.map(key));
    const localKeys = new Set(local.map(key));
    const remoteKeys = new Set(remote.map(key));
    const removedHere = new Set([...baseKeys].filter(k => !localKeys.has(k)));
    const removedThere = new Set([...baseKeys].filter(k => !remoteKeys.has(k)));

    const seen = new Set();
    return [...remote, ...local].filter(name => {
      const k = key(name);
      if (!k || seen.has(k) || removedHere.has(k) || removedThere.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  function merge(base, local, remote) {
    base = base || emptyData();
    return {
      projects: mergeList(base.projects || [], local.projects || [], remote.projects || [], mergeProject),
      people: mergePeople(base.people || [], local.people || [], remote.people || []),
      leaveTime: pick(base.leaveTime, local.leaveTime, remote.leaveTime) || '',
      dayNotes: pick(base.dayNotes, local.dayNotes, remote.dayNotes) || ''
    };
  }

  const api = { merge, emptyData, SYNCED_FIELDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DashboardMerge = api;
})(typeof window !== 'undefined' ? window : globalThis);
