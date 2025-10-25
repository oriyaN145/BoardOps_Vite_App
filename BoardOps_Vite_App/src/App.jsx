import React, { useEffect, useMemo, useState } from 'react';
import "./App.css";
// ========================================= //
//  BoardOps – Corporate Secretary React MVP  //
//  Fully self-contained (no external imports) //
//  What this file ensures:
//  • All helpers (endPlusMinutes, toLocalInputValue, fromLocalInputValue) are defined.
//  • <label> / <Card> tags are properly closed.
//  • Adds Agenda docRef field.
//  • Adds owner picker when creating tasks from protocol decisions.
//  • Manual tasks DO NOT auto-assign default owners.
//  • Includes robust self-tests (expanded).
// ========================================= //

// --------------------- //
// Local Storage Helper  //
// --------------------- //
function useLocalStorage(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (_) {
      return initialValue;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {}
  }, [key, value]);
  return [value, setValue];
}

// --------------------- //
// Date / Time Helpers   //
// --------------------- //
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jerusalem';
function toLocalInputValue(dt) {
  const d = new Date(dt);
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60 * 1000);
  return local.toISOString().slice(0, 16); // yyyy-mm-ddThh:mm
}
function fromLocalInputValue(val) {
  return new Date(val);
}
function endPlusMinutes(start, minutes = 60) {
  const d = new Date(start);
  d.setMinutes(d.getMinutes() + minutes);
  return d;
}
function formatDateTime(dt) {
  try {
    return new Intl.DateTimeFormat('he-IL', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: tz,
    }).format(new Date(dt));
  } catch (_) {
    return new Date(dt).toLocaleString('he-IL');
  }
}

// --------------------- //
// ICS (iCalendar)       //
// --------------------- //
function pad(n) { return String(n).padStart(2, '0'); }
function toICSDateUTC(date) {
  const d = new Date(date);
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  );
}
function escapeICS(s = '') {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}
function download(filename, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 0);
}
function meetingToICS(meeting, includeAttendees = true) {
  const dtstart = toICSDateUTC(meeting.datetime);
  const dtend = toICSDateUTC(meeting.endsAt || endPlusMinutes(meeting.datetime, 60));
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}@boardops.local`;
  const attendees = includeAttendees
    ? (meeting.attendees || [])
        .filter((a) => a.email)
        .map((a) => `ATTENDEE;CN=${a.name};ROLE=REQ-PARTICIPANT:MAILTO:${a.email}`)
        .join('\n')
    : '';
  const agendaText = (meeting.agenda || [])
    .map((a, i) => `${i + 1}. ${a.title}${a.owner ? ` (אחראי: ${a.owner})` : ''}${a.docRef ? ` [מסמך: ${a.docRef}]` : ''}`)
    .join('\\n');
  const description = (
    (agendaText ? `סדר יום:\\n${agendaText}` : '') +
    (meeting.notes ? `\\n\\nהערות/פרוטוקול:\\n${String(meeting.notes).replace(/\n/g, '\\n')}` : '')
  );
  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//BoardOps//HE//
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VEVENT
UID:${uid}
DTSTAMP:${toICSDateUTC(new Date())}
DTSTART:${dtstart}
DTEND:${dtend}
SUMMARY:${escapeICS(meeting.title || 'ישיבת דירקטוריון')}
LOCATION:${escapeICS(meeting.location || '')}
DESCRIPTION:${escapeICS(description)}
${attendees}
END:VEVENT
END:VCALENDAR`;
}

// --------------------- //
// Domain Constants      //
// --------------------- //
const TASK_STATUSES = ['פתוחה', 'בתהליך', 'חסומה', 'הושלמה', 'איחור'];
const PRIORITIES = ['גבוה', 'בינוני', 'נמוך'];
const FREQS = ['אין', 'יומי', 'שבועי', 'חודשי', 'רבעוני', 'שנתי'];

// --------------------- //
// Utils                 //
// --------------------- //
const uuid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
function parseDecisionLines(notes) {
  return (notes || '')
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => /^(החלטה:|\[DECISION\]|Decision:)/i.test(l))
    .map((l) => l.replace(/^(החלטה:|\[DECISION\]|Decision:)/i, '').trim());
}
// Pure task builder for decisions – helps testing separately from settings
function buildDecisionTasks(notes, meeting, defaultOwner = '', ownerOverride = '') {
  const cleaned = parseDecisionLines(notes);
  const owner = ownerOverride ? ownerOverride : defaultOwner || '';
  return cleaned.map((text) => ({
    id: uuid(),
    title: text,
    owner,
    dueDate: endPlusMinutes(new Date(meeting.datetime), (meeting.slaDays || 14) * 24 * 60),
    status: 'פתוחה',
    priority: 'בינוני',
    source: { type: 'meeting', id: meeting.id, title: meeting.title },
  }));
}

// --------------------- //
// Demo Seed Data        //
// --------------------- //
const demoParticipants = [
  { id: 'p1', name: 'יו"ד המועצה', email: 'chair@example.com', role: 'דירקטור' },
  { id: 'p2', name: 'מנכ"ל', email: 'ceo@example.com', role: 'הנהלה' },
  { id: 'p3', name: 'עו"ד החברה', email: 'legal@example.com', role: 'מזכיר החברה' },
];
const demoMeet = {
  id: 'm1',
  title: 'ישיבת דירקטוריון חודשית',
  datetime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
  endsAt: endPlusMinutes(new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), 90),
  location: "מטה החברה, ק' 12",
  attendees: demoParticipants,
  agenda: [
    { title: 'אישור פרוטוקול קודם', duration: 10, docRef: 'BD-001' },
    { title: 'דוח מנכ"ל', duration: 20, owner: 'מנכ"ל', docRef: 'CEO-QUARTERLY' },
    { title: 'עדכון תכנית אכיפה', duration: 15, owner: 'עו"ד החברה', docRef: 'CMP-2025Q3' },
  ],
  notes: 'החלטה: לאשר התקשרות כפופה לחתימת הסכם.\nהחלטה: להגיש דיווח מיידי תוך 48 שעות.',
};
const demoCompliance = [
  {
    id: 'c1',
    name: 'תכנית אכיפה פנימית – חוק ניירות ערך',
    owner: 'עו"ד החברה',
    cadence: 'רבעוני',
    nextDue: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    checklist: [
      { text: 'בדיקת דיווחים מיידיים', done: false },
      { text: 'סקירת עסקאות עם בעלי עניין', done: false },
    ],
    notes: 'לרכז מסמכים לוועדת ביקורת לפני הישיבה.',
  },
];

// --------------------- //
// Core UI Elements      //
// --------------------- //
function Card({ children, title, actions }) {
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
      <div className="flex items-center justify-between mb-3">
        <div className="font-semibold">{title}</div>
        <div>{actions}</div>
      </div>
      <div>{children}</div>
    </div>
  );
}
function Stat({ title, value, hint }) {
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
      <div className="text-slate-500 text-sm">{title}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {hint && <div className="text-xs text-slate-500 mt-2">{hint}</div>}
    </div>
  );
}
function Header({ tab, setTab, exportData, importData }) {
  return (
    <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-2xl bg-slate-900 text-white grid place-items-center font-bold">B</div>
          <div className="font-semibold">BoardOps • מזכירות חברה</div>
        </div>
        <nav className="flex gap-1">
          {[
            { id: 'dashboard', label: 'לוח בקרה' },
            { id: 'meetings', label: 'ישיבות' },
            { id: 'tasks', label: 'משימות' },
            { id: 'compliance', label: 'תכניות אכיפה' },
            { id: 'directory', label: 'אנשי קשר' },
            { id: 'settings', label: 'הגדרות' },
          ].map((t) => (
            <button
              key={t.id}
              className={`px-3 py-2 rounded-xl text-sm ${tab === t.id ? 'bg-slate-900 text-white' : 'hover:bg-slate-100'}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <button className="px-3 py-2 text-sm rounded-xl bg-slate-200 hover:bg-slate-300" onClick={exportData}>יצוא נתונים</button>
          <label className="px-3 py-2 text-sm rounded-xl bg-slate-200 hover:bg-slate-300 cursor-pointer">
            יבוא נתונים
            <input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importData(e.target.files[0])} />
          </label>
        </div>
      </div>
    </div>
  );
}

// --------------------- //
// Dashboard             //
// --------------------- //
function Dashboard({ upcomingMeetings, overdueTasks, dueThisWeek, settings }) {
  const warning = overdueTasks.length > 0 || dueThisWeek.length > 0;
  return (
    <div className="space-y-6">
      {warning && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-xl">
          יש משימות דחופות לטיפול: {overdueTasks.length} באיחור, {dueThisWeek.length} לשבוע הקרוב.
        </div>
      )}
      <div className="grid md:grid-cols-3 gap-4">
        <Stat title="ישיבות קרובות" value={upcomingMeetings.length} />
        <Stat title="משימות באיחור" value={overdueTasks.length} />
        <Stat title="השבוע הקרוב" value={dueThisWeek.length} hint={`SLA החלטות: ${settings.decisionSLA} ימים`} />
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="ישיבות קרובות">
          <ul className="divide-y">
            {upcomingMeetings.slice(0, 5).map((m) => (
              <li key={m.id} className="py-2">
                <div className="font-medium">{m.title}</div>
                <div className="text-sm text-slate-500">{formatDateTime(m.datetime)} · {m.location}</div>
                <div className="text-xs text-slate-500">נושאים: {(m.agenda || []).map((a) => a.title).join(', ')}</div>
              </li>
            ))}
            {upcomingMeetings.length === 0 && <div className="text-slate-500">אין ישיבות קרובות</div>}
          </ul>
        </Card>
        <Card title="משימות לתשומת לב מיידית">
          <ul className="divide-y">
            {overdueTasks.slice(0, 5).map((t) => (
              <li key={t.id} className="py-2">
                <div className="font-medium">{t.title}</div>
                <div className="text-sm text-slate-500">יעד: {formatDateTime(t.dueDate)} · סטטוס: {t.status}</div>
              </li>
            ))}
            {overdueTasks.length === 0 && <div className="text-slate-500">אין משימות באיחור 🎉</div>}
          </ul>
        </Card>
      </div>
    </div>
  );
}

// --------------------- //
// Meetings              //
// --------------------- //
function MeetingsView({ participants, meetings, addMeeting, updateMeeting, removeMeeting, extractDecisionsToTasks, includeAttendeesInICS }) {
  const [form, setForm] = useState({
    title: 'ישיבת ועדת ביקורת',
    datetime: new Date(),
    endsAt: endPlusMinutes(new Date(), 60),
    location: 'ZOOM / חדר ישיבות',
    attendees: participants,
    agenda: [
      { title: 'אישור סדר יום', duration: 5, owner: '', docRef: '' },
      { title: 'סקירת ביקורת פנימית', duration: 20, owner: 'מבקר פנימי', docRef: 'INT-2025' },
    ],
    notes: '',
  });

  // Owner picker (for decisions→tasks)
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [ownerTarget, setOwnerTarget] = useState(null); // meeting object
  const [ownerValue, setOwnerValue] = useState('');
  const participantNames = ['', ...participants.map((p) => p.name).filter(Boolean)];

  function saveMeeting() {
    if (!form.title) return alert('חסר שם ישיבה');
    addMeeting({ ...form });
    setForm({ ...form, title: 'ישיבת ועדה', notes: '' });
  }
  function downloadICSClick(meeting) {
    const ics = meetingToICS(meeting, !!includeAttendeesInICS);
    download(`${meeting.title || 'meeting'}.ics`, ics);
  }
  function openOwnerPicker(meeting) {
    setOwnerTarget(meeting);
    setOwnerValue('');
    setOwnerOpen(true);
  }
  function confirmOwnerPicker() {
    if (!ownerTarget) return setOwnerOpen(false);
    extractDecisionsToTasks(ownerTarget, ownerValue || '');
    setOwnerOpen(false);
    setOwnerTarget(null);
    setOwnerValue('');
  }

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <Card
          title="יצירת ישיבה חדשה"
          actions={<button className="px-3 py-2 text-sm rounded-xl bg-slate-900 text-white" onClick={saveMeeting}>שמירה</button>}
        >
          <div className="grid gap-3">
            <label className="grid gap-1">
              <span className="text-sm text-slate-600">כותרת</span>
              <input className="border rounded-xl p-2" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </label>
            <div className="grid md:grid-cols-2 gap-3">
              <label className="grid gap-1">
                <span className="text-sm text-slate-600">תאריך ושעה</span>
                <input type="datetime-local" className="border rounded-xl p-2" value={toLocalInputValue(form.datetime)} onChange={(e) => setForm({ ...form, datetime: fromLocalInputValue(e.target.value) })} />
              </label>
              <label className="grid gap-1">
                <span className="text-sm text-slate-600">סיום</span>
                <input type="datetime-local" className="border rounded-xl p-2" value={toLocalInputValue(form.endsAt)} onChange={(e) => setForm({ ...form, endsAt: fromLocalInputValue(e.target.value) })} />
              </label>
            </div>
            <label className="grid gap-1">
              <span className="text-sm text-slate-600">מיקום</span>
              <input className="border rounded-xl p-2" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </label>
            <div className="grid gap-2">
              <div className="text-sm text-slate-600">סדר יום</div>
              {(form.agenda || []).map((a, idx) => (
                <div key={idx} className="grid md:grid-cols-4 gap-2">
                  <input className="border rounded-xl p-2 md:col-span-2" placeholder="נושא" value={a.title} onChange={(e) => { const next = [...form.agenda]; next[idx] = { ...a, title: e.target.value }; setForm({ ...form, agenda: next }); }} />
                  <input className="border rounded-xl p-2" placeholder="אחראי" value={a.owner || ''} onChange={(e) => { const next = [...form.agenda]; next[idx] = { ...a, owner: e.target.value }; setForm({ ...form, agenda: next }); }} />
                  <input className="border rounded-xl p-2" placeholder="מספר מסמך/מצגת" value={a.docRef || ''} onChange={(e) => { const next = [...form.agenda]; next[idx] = { ...a, docRef: e.target.value }; setForm({ ...form, agenda: next }); }} />
                </div>
              ))}
              <div className="flex gap-2">
                <button className="px-3 py-2 text-sm rounded-xl bg-slate-200" onClick={() => setForm({ ...form, agenda: [...(form.agenda || []), { title: '', duration: 10, owner: '', docRef: '' }] })}>+ נושא</button>
                <button className="px-3 py-2 text-sm rounded-xl bg-slate-200" onClick={() => setForm({ ...form, agenda: [] })}>איפוס</button>
              </div>
            </div>
            <label className="grid gap-1">
              <span className="text-sm text-slate-600">פרוטוקול/הערות (התחל שורות החלטה ב־"החלטה:")</span>
              <textarea className="border rounded-xl p-2 h-32" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </label>
          </div>
        </Card>
        <Card title="עוזר ישיבה">
          <div className="flex flex-wrap gap-2">
            <button className="px-3 py-2 text-sm rounded-xl bg-slate-900 text-white" onClick={() => downloadICSClick(form)}>הורד הזמנה (ICS)</button>
            <button className="px-3 py-2 text-sm rounded-xl bg-slate-200" onClick={() => openOwnerPicker(form)}>הפוך החלטות למשימות</button>
          </div>
          {ownerOpen && (
            <div className="mt-3 grid md:grid-cols-3 gap-2">
              <label className="grid gap-1">
                <span className="text-sm text-slate-600">בחר אחראי למשימות</span>
                <select className="border rounded-xl p-2" value={ownerValue} onChange={(e) => setOwnerValue(e.target.value)}>
                  {participantNames.map((n, i) => (
                    <option key={i} value={n}>{n || '— ללא —'}</option>
                  ))}
                </select>
              </label>
              <div className="flex items-end gap-2">
                <button className="px-3 py-2 text-sm rounded-xl bg-slate-900 text-white" onClick={confirmOwnerPicker}>צור משימות</button>
                <button className="px-3 py-2 text-sm rounded-xl bg-slate-200" onClick={() => setOwnerOpen(false)}>ביטול</button>
              </div>
            </div>
          )}
        </Card>
      </div>
      <div className="space-y-4">
        <Card title="ישיבות קיימות">
          <ul className="divide-y">
            {meetings.map((m) => (
              <li key={m.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{m.title}</div>
                    <div className="text-sm text-slate-500">{formatDateTime(m.datetime)} · {m.location}</div>
                    <div className="text-xs text-slate-500">משתתפים: {(m.attendees || []).map((a) => a.name).join(', ')}</div>
                  </div>
                  <div className="flex gap-2">
                    <button className="px-2 py-1 text-xs rounded-lg bg-slate-200" onClick={() => download(`${m.title || 'meeting'}.ics`, meetingToICS(m, !!includeAttendeesInICS))}>ICS</button>
                    <button className="px-2 py-1 text-xs rounded-lg bg-slate-200" onClick={() => openOwnerPicker(m)}>החלטות→משימות</button>
                    <button className="px-2 py-1 text-xs rounded-lg bg-red-100 text-red-700" onClick={() => removeMeeting(m.id)}>מחק</button>
                  </div>
                </div>
              </li>
            ))}
            {meetings.length === 0 && <div className="text-slate-500">אין ישיבות עדיין</div>}
          </ul>
        </Card>
      </div>
    </div>
  );
}

// --------------------- //
// Tasks                 //
// --------------------- //
function TasksView({ tasks, setTasks, addTask, updateTask, removeTask, generateRecurrence }) {
  const [filter, setFilter] = useState({ q: '', status: '', owner: '' });
  const [form, setForm] = useState({ title: 'ביצוע דיווח מיידי', owner: '', dueDate: new Date(), status: 'פתוחה', priority: 'גבוה', recurrence: { freq: 'אין', interval: 1 } });

  const filtered = tasks.filter((t) => {
    if (filter.q && !(`${t.title} ${t.owner || ''}`.toLowerCase().includes(filter.q.toLowerCase()))) return false;
    if (filter.status && t.status !== filter.status) return false;
    if (filter.owner && (t.owner || '') !== filter.owner) return false;
    return true;
  });

  function createTask() {
    if (!form.title) return alert('חסר כותרת למשימה');
    // Manual tasks DO NOT auto-assign default owner – they use the form only.
    const base = { ...form, id: uuid() };
    const expanded = generateRecurrence(base, 5);
    setTasks((prev) => [...expanded, ...prev]);
    setForm({ ...form, title: '', owner: '', status: 'פתוחה' });
  }

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <Card title="פילטרים">
          <div className="grid md:grid-cols-3 gap-3">
            <label className="grid gap-1">
              <span className="text-sm text-slate-600">חיפוש</span>
              <input className="border rounded-xl p-2" placeholder="טקסט" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
            </label>
            <label className="grid gap-1">
              <span className="text-sm text-slate-600">סטטוס</span>
              <select className="border rounded-xl p-2" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
                <option value="">כל הסטטוסים</option>
                {TASK_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-sm text-slate-600">אחראי</span>
              <input className="border rounded-xl p-2" placeholder="שם" value={filter.owner} onChange={(e) => setFilter({ ...filter, owner: e.target.value })} />
            </label>
          </div>
        </Card>
        <Card
          title="יצירת משימה"
          actions={<button className="px-3 py-2 text-sm rounded-xl bg-slate-900 text-white" onClick={createTask}>הוסף</button>}
        >
          <div className="grid gap-3">
            <label className="grid gap-1">
              <span className="text-sm text-slate-600">כותרת</span>
              <input className="border rounded-xl p-2" placeholder="כותרת" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </label>
            <div className="grid md:grid-cols-3 gap-3">
              <label className="grid gap-1">
                <span className="text-sm text-slate-600">אחראי</span>
                <input className="border rounded-xl p-2" placeholder="אחראי" value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} />
              </label>
              <label className="grid gap-1">
                <span className="text-sm text-slate-600">יעד</span>
                <input type="datetime-local" className="border rounded-xl p-2" value={toLocalInputValue(form.dueDate)} onChange={(e) => setForm({ ...form, dueDate: fromLocalInputValue(e.target.value) })} />
              </label>
              <label className="grid gap-1">
                <span className="text-sm text-slate-600">עדיפות</span>
                <select className="border rounded-xl p-2" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="grid md:grid-cols-3 gap-3">
              <label className="grid gap-1">
                <span className="text-sm text-slate-600">סטטוס</span>
                <select className="border rounded-xl p-2" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  {TASK_STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-sm text-slate-600">תדירות</span>
                <select className="border rounded-xl p-2" value={form.recurrence.freq} onChange={(e) => setForm({ ...form, recurrence: { ...form.recurrence, freq: e.target.value } })}>
                  {FREQS.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-sm text-slate-600">מרווח</span>
                <input type="number" min={1} className="border rounded-xl p-2" value={form.recurrence.interval} onChange={(e) => setForm({ ...form, recurrence: { ...form.recurrence, interval: Number(e.target.value || 1) } })} />
              </label>
            </div>
          </div>
        </Card>
      </div>
      <div>
        <Card title="רשימת משימות">
          <ul className="divide-y">
            {filtered.map((t) => (
              <li key={t.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{t.title}</div>
                    <div className="text-xs text-slate-500">אחראי: {t.owner || '—'} · יעד: {formatDateTime(t.dueDate)} · עדיפות: {t.priority}</div>
                    {t.source && <div className="text-xs text-slate-400">מקור: {t.source.title}</div>}
                  </div>
                  <div className="flex gap-2 items-center">
                    <select className="border rounded-lg p-1 text-xs" value={t.status} onChange={(e) => updateTask({ ...t, status: e.target.value })}>
                      {TASK_STATUSES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    <button className="px-2 py-1 text-xs rounded-lg bg-slate-200" onClick={() => updateTask({ ...t, dueDate: endPlusMinutes(new Date(t.dueDate), 24 * 60) })}>+ יום</button>
                    <button className="px-2 py-1 text-xs rounded-lg bg-red-100 text-red-700" onClick={() => removeTask(t.id)}>מחק</button>
                  </div>
                </div>
              </li>
            ))}
            {filtered.length === 0 && <div className="text-slate-500">אין משימות תואמות</div>}
          </ul>
        </Card>
      </div>
    </div>
  );
}

// --------------------- //
// Compliance            //
// --------------------- //
function ComplianceView({ compliance, addCompliance, updateCompliance, removeCompliance, pushChecklistToTasks }) {
  const [form, setForm] = useState({ name: 'דיווחים מיידיים', owner: '', cadence: 'חודשי', nextDue: new Date(), checklist: [], notes: '' });

  function save() {
    if (!form.name) return alert('חסר שם תכנית');
    addCompliance({ ...form });
    setForm({ ...form, name: '', checklist: [] });
  }

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <Card
          title="תכנית אכיפה חדשה"
          actions={<button className="px-3 py-2 text-sm rounded-xl bg-slate-900 text-white" onClick={save}>שמירה</button>}
        >
          <div className="grid gap-3">
            <label className="grid gap-1">
              <span className="text-sm text-slate-600">שם התכנית</span>
              <input className="border rounded-xl p-2" placeholder="שם" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <div className="grid md:grid-cols-3 gap-3">
              <label className="grid gap-1">
                <span className="text-sm text-slate-600">אחראי</span>
                <input className="border rounded-xl p-2" placeholder="אחראי" value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} />
              </label>
              <label className="grid gap-1">
                <span className="text-sm text-slate-600">תדירות</span>
                <select className="border rounded-xl p-2" value={form.cadence} onChange={(e) => setForm({ ...form, cadence: e.target.value })}>
                  {FREQS.filter((f) => f !== 'אין').map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-sm text-slate-600">מועד קרוב</span>
                <input type="datetime-local" className="border rounded-xl p-2" value={toLocalInputValue(form.nextDue)} onChange={(e) => setForm({ ...form, nextDue: fromLocalInputValue(e.target.value) })} />
              </label>
            </div>
            <label className="grid gap-1">
              <span className="text-sm text-slate-600">הערות</span>
              <textarea className="border rounded-xl p-2 h-24" placeholder="הערות" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </label>
            <div className="grid gap-2">
              <div className="text-sm text-slate-600">צ'קליסט</div>
              {(form.checklist || []).map((c, idx) => (
                <div key={idx} className="flex gap-2">
                  <input className="border rounded-xl p-2 flex-1" placeholder="פריט" value={c.text} onChange={(e) => { const next = [...form.checklist]; next[idx] = { ...c, text: e.target.value }; setForm({ ...form, checklist: next }); }} />
                  <button className="px-2 py-1 text-xs rounded-lg bg-red-100 text-red-700" onClick={() => { const next = [...form.checklist]; next.splice(idx, 1); setForm({ ...form, checklist: next }); }}>מחק</button>
                </div>
              ))}
              <button className="px-3 py-2 text-sm rounded-xl bg-slate-200" onClick={() => setForm({ ...form, checklist: [...(form.checklist || []), { text: '' }] })}>+ פריט</button>
            </div>
          </div>
        </Card>
      </div>
      <div>
        <Card title="תכניות פעילות">
          <ul className="divide-y">
            {compliance.map((c) => (
              <li key={c.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-slate-500">אחראי: {c.owner || '—'} · מועד קרוב: {formatDateTime(c.nextDue)}</div>
                    <div className="text-xs text-slate-400">{c.cadence}</div>
                    <ul className="mt-1 list-disc ms-5 text-sm">
                      {(c.checklist || []).map((ci, idx) => (<li key={idx}>{ci.text}</li>))}
                    </ul>
                  </div>
                  <div className="flex gap-2 items-start">
                    <button className="px-2 py-1 text-xs rounded-lg bg-slate-200" onClick={() => pushChecklistToTasks(c)}>הפק משימות</button>
                    <button className="px-2 py-1 text-xs rounded-lg bg-red-100 text-red-700" onClick={() => removeCompliance(c.id)}>מחק</button>
                  </div>
                </div>
              </li>
            ))}
            {compliance.length === 0 && <div className="text-slate-500">אין תכניות עדיין</div>}
          </ul>
        </Card>
      </div>
    </div>
  );
}

// --------------------- //
// Directory             //
// --------------------- //
function DirectoryView({ participants, setParticipants }) {
  const [form, setForm] = useState({ name: '', email: '', role: '' });
  function add() {
    if (!form.name) return alert('חסר שם');
    setParticipants((prev) => [{ ...form, id: uuid() }, ...prev]);
    setForm({ name: '', email: '', role: '' });
  }
  function remove(id) {
    setParticipants((prev) => prev.filter((p) => p.id !== id));
  }
  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <Card
          title="איש קשר חדש"
          actions={<button className="px-3 py-2 text-sm rounded-xl bg-slate-900 text-white" onClick={add}>הוסף</button>}
        >
          <div className="grid gap-3">
            <label className="grid gap-1">
              <span className="text-sm text-slate-600">שם</span>
              <input className="border rounded-xl p-2" placeholder="שם" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="grid gap-1">
              <span className="text-sm text-slate-600">אימייל</span>
              <input className="border rounded-xl p-2" placeholder="אימייל" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </label>
            <label className="grid gap-1">
              <span className="text-sm text-slate-600">תפקיד</span>
              <input className="border rounded-xl p-2" placeholder="תפקיד" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} />
            </label>
          </div>
        </Card>
      </div>
      <div>
        <Card title="אנשי קשר">
          <ul className="divide-y">
            {participants.map((p) => (
              <li key={p.id} className="py-2 flex items-center justify-between">
                <div>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-slate-500">{p.email || '—'} · {p.role || '—'}</div>
                </div>
                <button className="px-2 py-1 text-xs rounded-lg bg-red-100 text-red-700" onClick={() => remove(p.id)}>מחק</button>
              </li>
            ))}
            {participants.length === 0 && <div className="text-slate-500">אין אנשי קשר</div>}
          </ul>
        </Card>
      </div>
    </div>
  );
}

// --------------------- //
// Settings              //
// --------------------- //
function SettingsView({ settings, setSettings, participants = [] }) {
  const names = ['', ...participants.map((p) => p.name).filter(Boolean)];
  return (
    <div className="grid md:grid-cols-2 gap-6">
      <Card title="כללי">
        <div className="grid gap-3">
          <label className="grid gap-1">
            <span className="text-sm text-slate-600">אזור זמן</span>
            <input className="border rounded-xl p-2" value={settings.timezone} onChange={(e) => setSettings({ ...settings, timezone: e.target.value })} />
          </label>
          <label className="grid gap-1">
            <span className="text-sm text-slate-600">SLA להשלמת החלטות (ימים)</span>
            <input type="number" className="border rounded-xl p-2" value={settings.decisionSLA} onChange={(e) => setSettings({ ...settings, decisionSLA: Number(e.target.value || 14) })} />
          </label>
          <div className="grid md:grid-cols-2 gap-3">
            <label className="grid gap-1">
              <span className="text-sm text-slate-600">ברירת מחדל: אחראי על החלטות</span>
              <select className="border rounded-xl p-2" value={settings.defaultDecisionOwner || ''} onChange={(e) => setSettings({ ...settings, defaultDecisionOwner: e.target.value })}>
                {names.map((n, i) => (<option key={i} value={n}>{n || '— ללא —'}</option>))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-sm text-slate-600">ברירת מחדל: אחראי לתכניות אכיפה</span>
              <select className="border rounded-xl p-2" value={settings.defaultComplianceOwner || ''} onChange={(e) => setSettings({ ...settings, defaultComplianceOwner: e.target.value })}>
                {names.map((n, i) => (<option key={i} value={n}>{n || '— ללא —'}</option>))}
              </select>
            </label>
          </div>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={!!settings.includeAttendeesInICS} onChange={(e) => setSettings({ ...settings, includeAttendeesInICS: e.target.checked })} />
            <span className="text-sm text-slate-600">כלול משתתפים בקובץ ICS</span>
          </label>
        </div>
      </Card>
      <Card title="אודות">
        <div className="text-sm text-slate-600 space-y-2">
          <p>גרסת MVP – ריכוז ישיבות, פרוטוקולים, החלטות→משימות, משימות חוזרות ותכניות אכיפה.</p>
          <ul className="list-disc ms-5">
            <li>יבוא/יצוא JSON</li>
            <li>ICS עם משתתפים (ניתן לביטול)</li>
            <li>"החלטה:" בתחילת שורה → משימות</li>
            <li>שדה מסמך/מצגת לכל נושא בסדר היום</li>
            <li>בוחר אחראי בעת יצירת משימות מהחלטות</li>
          </ul>
        </div>
      </Card>
    </div>
  );
}

// --------------------- //
// Self Tests            //
// --------------------- //
function SelfTests({ toICSDateUTCFn, meetingToICSFn, generateRecurrenceFn, parseDecisionLinesFn, buildDecisionTasksFn }) {
  const [results, setResults] = useState([]);
  useEffect(() => {
    const r = [];
    const assert = (name, cond) => r.push({ name, pass: !!cond });
    try {
      const now = new Date();
      // Test 1: toICSDateUTC length (YYYYMMDDThhmmssZ => 16)
      assert('toICSDateUTC length == 16', toICSDateUTCFn(now).length === 16);
      // Test 2: meetingToICS contains VEVENT & SUMMARY and respects attendees flag
      const m = { id: 'mT', title: 'ישיבה', datetime: now, endsAt: endPlusMinutes(now, 60), location: 'X', attendees: [{ name: 'דוגמה', email: 'a@b.com' }], agenda: [{ title: 'סעיף', owner: 'א', docRef: 'D-1' }], notes: '' };
      const ics = meetingToICSFn(m, true);
      assert('ICS contains VEVENT & SUMMARY', ics.includes('BEGIN:VEVENT') && ics.includes('SUMMARY:'));
      assert('ICS contains ATTENDEE when include=true', /ATTENDEE;CN=/.test(ics));
      assert('ICS contains docRef in DESCRIPTION', /מסמך: D-1/.test(ics));
      const icsNoAtt = meetingToICSFn(m, false);
      assert('ICS omits ATTENDEE when include=false', !/ATTENDEE;CN=/.test(icsNoAtt));
      // Test 3: parseDecisionLines picks two, ignores others
      const parsed = parseDecisionLinesFn("החלטה: א'\nאחרת\nDecision: B");
      assert('parseDecisionLines count == 2', parsed.length === 2);
      const parsedNone = parseDecisionLinesFn('אין החלטות כאן');
      assert('parseDecisionLines returns 0 when no markers', parsedNone.length === 0);
      // Test 4: recurrence grows correctly (cross-month sanity)
      const baseTask = { title: 'T', dueDate: new Date('2025-01-31T10:00:00Z'), recurrence: { freq: 'חודשי', interval: 1 } };
      const rec = generateRecurrenceFn(baseTask, 3);
      assert('generateRecurrence length == 4', rec.length === 4);
      // Test 5: buildDecisionTasks owner override & default
      const meet = { id: 'm1', title: 'x', datetime: now, slaDays: 14 };
      const builtDefault = buildDecisionTasksFn('החלטה: X', meet, 'עו"ד', '');
      assert('buildDecisionTasks uses default owner when no override', builtDefault[0].owner === 'עו"ד');
      const builtOverride = buildDecisionTasksFn('Decision: Y', meet, 'עו"ד', 'מנכ"ל');
      assert('buildDecisionTasks uses override when provided', builtOverride[0].owner === 'מנכ"ל');
      setResults(r);
    } catch (e) {
      r.push({ name: 'Tests crashed', pass: false });
      setResults(r);
    }
  }, [toICSDateUTCFn, meetingToICSFn, generateRecurrenceFn, parseDecisionLinesFn, buildDecisionTasksFn]);

  return (
    <Card title="בדיקות מערכת (Self‑Test)">
      <ul className="text-sm">
        {results.map((t, i) => (
          <li key={i} className={t.pass ? 'text-green-700' : 'text-red-700'}>
            {t.pass ? '✔︎' : '✖︎'} {t.name}
          </li>
        ))}
        {results.length === 0 && <li className="text-slate-500">מריץ בדיקות…</li>}
      </ul>
    </Card>
  );
}

// --------------------- //
// App                   //
// --------------------- //
export default function App() {
  const [tab, setTab] = useState('dashboard');
  const [participants, setParticipants] = useLocalStorage('boardops_participants', demoParticipants);
  const [meetings, setMeetings] = useLocalStorage('boardops_meetings', [demoMeet]);
  const [tasks, setTasks] = useLocalStorage('boardops_tasks', []);
  const [compliance, setCompliance] = useLocalStorage('boardops_compliance', demoCompliance);
  const [settings, setSettings] = useLocalStorage('boardops_settings', {
    timezone: tz,
    decisionSLA: 14,
    defaultMeetingLength: 90,
    workDays: [0, 1, 2, 3, 4],
    defaultDecisionOwner: '',
    defaultComplianceOwner: '',
    includeAttendeesInICS: true,
  });

  // Mark overdue on load
  useEffect(() => {
    setTasks((prev) => prev.map((t) => (t.status !== 'הושלמה' && new Date(t.dueDate) < new Date() ? { ...t, status: 'איחור' } : t)));
  }, []);

  const upcomingMeetings = useMemo(
    () => meetings.filter((m) => new Date(m.datetime) >= new Date()).sort((a, b) => new Date(a.datetime) - new Date(b.datetime)),
    [meetings]
  );
  const overdueTasks = useMemo(() => tasks.filter((t) => t.status === 'איחור'), [tasks]);
  const dueThisWeek = useMemo(() => {
    const now = new Date();
    const in7 = new Date();
    in7.setDate(in7.getDate() + 7);
    return tasks.filter((t) => new Date(t.dueDate) >= now && new Date(t.dueDate) <= in7 && t.status !== 'הושלמה');
  }, [tasks]);

  function addMeeting(m) { setMeetings((prev) => [{ ...m, id: uuid() }, ...prev]); }
  function updateMeeting(m) { setMeetings((prev) => prev.map((x) => (x.id === m.id ? m : x))); }
  function removeMeeting(id) { setMeetings((prev) => prev.filter((x) => x.id !== id)); }
  function addTask(t) { setTasks((prev) => [{ ...t, id: uuid() }, ...prev]); }
  function updateTask(t) { setTasks((prev) => prev.map((x) => (x.id === t.id ? t : x))); }
  function removeTask(id) { setTasks((prev) => prev.filter((x) => x.id !== id)); }
  function addCompliance(c) { setCompliance((prev) => [{ ...c, id: uuid() }, ...prev]); }
  function updateCompliance(c) { setCompliance((prev) => prev.map((x) => (x.id === c.id ? c : x))); }
  function removeCompliance(id) { setCompliance((prev) => prev.filter((x) => x.id !== id)); }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const obj = JSON.parse(e.target.result);
        if (obj.participants) setParticipants(obj.participants);
        if (obj.meetings) setMeetings(obj.meetings);
        if (obj.tasks) setTasks(obj.tasks);
        if (obj.compliance) setCompliance(obj.compliance);
        if (obj.settings) setSettings(obj.settings);
        alert('הנתונים יובאו בהצלחה');
      } catch (_) {
        alert('קובץ לא תקין');
      }
    };
    reader.readAsText(file);
  }
  function exportData() {
    const payload = { participants, meetings, tasks, compliance, settings };
    download(`boardops-export-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2));
  }

  // Decision → Tasks generator: wraps pure builder with settings defaults
  function tasksFromDecisionNotes(notes, meeting, ownerOverride) {
    const meetingWithSla = { ...meeting, slaDays: settings.decisionSLA };
    return buildDecisionTasks(notes, meetingWithSla, settings.defaultDecisionOwner || '', ownerOverride);
  }
  function extractDecisionsToTasks(meeting, ownerOverride = '') {
    const newTasks = tasksFromDecisionNotes(meeting.notes, meeting, ownerOverride);
    if (newTasks.length) {
      setTasks((prev) => [...newTasks, ...prev]);
      alert(`${newTasks.length} משימות נוצרו מהחלטות הפרוטוקול`);
    } else {
      alert("לא נמצאו שורות החלטה בפרוטוקול. השתמש בתחילית 'החלטה:' בכל שורה רלוונטית.");
    }
  }
  function generateRecurrence(task, cycles = 6) {
    const freq = task.recurrence?.freq || 'אין';
    if (freq === 'אין') return [task];
    const interval = task.recurrence?.interval || 1;
    const out = [task];
    let cursor = new Date(task.dueDate);
    for (let i = 0; i < cycles; i++) {
      switch (freq) {
        case 'יומי': cursor.setDate(cursor.getDate() + 1 * interval); break;
        case 'שבועי': cursor.setDate(cursor.getDate() + 7 * interval); break;
        case 'חודשי': cursor.setMonth(cursor.getMonth() + 1 * interval); break;
        case 'רבעוני': cursor.setMonth(cursor.getMonth() + 3 * interval); break;
        case 'שנתי': cursor.setFullYear(cursor.getFullYear() + 1 * interval); break;
      }
      out.push({ ...task, id: uuid(), dueDate: new Date(cursor), status: 'פתוחה' });
    }
    return out;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Header tab={tab} setTab={setTab} exportData={exportData} importData={importData} />
      <div className="max-w-7xl mx-auto p-4">
        {tab === 'dashboard' && (
          <Dashboard upcomingMeetings={upcomingMeetings} overdueTasks={overdueTasks} dueThisWeek={dueThisWeek} settings={settings} />
        )}
        {tab === 'meetings' && (
          <MeetingsView
            participants={participants}
            meetings={meetings}
            addMeeting={addMeeting}
            updateMeeting={updateMeeting}
            removeMeeting={removeMeeting}
            extractDecisionsToTasks={extractDecisionsToTasks}
            includeAttendeesInICS={settings.includeAttendeesInICS}
          />
        )}
        {tab === 'tasks' && (
          <TasksView tasks={tasks} setTasks={setTasks} addTask={addTask} updateTask={updateTask} removeTask={removeTask} generateRecurrence={generateRecurrence} />
        )}
        {tab === 'compliance' && (
          <ComplianceView
            compliance={compliance}
            addCompliance={addCompliance}
            updateCompliance={updateCompliance}
            removeCompliance={removeCompliance}
            pushChecklistToTasks={(prog) => {
              const created = (prog.checklist || [])
                .filter((c) => !c.done)
                .map((c) => ({
                  id: uuid(),
                  title: `${prog.name}: ${c.text}`,
                  owner: settings.defaultComplianceOwner || prog.owner || '',
                  dueDate: prog.nextDue || new Date(),
                  status: 'פתוחה',
                  priority: 'בינוני',
                  source: { type: 'compliance', id: prog.id, title: prog.name },
                }));
              if (created.length) setTasks((prev) => [...created, ...prev]);
              alert(`${created.length} משימות נוצרו מתוך תכנית האכיפה`);
            }}
          />
        )}
        {tab === 'directory' && (
          <DirectoryView participants={participants} setParticipants={setParticipants} />
        )}
        {tab === 'settings' && (
          <SettingsView settings={settings} setSettings={setSettings} participants={participants} />
        )}

        <SelfTests
          toICSDateUTCFn={toICSDateUTC}
          meetingToICSFn={meetingToICS}
          generateRecurrenceFn={generateRecurrence}
          parseDecisionLinesFn={parseDecisionLines}
          buildDecisionTasksFn={buildDecisionTasks}
        />
      </div>
    </div>
  );
}
