// Serves MSTC-program events that reached the chatbot's event pool via the
// forwarded-email inbox sweep (netlify/lib/inboxEvents.mjs), in the shape
// mstc.html's own DATA.events already uses. mstc.html fetches this on load
// and layers the results on top of its hand-maintained calendar, so a
// program:'mstc'-tagged forwarded email shows up on the visible calendar
// without anyone editing the page. The hand-maintained entries themselves
// (source:'page' in events.mjs) are not re-served here - they're already on
// the page.
export const config = {path: '/api/mstc-events'};
import {events} from '../lib/events.mjs';

const MONTH_ABBR = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

function shortTitle(title) {
  if (title.length <= 28) return title;
  return title.slice(0, 27).replace(/\s+\S*$/, '') + '…';
}

// inboxEvents has no "day"/"month" abbreviation or "cta"/"short" fields -
// those are specific to mstc.html's own card format, derived here instead.
function toPageEvent(e) {
  const [y, m, d] = e.date.split('-').map(Number);
  let day = String(d);
  if (e.endDate) {
    const [ey, em, ed] = e.endDate.split('-').map(Number);
    if (ey === y && em === m && ed !== d) day = d + '–' + ed;
  }
  return {
    day,
    month: MONTH_ABBR[m - 1],
    // dateLabel is only the start date's label for a multi-day range (the
    // sweep never captures a weekday range like mstc.html's own hand-entered
    // "Monday-Sunday, November 23-29, 2026") - an acceptable gap since
    // forwarded-email events are almost always single-day.
    date: e.dateLabel || '',
    title: e.title,
    kind: e.kind || 'Event',
    time: e.time || '',
    where: e.where || '',
    cost: '',
    desc: e.desc || '',
    // sanitizeInboxEvents always sets url:null (email links are mostly
    // tracking redirects) - fall back to the MSTC page's own calendar anchor
    // so the card never links to literal "null".
    url: e.url || e.sourceUrl || 'https://longhornlinks.com/mstc#opportunities',
    cta: 'Details',
    short: shortTitle(e.title)
  };
}

export default async function handler(req) {
  if (req.method !== 'GET') return new Response('Method not allowed', {status: 405});
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = (events.mstc || [])
    .filter(e => e.source === 'inbox' && (e.endDate || e.date) >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  return Response.json(upcoming.map(toPageEvent), {
    headers: {'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff'}
  });
}
