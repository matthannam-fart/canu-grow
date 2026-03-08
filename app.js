// ============================================
// CANU Grow — App Logic
// ============================================

var USER_EMAIL = '';
var USER_NAME = '';
var USER_IS_ADMIN = false;
var currentMember = null;

var state = {
  currentWeekStart: getMonday(new Date()),
  viewMode: 'week',
  selectedDate: new Date(),
  currentView: 'calendar',
  shifts: [],
  mySignups: [],
  members: [],
  jobs: [],
  openShifts: [],
  miniCalMonth: new Date()
};

// ==========================================
// Auth Flow
// ==========================================

document.addEventListener('DOMContentLoaded', function() {
  onAuthChange(async function(event, session) {
    if (session) {
      await initApp(session);
    } else {
      showAuthScreen();
    }
  });
});

async function handleLogin() {
  var code = document.getElementById('join-code').value.trim();
  var email = document.getElementById('login-email').value.trim();
  var name = document.getElementById('login-name').value.trim();

  if (!code) { showToast('Please enter the join code.', 'error'); return; }
  if (!email) { showToast('Please enter your email.', 'error'); return; }
  if (!name) { showToast('Please enter your name.', 'error'); return; }

  // Store name for after auth completes
  localStorage.setItem('canu_pending_name', name);
  localStorage.setItem('canu_join_code', code);

  try {
    await signInWithMagicLink(email);
    document.getElementById('auth-step-login').style.display = 'none';
    document.getElementById('auth-step-sent').style.display = '';
    document.getElementById('sent-email').textContent = email;
  } catch (err) {
    showToast('Login failed: ' + err.message, 'error');
  }
}

function showLoginStep() {
  document.getElementById('auth-step-login').style.display = '';
  document.getElementById('auth-step-sent').style.display = 'none';
}

function showAuthScreen() {
  document.getElementById('auth-screen').style.display = '';
  document.getElementById('app-container').style.display = 'none';
}

async function handleSignOut() {
  if (confirm('Sign out?')) {
    await signOut();
    showAuthScreen();
  }
}

async function initApp(session) {
  USER_EMAIL = session.user.email;

  // Check join code for new users
  var pendingName = localStorage.getItem('canu_pending_name');
  var joinCode = localStorage.getItem('canu_join_code');

  // Try to get existing member
  try {
    currentMember = await getCurrentMember();
  } catch (e) {
    currentMember = null;
  }

  if (!currentMember) {
    // New user — validate join code
    if (joinCode) {
      var valid = await validateJoinCode(joinCode);
      if (!valid) {
        showToast('Invalid join code. Please try again.', 'error');
        await signOut();
        showAuthScreen();
        return;
      }
    }

    // Register
    var displayName = pendingName || USER_EMAIL.split('@')[0];
    try {
      currentMember = await registerMember(USER_EMAIL, displayName);
    } catch (e) {
      // Might already exist from a race condition
      currentMember = await getCurrentMember();
    }
  }

  // Clean up localStorage
  localStorage.removeItem('canu_pending_name');
  localStorage.removeItem('canu_join_code');

  if (!currentMember) {
    showToast('Unable to load your profile.', 'error');
    return;
  }

  USER_NAME = currentMember.display_name || USER_EMAIL;
  USER_IS_ADMIN = currentMember.is_admin;

  // Show app
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app-container').style.display = '';

  // Set user display
  var initials = USER_NAME.split(' ').map(function(w) { return w[0]; }).join('').toUpperCase().substring(0, 2);
  document.getElementById('user-avatar').textContent = initials;
  document.getElementById('user-name-display').textContent = USER_NAME;

  if (USER_IS_ADMIN) {
    document.getElementById('nav-members').style.display = '';
    document.getElementById('nav-admin').style.display = '';
  }

  var tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  var dateInput = document.getElementById('shift-date');
  if (dateInput) dateInput.value = formatDateInput(tomorrow);

  loadWeekData();
  loadMySignups();
  loadJobs();
  renderMiniCalendar();
}

// ==========================================
// Navigation
// ==========================================

function showView(view) {
  state.currentView = view;
  var views = ['job-board', 'calendar', 'my-schedule', 'members', 'admin'];
  views.forEach(function(v) {
    var el = document.getElementById('view-' + v);
    if (el) el.style.display = (v === view) ? 'block' : 'none';
    if (v === 'calendar' && el) el.style.display = (v === view) ? '' : 'none';
  });

  var buttons = document.querySelectorAll('.header-nav button');
  buttons.forEach(function(btn) { btn.classList.remove('active'); });
  var viewMap = { 'job-board': 0, 'calendar': 1, 'my-schedule': 2, 'members': 3, 'admin': 4 };
  if (buttons[viewMap[view]]) buttons[viewMap[view]].classList.add('active');

  if (view === 'job-board') loadJobBoard();
  if (view === 'my-schedule') loadMyScheduleView();
  if (view === 'members') loadMembersView();
  if (view === 'admin') loadAdminView();
}

// ==========================================
// Week Navigation
// ==========================================

function prevWeek() { state.currentWeekStart.setDate(state.currentWeekStart.getDate() - 7); loadWeekData(); }
function nextWeek() { state.currentWeekStart.setDate(state.currentWeekStart.getDate() + 7); loadWeekData(); }
function goToday() { state.currentWeekStart = getMonday(new Date()); state.selectedDate = new Date(); loadWeekData(); renderMiniCalendar(); }

function setViewMode(mode, btn) {
  state.viewMode = mode;
  document.querySelectorAll('#view-calendar .view-toggle button').forEach(function(b) { b.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  document.getElementById('week-view').classList.toggle('hidden', mode !== 'week');
  document.getElementById('day-view').classList.toggle('visible', mode === 'day');
  if (mode === 'day') renderDayView();
}

// ==========================================
// Data Loading
// ==========================================

async function loadWeekData() {
  updateWeekTitle();
  showWeekSkeleton();
  try {
    state.shifts = await getShiftsForWeek(state.currentWeekStart);
    renderWeekView();
    if (state.viewMode === 'day') renderDayView();
    updateStats();
    renderMiniCalendar();
  } catch (err) {
    showToast('Failed to load shifts: ' + err.message, 'error');
    state.shifts = [];
    renderWeekView();
  }
}

async function loadMySignups() {
  try {
    state.mySignups = await getMySignups();
    renderMyCommitments();
    updateStats();
  } catch (e) {}
}

async function loadJobs() {
  try {
    state.jobs = await getJobs();
    populateJobDropdown();
    renderJobsList();
  } catch (e) {}
}

// ==========================================
// Job Board
// ==========================================

var jobBoardFilter = 'all';

async function loadJobBoard() {
  var container = document.getElementById('job-board-content');
  container.innerHTML = '<div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div>';
  try {
    state.openShifts = await getOpenShifts();
    renderJobBoard();
  } catch (err) {
    container.innerHTML = '<div class="empty-state"><p>Failed to load open shifts.</p></div>';
  }
}

function setJobBoardFilter(category, btn) {
  jobBoardFilter = category;
  document.querySelectorAll('#view-job-board .view-toggle button').forEach(function(b) { b.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  renderJobBoard();
}

function renderJobBoard() {
  var container = document.getElementById('job-board-content');
  var shifts = state.openShifts || [];
  if (jobBoardFilter !== 'all') shifts = shifts.filter(function(s) { return s.category === jobBoardFilter; });

  if (shifts.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="icon">🌿</div><h3>All caught up!</h3><p>' +
      (jobBoardFilter !== 'all' ? 'No open ' + jobBoardFilter + ' shifts.' : 'No open shifts right now.') + '</p></div>';
    return;
  }

  var html = '';
  var currentDate = '';
  shifts.forEach(function(shift) {
    var dateStr = formatDateReadable(new Date(shift.date));
    if (dateStr !== currentDate) {
      currentDate = dateStr;
      html += '<div class="schedule-week-label" style="margin-top:16px;margin-bottom:8px;">' + dateStr + '</div>';
    }
    var isSignedUp = isUserSignedUp(shift);
    html += '<div class="job-board-card cat-' + shift.category + '">';
    html += '<div class="job-board-info">';
    html += '<h3>' + escapeHtml(shift.title) + '</h3>';
    html += '<div class="meta"><span class="category-badge ' + shift.category + '" style="margin-right:8px;">' + shift.category + '</span>' + formatTimeDisplay(shift.start_time) + ' – ' + formatTimeDisplay(shift.end_time) + '</div>';
    if (shift.description) html += '<div class="description">' + escapeHtml(shift.description) + '</div>';
    html += '</div>';
    html += '<div class="job-board-slots"><div class="slots-count">' + shift.spotsRemaining + '</div><div class="slots-label">open</div></div>';
    if (isSignedUp) {
      html += '<button class="btn-signup-inline cancel" onclick="doCancel(\'' + shift.id + '\')">Cancel</button>';
    } else {
      html += '<button class="btn-signup-inline" onclick="doSignUp(\'' + shift.id + '\')">Sign Up</button>';
    }
    html += '</div>';
  });
  container.innerHTML = html;
}

// ==========================================
// Week View
// ==========================================

function renderWeekView() {
  var grid = document.getElementById('week-grid');
  var weekDates = getWeekDates(state.currentWeekStart);
  var today = new Date(); today.setHours(0, 0, 0, 0);

  var html = '';
  weekDates.forEach(function(date) {
    var dateStr = formatDateISO(date);
    var isToday = date.getTime() === today.getTime();
    var dayShifts = state.shifts.filter(function(s) { return s.date === dateStr; });

    html += '<div class="day-column">';
    html += '<div class="day-column-header ' + (isToday ? 'today' : '') + '"><span class="day-number">' + date.getDate() + '</span>' + getDayName(date) + '</div>';

    if (dayShifts.length === 0) {
      html += '<p style="text-align:center;color:var(--text-soft);font-size:12px;padding:20px 0;">No shifts</p>';
    } else {
      dayShifts.forEach(function(shift) {
        var isSignedUp = isUserSignedUp(shift);
        html += '<div class="shift-card cat-' + shift.category + (isSignedUp ? ' user-signed-up' : '') + '" onclick="openShiftModal(\'' + shift.id + '\')">';
        html += '<div class="shift-card-title">' + escapeHtml(shift.title) + '</div>';
        html += '<div class="shift-card-time">' + formatTimeDisplay(shift.start_time) + ' – ' + formatTimeDisplay(shift.end_time) + '</div>';
        html += '<div class="shift-card-slots">' + renderSlotDots(shift) + '</div>';
        html += '</div>';
      });
    }
    html += '</div>';
  });
  grid.innerHTML = html;
}

function showWeekSkeleton() {
  var grid = document.getElementById('week-grid');
  var html = '';
  for (var i = 0; i < 7; i++) {
    html += '<div class="day-column"><div class="day-column-header"><span class="day-number">&nbsp;</span>&nbsp;</div><div class="skeleton skeleton-card"></div></div>';
  }
  grid.innerHTML = html;
}

function renderSlotDots(shift) {
  var html = '';
  var cap = parseInt(shift.capacity, 10) || 3;
  for (var i = 0; i < cap; i++) {
    if (i < shift.signupCount) {
      var m = shift.members[i];
      html += '<span class="slot-dot filled" title="' + escapeHtml(m ? m.name : '') + '">' + (m && m.name ? m.name[0].toUpperCase() : '?') + '</span>';
    } else {
      html += '<span class="slot-dot empty"></span>';
    }
  }
  return html;
}

// ==========================================
// Day View
// ==========================================

function renderDayView() {
  var container = document.getElementById('day-view-content');
  var dateStr = formatDateISO(state.selectedDate);
  var dayShifts = state.shifts.filter(function(s) { return s.date === dateStr; });

  if (dayShifts.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="icon">🌱</div><h3>No shifts on ' + formatDateReadable(state.selectedDate) + '</h3></div>';
    return;
  }

  var html = '<h3 style="margin-bottom:12px;">' + formatDateReadable(state.selectedDate) + '</h3>';
  dayShifts.forEach(function(shift) {
    var isSignedUp = isUserSignedUp(shift);
    var isFull = shift.spotsRemaining <= 0;
    html += '<div class="day-shift-row cat-' + shift.category + '" onclick="openShiftModal(\'' + shift.id + '\')">';
    html += '<div class="day-shift-info"><h3>' + escapeHtml(shift.title) + '</h3><div class="time">' + formatTimeDisplay(shift.start_time) + ' – ' + formatTimeDisplay(shift.end_time) + '</div>';
    if (shift.description) html += '<div class="description">' + escapeHtml(shift.description) + '</div>';
    html += '</div><div class="day-shift-slots">' + renderSlotDots(shift) + '</div>';
    if (isSignedUp) html += '<button class="btn-signup-inline cancel" onclick="event.stopPropagation();doCancel(\'' + shift.id + '\')">Cancel</button>';
    else if (isFull) html += '<button class="btn-signup-inline full" disabled>Full</button>';
    else html += '<button class="btn-signup-inline" onclick="event.stopPropagation();doSignUp(\'' + shift.id + '\')">Sign Up</button>';
    html += '</div>';
  });
  container.innerHTML = html;
}

// ==========================================
// Shift Modal
// ==========================================

function openShiftModal(shiftId) {
  var shift = findShift(shiftId);
  if (!shift) return;

  document.getElementById('modal-category').textContent = shift.category;
  document.getElementById('modal-category').className = 'category-badge ' + shift.category;
  document.getElementById('modal-title').textContent = shift.title;
  document.getElementById('modal-meta').textContent = formatDateReadable(new Date(shift.date)) + ' · ' + formatTimeDisplay(shift.start_time) + ' – ' + formatTimeDisplay(shift.end_time);
  document.getElementById('modal-description').textContent = shift.description || '';
  document.getElementById('modal-capacity').innerHTML = '<strong>' + shift.signupCount + ' of ' + shift.capacity + '</strong> filled';

  var memHtml = '';
  (shift.members || []).forEach(function(m) {
    var init = m.name ? m.name[0].toUpperCase() : '?';
    memHtml += '<li><div class="user-avatar" style="width:28px;height:28px;font-size:11px;">' + init + '</div> ' + escapeHtml(m.name) + '</li>';
  });
  document.getElementById('modal-members').innerHTML = memHtml;

  var emptyHtml = '';
  for (var i = 0; i < shift.spotsRemaining; i++) {
    emptyHtml += '<div class="empty-slot"><div class="empty-slot-circle"></div> Open slot</div>';
  }
  document.getElementById('modal-empty-slots').innerHTML = emptyHtml;

  var actionsHtml = '';
  var isSignedUp = isUserSignedUp(shift);
  if (isSignedUp) actionsHtml += '<button class="btn-danger" onclick="doCancel(\'' + shiftId + '\')">Cancel Signup</button>';
  else if (shift.spotsRemaining > 0) actionsHtml += '<button class="btn-primary" onclick="doSignUp(\'' + shiftId + '\')">Sign Up</button>';
  else actionsHtml += '<button class="btn-primary" disabled>Full</button>';

  if (USER_IS_ADMIN) {
    actionsHtml += '<button class="btn-outline" onclick="openEditModal(\'' + shiftId + '\')">Edit</button>';
    actionsHtml += '<button class="btn-danger" onclick="confirmDeleteShift(\'' + shiftId + '\')">Delete</button>';
  }
  document.getElementById('modal-actions').innerHTML = actionsHtml;

  var assignPanel = document.getElementById('modal-assign');
  if (USER_IS_ADMIN && shift.spotsRemaining > 0) {
    assignPanel.style.display = '';
    assignPanel.dataset.shiftId = shiftId;
    populateAssignDropdown(shift);
  } else {
    assignPanel.style.display = 'none';
  }

  document.getElementById('shift-modal').classList.add('visible');
}

function closeModal() { document.getElementById('shift-modal').classList.remove('visible'); }

// ==========================================
// Edit Modal
// ==========================================

function openEditModal(shiftId) {
  closeModal();
  var shift = findShift(shiftId);
  if (!shift) return;
  document.getElementById('edit-shift-id').value = shiftId;
  document.getElementById('edit-date').value = shift.date;
  document.getElementById('edit-category').value = shift.category;
  document.getElementById('edit-start').value = shift.start_time;
  document.getElementById('edit-end').value = shift.end_time;
  document.getElementById('edit-title').value = shift.title;
  document.getElementById('edit-capacity').value = shift.capacity;
  document.getElementById('edit-description').value = shift.description || '';
  document.getElementById('edit-modal').classList.add('visible');
}

function closeEditModal() { document.getElementById('edit-modal').classList.remove('visible'); }

async function handleUpdateShift() {
  var shiftId = document.getElementById('edit-shift-id').value;
  try {
    await updateShift(shiftId, {
      date: document.getElementById('edit-date').value,
      start_time: document.getElementById('edit-start').value,
      end_time: document.getElementById('edit-end').value,
      title: document.getElementById('edit-title').value,
      category: document.getElementById('edit-category').value,
      description: document.getElementById('edit-description').value,
      capacity: parseInt(document.getElementById('edit-capacity').value, 10)
    });
    closeEditModal();
    showToast('Shift updated!', 'success');
    loadWeekData();
  } catch (err) {
    showToast('Update failed: ' + err.message, 'error');
  }
}

// ==========================================
// Signup / Cancel
// ==========================================

async function doSignUp(shiftId) {
  closeModal();
  showToast('Signing up...', 'info');
  try {
    await signUp(shiftId);
    showToast('You\'re signed up!', 'success');
    loadWeekData();
    loadMySignups();
    if (state.currentView === 'job-board') loadJobBoard();
  } catch (err) {
    showToast('Signup failed: ' + err.message, 'error');
  }
}

async function doCancel(shiftId) {
  showConfirm('Cancel Signup', 'Are you sure you want to cancel?', async function() {
    closeModal();
    showToast('Cancelling...', 'info');
    try {
      await cancelSignup(shiftId);
      showToast('Signup cancelled.', 'success');
      loadWeekData();
      loadMySignups();
      if (state.currentView === 'job-board') loadJobBoard();
    } catch (err) {
      showToast('Cancel failed: ' + err.message, 'error');
    }
  });
}

function confirmDeleteShift(shiftId) {
  showConfirm('Delete Shift', 'This will cancel all signups. Continue?', async function() {
    closeModal();
    try {
      await deleteShift(shiftId);
      showToast('Shift deleted.', 'success');
      loadWeekData();
    } catch (err) {
      showToast('Delete failed: ' + err.message, 'error');
    }
  });
}

// ==========================================
// Admin: Jobs
// ==========================================

function populateJobDropdown() {
  var select = document.getElementById('shift-job');
  if (!select) return;
  var html = '<option value="">— Select a job —</option>';
  state.jobs.forEach(function(job) {
    html += '<option value="' + job.id + '" data-category="' + job.category + '" data-capacity="' + job.default_capacity + '">' + escapeHtml(job.title) + ' (' + job.category + ')</option>';
  });
  select.innerHTML = html;
  select.onchange = function() {
    var opt = select.options[select.selectedIndex];
    if (opt && opt.dataset.capacity) document.getElementById('shift-capacity').placeholder = opt.dataset.capacity;
  };
}

function renderJobsList() {
  var container = document.getElementById('jobs-list');
  if (!container) return;
  if (state.jobs.length === 0) { container.innerHTML = '<p style="font-size:13px;color:var(--text-soft);">No jobs yet.</p>'; return; }
  var html = '';
  state.jobs.forEach(function(job) {
    html += '<div class="schedule-row" style="align-items:center;"><span class="category-badge ' + job.category + '">' + job.category + '</span><div class="title" style="flex:1;">' + escapeHtml(job.title) + '</div><div style="color:var(--text-soft);font-size:13px;">Cap: ' + job.default_capacity + '</div><button class="btn-danger" style="padding:4px 10px;font-size:12px;" onclick="confirmDeleteJob(\'' + job.id + '\')">Delete</button></div>';
  });
  container.innerHTML = html;
}

async function handleCreateJob() {
  var data = { title: document.getElementById('job-title').value, category: document.getElementById('job-category').value, description: document.getElementById('job-description').value, default_capacity: document.getElementById('job-capacity').value };
  if (!data.title) { showToast('Job title is required.', 'error'); return; }
  try {
    await createJob(data);
    showToast('Job created!', 'success');
    document.getElementById('job-title').value = '';
    document.getElementById('job-description').value = '';
    loadJobs();
  } catch (err) { showToast('Failed: ' + err.message, 'error'); }
}

function confirmDeleteJob(jobId) {
  showConfirm('Delete Job', 'Delete this job template?', async function() {
    try { await deleteJob(jobId); showToast('Job deleted.', 'success'); loadJobs(); }
    catch (err) { showToast('Failed: ' + err.message, 'error'); }
  });
}

// ==========================================
// Admin: Create Shift
// ==========================================

async function handleCreateShift() {
  var jobId = document.getElementById('shift-job').value;
  if (!jobId) { showToast('Please select a job.', 'error'); return; }
  var job = state.jobs.find(function(j) { return j.id === jobId; });
  if (!job) { showToast('Job not found.', 'error'); return; }

  var date = document.getElementById('shift-date').value;
  var start = document.getElementById('shift-start').value;
  var end = document.getElementById('shift-end').value;
  if (!date || !start || !end) { showToast('Fill in date, start, and end time.', 'error'); return; }

  var capOverride = document.getElementById('shift-capacity').value;

  try {
    await createShift({
      job_id: jobId, title: job.title, category: job.category, description: job.description,
      date: date, start_time: start, end_time: end, capacity: capOverride || job.default_capacity
    });
    showToast('Shift scheduled!', 'success');
    loadWeekData();
    if (state.currentView === 'admin') loadAdminView();
  } catch (err) { showToast('Failed: ' + err.message, 'error'); }
}

async function handleExportCSV() {
  // TODO: implement export via Supabase query
  showToast('Export coming soon.', 'info');
}

// ==========================================
// Admin: Assign Member
// ==========================================

async function populateAssignDropdown(shift) {
  var select = document.getElementById('assign-member-select');
  select.innerHTML = '<option value="">Loading...</option>';
  try {
    var members = await getMembersList();
    var assignedEmails = (shift.members || []).map(function(m) { return m.email.toLowerCase(); });
    var available = members.filter(function(m) { return assignedEmails.indexOf(m.email.toLowerCase()) === -1; });
    var html = '<option value="">— Select a member —</option>';
    available.forEach(function(m) { html += '<option value="' + escapeHtml(m.email) + '">' + escapeHtml(m.display_name) + ' (' + m.email + ')</option>'; });
    select.innerHTML = html;
  } catch (e) { select.innerHTML = '<option value="">Failed to load</option>'; }
}

async function handleAssignMember() {
  var panel = document.getElementById('modal-assign');
  var shiftId = panel.dataset.shiftId;
  var email = document.getElementById('assign-member-select').value;
  if (!email) { showToast('Select a member.', 'error'); return; }
  try {
    await assignMember(shiftId, email);
    showToast('Member assigned!', 'success');
    closeModal();
    loadWeekData();
    loadMySignups();
    if (state.currentView === 'job-board') loadJobBoard();
  } catch (err) { showToast('Failed: ' + err.message, 'error'); }
}

// ==========================================
// My Schedule
// ==========================================

async function loadMyScheduleView() {
  var container = document.getElementById('my-schedule-content');
  container.innerHTML = '<div class="skeleton skeleton-card"></div>';
  try {
    state.mySignups = await getMySignups();
    renderMySchedule();
    renderMyCommitments();
  } catch (e) { container.innerHTML = '<div class="empty-state"><p>Failed to load.</p></div>'; }
}

function renderMySchedule() {
  var container = document.getElementById('my-schedule-content');
  if (state.mySignups.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="icon">📅</div><h3>No upcoming shifts</h3><p>Browse the Job Board to sign up!</p></div>';
    return;
  }
  var weeks = {};
  state.mySignups.forEach(function(su) {
    var mon = getMonday(new Date(su.date));
    var key = formatDateISO(mon);
    if (!weeks[key]) weeks[key] = { label: 'Week of ' + formatDateReadable(mon), items: [] };
    weeks[key].items.push(su);
  });
  var html = '';
  Object.keys(weeks).sort().forEach(function(key) {
    html += '<div class="schedule-week-group"><div class="schedule-week-label">' + weeks[key].label + '</div>';
    weeks[key].items.forEach(function(su) {
      html += '<div class="schedule-row"><div class="date">' + formatDateReadable(new Date(su.date)) + '</div><div class="title">' + escapeHtml(su.title) + '</div><span class="category-badge ' + su.category + '">' + su.category + '</span><div class="time">' + formatTimeDisplay(su.start_time) + ' – ' + formatTimeDisplay(su.end_time) + '</div><button class="btn-danger" style="padding:6px 14px;font-size:12px;" onclick="doCancel(\'' + su.shift_id + '\')">Cancel</button></div>';
    });
    html += '</div>';
  });
  container.innerHTML = html;
}

// ==========================================
// Members View
// ==========================================

async function loadMembersView() {
  try { state.members = await getMembersList(); renderMembersTable(state.members); } catch (e) {}
}

function renderMembersTable(members) {
  var tbody = document.getElementById('members-tbody');
  var html = '';
  members.forEach(function(m) {
    html += '<tr><td>' + escapeHtml(m.display_name) + '</td><td>' + escapeHtml(m.email) + '</td><td>' + (m.total_shifts || 0) + '</td><td>' + (m.created_at ? formatDateReadable(new Date(m.created_at)) : '—') + '</td><td>' + (m.is_admin ? 'Yes' : 'No') + '</td></tr>';
  });
  tbody.innerHTML = html || '<tr><td colspan="5" style="text-align:center;color:var(--text-soft);">No members yet.</td></tr>';
}

function filterMembers(q) {
  q = q.toLowerCase();
  renderMembersTable(state.members.filter(function(m) { return (m.display_name || '').toLowerCase().indexOf(q) !== -1 || m.email.toLowerCase().indexOf(q) !== -1; }));
}

// ==========================================
// Admin View
// ==========================================

async function loadAdminView() {
  loadJobs();
  try {
    var shifts = await getShiftsForWeek(new Date());
    var container = document.getElementById('admin-shifts-list');
    var upcoming = shifts.filter(function(s) { return new Date(s.date) >= new Date(new Date().toDateString()); }).sort(function(a, b) { return new Date(a.date) - new Date(b.date); });
    if (upcoming.length === 0) { container.innerHTML = '<p style="color:var(--text-soft);font-size:14px;">No upcoming shifts.</p>'; return; }
    var html = '';
    upcoming.forEach(function(s) {
      html += '<div class="schedule-row"><div class="date">' + formatDateReadable(new Date(s.date)) + '</div><div class="title">' + escapeHtml(s.title) + '</div><span class="category-badge ' + s.category + '">' + s.category + '</span><div class="time">' + s.signupCount + '/' + s.capacity + '</div><button class="btn-outline" style="padding:6px 12px;font-size:12px;" onclick="openEditModal(\'' + s.id + '\')">Edit</button><button class="btn-danger" style="padding:6px 12px;font-size:12px;" onclick="confirmDeleteShift(\'' + s.id + '\')">Delete</button></div>';
    });
    container.innerHTML = html;
  } catch (e) {}
}

// ==========================================
// Sidebar
// ==========================================

function renderMyCommitments() {
  var container = document.getElementById('my-commitments-list');
  var upcoming = state.mySignups.slice(0, 5);
  if (upcoming.length === 0) { container.innerHTML = '<p style="font-size:13px;color:var(--text-soft);">No upcoming shifts.</p>'; return; }
  var html = '';
  upcoming.forEach(function(su) {
    html += '<div class="commitment-item" onclick="openShiftModal(\'' + su.shift_id + '\')"><div class="commitment-title">' + escapeHtml(su.title) + '</div><div class="commitment-meta">' + formatDateReadable(new Date(su.date)) + ' · ' + formatTimeDisplay(su.start_time) + '</div></div>';
  });
  container.innerHTML = html;
}

async function updateStats() {
  var open = state.shifts.filter(function(s) { return s.spotsRemaining > 0; }).length;
  var filled = state.shifts.reduce(function(sum, s) { return sum + s.signupCount; }, 0);
  var mine = state.shifts.filter(function(s) { return isUserSignedUp(s); }).length;
  document.getElementById('stat-open').textContent = open;
  document.getElementById('stat-filled').textContent = filled;
  document.getElementById('stat-my-shifts').textContent = mine;

  var reminderCard = document.getElementById('upcoming-reminder');
  var now = new Date();
  var soon = state.mySignups.find(function(su) { var d = new Date(su.date).getTime() - now.getTime(); return d > 0 && d < 86400000; });
  if (soon) { reminderCard.style.display = ''; document.getElementById('upcoming-reminder-text').textContent = soon.title + ' · ' + formatTimeDisplay(soon.start_time); }
  else { reminderCard.style.display = 'none'; }

  try {
    var members = await getMembersList();
    document.getElementById('stat-members').textContent = members.length;
    var list = document.getElementById('active-members-list');
    var html = '';
    members.slice(0, 10).forEach(function(m) { html += '<div class="active-member-item"><span>' + escapeHtml(m.display_name) + '</span><span class="active-member-count">' + (m.total_shifts || 0) + ' shifts</span></div>'; });
    list.innerHTML = html || '<p style="font-size:13px;color:var(--text-soft);">No members yet.</p>';
  } catch (e) {}
}

// ==========================================
// Mini Calendar
// ==========================================

function renderMiniCalendar() {
  var month = state.miniCalMonth;
  document.getElementById('mini-cal-month').textContent = month.toLocaleString('default', { month: 'long', year: 'numeric' });
  var grid = document.getElementById('mini-cal-grid');
  var html = '';
  ['Mo','Tu','We','Th','Fr','Sa','Su'].forEach(function(d) { html += '<span class="day-label">' + d + '</span>'; });

  var first = new Date(month.getFullYear(), month.getMonth(), 1);
  var startDay = (first.getDay() + 6) % 7;
  var daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  var today = new Date(); today.setHours(0,0,0,0);
  var prevDays = new Date(month.getFullYear(), month.getMonth(), 0).getDate();

  for (var p = startDay - 1; p >= 0; p--) html += '<span class="day-cell other-month">' + (prevDays - p) + '</span>';
  for (var d = 1; d <= daysInMonth; d++) {
    var cell = new Date(month.getFullYear(), month.getMonth(), d);
    var cls = 'day-cell';
    if (cell.getTime() === today.getTime()) cls += ' today';
    if (formatDateISO(cell) === formatDateISO(state.selectedDate)) cls += ' selected';
    if (state.shifts.some(function(s) { return s.date === formatDateISO(cell); })) cls += ' has-shifts';
    html += '<span class="' + cls + '" onclick="selectMiniCalDate(' + cell.getTime() + ')">' + d + '</span>';
  }
  var total = startDay + daysInMonth;
  for (var n = 1; n <= (7 - total % 7) % 7; n++) html += '<span class="day-cell other-month">' + n + '</span>';
  grid.innerHTML = html;
}

function miniCalPrev() { state.miniCalMonth.setMonth(state.miniCalMonth.getMonth() - 1); renderMiniCalendar(); }
function miniCalNext() { state.miniCalMonth.setMonth(state.miniCalMonth.getMonth() + 1); renderMiniCalendar(); }
function selectMiniCalDate(ts) { state.selectedDate = new Date(ts); state.currentWeekStart = getMonday(state.selectedDate); loadWeekData(); }

// ==========================================
// Confirm / Toast
// ==========================================

var confirmCallback = null;
function showConfirm(title, message, onConfirm) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-message').textContent = message;
  confirmCallback = onConfirm;
  document.getElementById('confirm-action-btn').onclick = function() { var cb = confirmCallback; closeConfirm(); if (cb) cb(); };
  document.getElementById('confirm-dialog').classList.add('visible');
}
function closeConfirm() { document.getElementById('confirm-dialog').classList.remove('visible'); confirmCallback = null; }

function showToast(message, type) {
  type = type || 'info';
  var container = document.getElementById('toast-container');
  var toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(function() { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(function() { toast.remove(); }, 300); }, 3500);
}

// ==========================================
// Helpers
// ==========================================

function findShift(id) {
  return state.shifts.find(function(s) { return s.id === id; }) ||
    (state.openShifts || []).find(function(s) { return s.id === id; });
}

function getMonday(date) { var d = new Date(date); d.setHours(0,0,0,0); var day = d.getDay(); d.setDate(d.getDate() - day + (day === 0 ? -6 : 1)); return d; }
function getWeekDates(mon) { var a = []; for (var i = 0; i < 7; i++) { var d = new Date(mon); d.setDate(d.getDate() + i); a.push(d); } return a; }

function formatDateISO(date) { var d = new Date(date); return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()); }
function formatDateInput(date) { return formatDateISO(date); }
function formatDateReadable(date) { var d = new Date(date); var m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return m[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear(); }

function formatTimeDisplay(t) {
  if (!t) return '';
  var parts = String(t).split(':');
  var h = parseInt(parts[0], 10);
  var m = parts[1] || '00';
  var suf = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return h + ':' + m + ' ' + suf;
}

function getDayName(date) { return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(date).getDay()]; }

function updateWeekTitle() {
  var dates = getWeekDates(state.currentWeekStart);
  var s = dates[0], e = dates[6];
  var m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  document.getElementById('week-title').textContent = s.getMonth() === e.getMonth()
    ? m[s.getMonth()] + ' ' + s.getDate() + '–' + e.getDate() + ', ' + s.getFullYear()
    : m[s.getMonth()] + ' ' + s.getDate() + ' – ' + m[e.getMonth()] + ' ' + e.getDate() + ', ' + e.getFullYear();
}

function isUserSignedUp(shift) { return (shift.members || []).some(function(m) { return m.email === USER_EMAIL; }); }
function pad(n) { return n < 10 ? '0' + n : '' + n; }
function escapeHtml(s) { if (!s) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
