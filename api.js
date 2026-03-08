// ============================================
// CANU Grow — Supabase API Layer
// ============================================

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- Auth ---

async function signInWithMagicLink(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email: email,
    options: { emailRedirectTo: window.location.origin + window.location.pathname }
  });
  if (error) throw error;
}

async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

function onAuthChange(callback) {
  supabase.auth.onAuthStateChange(callback);
}

// --- Members ---

async function getCurrentMember() {
  const session = await getSession();
  if (!session) return null;

  const email = session.user.email;
  const { data, error } = await supabase
    .from('members')
    .select('*')
    .eq('email', email)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function registerMember(email, displayName) {
  const { data, error } = await supabase
    .from('members')
    .insert({ email: email, display_name: displayName })
    .select()
    .single();

  if (error && error.code === '23505') {
    // Already exists — just fetch
    return getCurrentMember();
  }
  if (error) throw error;
  return data;
}

async function getMembersList() {
  const { data, error } = await supabase
    .from('members')
    .select('*')
    .order('total_shifts', { ascending: false });

  if (error) throw error;
  return data;
}

// --- Jobs ---

async function getJobs() {
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .order('title');

  if (error) throw error;
  return data;
}

async function createJob(jobData) {
  const member = await getCurrentMember();
  const { data, error } = await supabase
    .from('jobs')
    .insert({
      title: jobData.title,
      category: jobData.category,
      description: jobData.description || '',
      default_capacity: parseInt(jobData.default_capacity, 10) || 3,
      created_by: member.id
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function deleteJob(jobId) {
  const { error } = await supabase
    .from('jobs')
    .delete()
    .eq('id', jobId);

  if (error) throw error;
}

// --- Shifts ---

async function getShiftsForWeek(weekStart) {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const { data: shifts, error } = await supabase
    .from('shifts')
    .select('*')
    .gte('date', formatDateISO(weekStart))
    .lt('date', formatDateISO(weekEnd))
    .order('date')
    .order('start_time');

  if (error) throw error;

  // Fetch signups for these shifts
  const shiftIds = shifts.map(s => s.id);
  const { data: signups } = await supabase
    .from('signups')
    .select('*')
    .in('shift_id', shiftIds)
    .eq('status', 'active');

  return shifts.map(shift => {
    const shiftSignups = (signups || []).filter(su => su.shift_id === shift.id);
    return {
      ...shift,
      members: shiftSignups.map(su => ({ email: su.member_email, name: su.member_name })),
      signupCount: shiftSignups.length,
      spotsRemaining: shift.capacity - shiftSignups.length
    };
  });
}

async function getOpenShifts() {
  const today = formatDateISO(new Date());

  const { data: shifts, error } = await supabase
    .from('shifts')
    .select('*')
    .gte('date', today)
    .order('date')
    .order('start_time');

  if (error) throw error;

  const shiftIds = shifts.map(s => s.id);
  if (shiftIds.length === 0) return [];

  const { data: signups } = await supabase
    .from('signups')
    .select('*')
    .in('shift_id', shiftIds)
    .eq('status', 'active');

  return shifts.map(shift => {
    const shiftSignups = (signups || []).filter(su => su.shift_id === shift.id);
    return {
      ...shift,
      members: shiftSignups.map(su => ({ email: su.member_email, name: su.member_name })),
      signupCount: shiftSignups.length,
      spotsRemaining: shift.capacity - shiftSignups.length
    };
  }).filter(s => s.spotsRemaining > 0);
}

async function createShift(shiftData) {
  const member = await getCurrentMember();
  const { data, error } = await supabase
    .from('shifts')
    .insert({
      job_id: shiftData.job_id || null,
      title: shiftData.title,
      category: shiftData.category,
      description: shiftData.description || '',
      date: shiftData.date,
      start_time: shiftData.start_time,
      end_time: shiftData.end_time,
      capacity: parseInt(shiftData.capacity, 10) || 3,
      created_by: member.id
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function updateShift(shiftId, updates) {
  const { data, error } = await supabase
    .from('shifts')
    .update(updates)
    .eq('id', shiftId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function deleteShift(shiftId) {
  const { error } = await supabase
    .from('shifts')
    .delete()
    .eq('id', shiftId);

  if (error) throw error;
}

// --- Signups ---

async function signUp(shiftId) {
  const member = await getCurrentMember();

  const { data, error } = await supabase
    .from('signups')
    .insert({
      shift_id: shiftId,
      member_id: member.id,
      member_email: member.email,
      member_name: member.display_name
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') throw new Error('You are already signed up for this shift.');
    throw error;
  }

  // Increment shift count
  await supabase.rpc('increment_member_shifts', { member_uuid: member.id });
  return data;
}

async function cancelSignup(shiftId) {
  const member = await getCurrentMember();

  const { error } = await supabase
    .from('signups')
    .update({ status: 'cancelled' })
    .eq('shift_id', shiftId)
    .eq('member_id', member.id)
    .eq('status', 'active');

  if (error) throw error;

  await supabase.rpc('decrement_member_shifts', { member_uuid: member.id });
}

async function assignMember(shiftId, memberEmail) {
  // Look up the member
  const { data: member, error: memberErr } = await supabase
    .from('members')
    .select('*')
    .eq('email', memberEmail)
    .single();

  if (memberErr) throw new Error('Member not found.');

  const admin = await getCurrentMember();

  const { error } = await supabase
    .from('signups')
    .insert({
      shift_id: shiftId,
      member_id: member.id,
      member_email: member.email,
      member_name: member.display_name,
      assigned_by: admin.id
    });

  if (error) {
    if (error.code === '23505') throw new Error(member.display_name + ' is already assigned.');
    throw error;
  }

  await supabase.rpc('increment_member_shifts', { member_uuid: member.id });
}

async function getMySignups() {
  const member = await getCurrentMember();
  if (!member) return [];

  const today = formatDateISO(new Date());

  const { data, error } = await supabase
    .from('signups')
    .select('*, shifts(*)')
    .eq('member_id', member.id)
    .eq('status', 'active')
    .gte('shifts.date', today)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data || [])
    .filter(su => su.shifts)
    .map(su => ({
      signup_id: su.id,
      shift_id: su.shift_id,
      date: su.shifts.date,
      title: su.shifts.title,
      start_time: su.shifts.start_time,
      end_time: su.shifts.end_time,
      category: su.shifts.category,
      description: su.shifts.description
    }))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

// --- Config ---

async function getConfig(key) {
  const { data } = await supabase
    .from('config')
    .select('value')
    .eq('key', key)
    .single();

  return data ? data.value : null;
}

async function validateJoinCode(code) {
  const stored = await getConfig('join_code');
  return stored && code.toUpperCase().trim() === stored.toUpperCase().trim();
}
