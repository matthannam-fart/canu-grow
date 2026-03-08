import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resendKey = Deno.env.get("RESEND_API_KEY");

  // Verify authorization via a simple shared secret
  const authHeader = req.headers.get("Authorization") || "";
  const expectedToken = `Bearer ${serviceKey}`;
  if (authHeader !== expectedToken) {
    // Also allow calls from pg_cron via pg_net which uses the service role key
    const cronSecret = Deno.env.get("CRON_SECRET");
    const url = new URL(req.url);
    if (cronSecret && url.searchParams.get("secret") !== cronSecret) {
      // Log for debugging
      console.log("Auth failed. Header length:", authHeader.length, "Expected length:", expectedToken.length);
      console.log("Header starts with Bearer:", authHeader.startsWith("Bearer "));
      console.log("Service key length:", serviceKey?.length);
    }
    // Allow all for now during testing - will lock down later
  }

  const db = createClient(supabaseUrl, serviceKey);

  // Get tomorrow's date
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split("T")[0];

  // Find all shifts tomorrow
  const { data: shifts, error: shiftErr } = await db
    .from("shifts")
    .select("id, title, category, date, start_time, end_time")
    .eq("date", tomorrowStr);

  if (shiftErr || !shifts || shifts.length === 0) {
    return Response.json({ message: "No shifts tomorrow", sent: 0 });
  }

  // Find all active signups for those shifts
  const { data: signups } = await db
    .from("signups")
    .select("member_email, member_name, shift_id")
    .in("shift_id", shifts.map((s) => s.id))
    .eq("status", "active");

  if (!signups || signups.length === 0) {
    return Response.json({ message: "No signups for tomorrow", sent: 0 });
  }

  // Group shifts by member email
  const memberShifts: Record<string, { name: string; shifts: typeof shifts }> = {};
  for (const signup of signups) {
    if (!memberShifts[signup.member_email]) {
      memberShifts[signup.member_email] = { name: signup.member_name || "Member", shifts: [] };
    }
    const shift = shifts.find((s) => s.id === signup.shift_id);
    if (shift) memberShifts[signup.member_email].shifts.push(shift);
  }

  const dateFormatted = new Date(tomorrowStr + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  let sentCount = 0;

  if (!resendKey) {
    return Response.json({ error: "RESEND_API_KEY not set", members: Object.keys(memberShifts).length });
  }

  for (const [email, data] of Object.entries(memberShifts)) {
    const shiftList = data.shifts
      .map((s) => {
        const start = s.start_time.substring(0, 5);
        const end = s.end_time.substring(0, 5);
        return `<li><strong>${s.title}</strong> &mdash; ${start} to ${end}</li>`;
      })
      .join("");

    const html = `
      <div style="font-family: -apple-system, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #2d5a3d; font-size: 24px; margin: 0;">CanU Grow</h1>
          <p style="color: #6b5e4e; font-size: 13px; margin: 4px 0 0;">University of Manitoba</p>
        </div>
        <p>Hi ${data.name},</p>
        <p>Friendly reminder — you're signed up for the following tomorrow (<strong>${dateFormatted}</strong>):</p>
        <ul style="margin: 16px 0; padding-left: 20px;">${shiftList}</ul>
        <p style="color: #6b5e4e; font-size: 14px; margin-top: 24px;">
          See you there! If you can't make it, please cancel your signup at
          <a href="https://canugrow.org" style="color: #2d5a3d;">canugrow.org</a>.
        </p>
      </div>
    `;

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "CanU Grow <reminders@canugrow.org>",
        to: email,
        subject: `Reminder: You have shifts tomorrow (${dateFormatted})`,
        html: html,
      }),
    });

    if (emailRes.ok) sentCount++;
    else console.error(`Failed to send to ${email}:`, await emailRes.text());
  }

  return Response.json({ sent: sentCount, total: Object.keys(memberShifts).length });
});
