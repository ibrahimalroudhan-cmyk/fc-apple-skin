// Apple skin for Full Calendar — restyles Full Calendar Remastered to look like Apple Calendar.
// Reads events only to display them; never writes calendar data. Only display options and a few extra controls are added:
//  1. Display options on each Full Calendar view: day header "Sun 25", title "October 2026", one-hour rows, 30-min default event.
//  2. Each event's colour is copied into --ev (styles.css draws tinted blocks); a location line is added.
//  3. Red time pill on the now-line.
//  4. Behaviour: single click selects, double click opens an Info card (Edit opens Full Calendar's editor), hover shows a peek.
//  5. Year view: 12 months, days shaded by how busy they are.
//  6. Sync button: runs Full Calendar's "Revalidate remote calendars".
//  7. Calendars panel (hover the left edge, or click the title icon): one toggle per calendar, "Only" = solo; coloured calendar
//     chips in the toolbar (click = only that calendar, again = all; Shift-click = hide/show). Implemented with a per-source
//     eventDataTransform; calendar data is never changed and the hidden set lives in this plugin's data.json.
//  8. Layout: how overlapping events share a day (docs/LAYOUT-RULES.md); tunables are the named constants below.
//  9. Mini calendar: Full Calendar's sidebar view drawn as a month grid with dots plus a day-grouped list.
// Re-checked every 2 s because Full Calendar rebuilds its calendar object on view/settings changes.
const { Plugin, PluginSettingTab, Setting, setIcon, Menu } = require('obsidian');
const FC_ID = 'full-calendar-remastered';   // the Full Calendar plugin this skin dresses
const DEFAULTS = { hidden: [], soloPrev: null, hijri: false, weekFromToday: false, firstDay: -1, routine: false, routineMin: 240, layered: false, chips: false, yearHeat: false };   // firstDay -1 = follow Full Calendar
let hijriOn = false;   // Islamic-calendar secondary dates (setting)
// ---------- Layout: how events share a day (rules in docs/LAYOUT-RULES.md) ----------
// Tunables: one edit each. px = screen pixels in the time grid.
const STRIP_PX = 5;               // R1  left offset per event behind, so its side strip stays visible
const STRIP_MAX_DEPTH = 6;        // R1  offsets stop growing after this many layers
const SAME_START_PX = 10;         // R2  two ordinary events starting this close stay side by side (FC's split), neither can sit "behind"
const TINY_OVERLAP_PX = 9;        // R5  an edge overlap up to this many px counts as tiny…
const TINY_OVERLAP_RATIO = 0.2;   // R5  …or up to this share of the smaller box
const MIN_BOX_PX = 15;            // R5  a box is never trimmed below this: it moves away instead
let routineOn = false, BACKDROP_MIN = 240;   // optional striped look: repeating items of at least BACKDROP_MIN minutes form the back layer (a night's sleep, a long shift)
const BOX_ALPHA = 0.8;            // R3  fill of the top box where it only covers another box
const DROP_GAP_PX = 2;            // R4b gap kept under the text behind when the top box's text drops clear
const TEXT_ALPHA = 0.3;           // R4  top box (fill + text) where it covers text behind
const FIT_STEPS = 2;              // R10 text-size steps tried before giving up (classes fcas-fit1, fcas-fit2)
const MINI_DAYS = 42;              // MINI the sidebar list spans the month grid's 6 weeks, so every day of the grid gets its dots
const MINI_DOTS = 3;               // MINI at most this many dots under a day (one per calendar colour, like Fantastical)
const overlapY = (a, b) => Math.min(a.bot, b.bot) - Math.max(a.top, b.top);
const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
function mergeRects(list) {
	const out = list.map(r => Object.assign({}, r));
	for (let i = 0; i < out.length; i++) for (let j = out.length - 1; j > i; j--) if (hit(out[i], out[j])) {
		const a = out[i], b = out[j], x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
		a.w = Math.max(a.x + a.w, b.x + b.w) - x; a.h = Math.max(a.y + a.h, b.y + b.h) - y; a.x = x; a.y = y;
		out.splice(j, 1); j = out.length;
	}
	return out;
}
// An SVG mask for a w × h element: opaque everywhere, `alpha` inside the rects (R3, R4).
function maskUrl(w, h, rects, alpha) {
	w = Math.ceil(w); h = Math.ceil(h);
	const R = mergeRects(rects.map(r => { const x = Math.max(0, Math.round(r.x)), y = Math.max(0, Math.round(r.y)); return { x, y, w: Math.min(w, Math.round(r.x + r.w)) - x, h: Math.min(h, Math.round(r.y + r.h)) - y }; }).filter(r => r.w > 0 && r.h > 0));
	if (!R.length) return '';
	const holes = R.map(r => `M${r.x} ${r.y}h${r.w}v${r.h}h${-r.w}z`).join('');
	const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}' preserveAspectRatio='none'><path fill-rule='evenodd' d='M0 0h${w}v${h}h${-w}z${holes}'/><g fill-opacity='${alpha}'>${R.map(r => `<rect x='${r.x}' y='${r.y}' width='${r.w}' height='${r.h}'/>`).join('')}</g></svg>`;
	return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
// Where the visible text and icons of a rendered event are, relative to (ox, oy); clipped to the event.
function inkRects(el, ox, oy) {
	const out = []; if (el.matches('.fcas-routine:not(.fc-event-start)')) return out;
	const er = el.getBoundingClientRect();
	const add = q => { const l = Math.max(q.left, er.left), t = Math.max(q.top, er.top), r = Math.min(q.right, er.right), b = Math.min(q.bottom, er.bottom); if (r > l && b > t) out.push({ x: l - ox, y: t - oy, w: r - l, h: b - t }); };
	const doc = el.ownerDocument, w = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT), rg = doc.createRange();
	for (let n; (n = w.nextNode());) { if (!n.nodeValue.trim()) continue; rg.selectNodeContents(n); for (const q of rg.getClientRects()) add(q); }
	el.querySelectorAll('svg').forEach(x => add(x.getBoundingClientRect()));
	return out;
}
const dayOf = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

// location → pin + short place, or video + "Online" for links / Zoom / Teams
const placeOf = loc => { const s = String(loc || '').trim(); if (!s) return null; if (/^online$/i.test(s) || /https?:\/\/|zoom\.|teams\.|meet\.google|webex/i.test(s)) return { icon: 'video', text: 'Online', url: (/(https?:\/\/\S+)/.exec(s) || [])[1] || '' }; return { icon: 'map-pin', text: s.split(/\s*[,\n]\s*/)[0] }; };

const pad = n => String(n).padStart(2, '0');
const HIJRI = 'ar-SA-u-ca-islamic-civil-nu-latn';   // civil variant of the Islamic calendar
const syncRoutine = st => { routineOn = !!st.routine; BACKDROP_MIN = Math.max(30, Number(st.routineMin) || 240); };
const hijriParts = d => {
	if (!hijriOn) return null;
	try {
		const f = new Intl.DateTimeFormat(HIJRI, { day: 'numeric', month: 'long', year: 'numeric' }).formatToParts(d);
		const g = t => f.find(x => x.type === t)?.value;
		return { day: g('day'), month: g('month'), year: g('year') };
	} catch (e) { return null; }
};
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const hm = d => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const tip = (el, text) => el.setAttribute('aria-label', String(text).split('\n').join(' · '));
// minutes of a raw Full Calendar event (single: start/end · recurring: duration "HH:MM" or startTime/endTime); null = unknown
const hhmm = s => { const m = /^(\d+):(\d+)/.exec(s || ''); return m ? +m[1] * 60 + +m[2] : null; };
function rawMinutes(r) {
	if (r.start && r.end) { const a = Date.parse(r.start), b = Date.parse(r.end); if (isFinite(a) && isFinite(b)) return (b - a) / 60000; }
	if (r.duration) { const d = typeof r.duration === 'string' ? hhmm(r.duration) : null; if (d != null) return d; }
	const p = r.extendedProps || {}, s = hhmm(r.startTime || p.startTime), e = hhmm(r.endTime || p.endTime);
	if (s != null && e != null) return e >= s ? e - s : e + 1440 - s;
	return null;
}
const longDate = d => d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

module.exports = class FcAppleSkin extends Plugin {
	onload() {
		this.settings = Object.assign({}, DEFAULTS);
		this.seen = new WeakMap();   // container -> MutationObserver
		this.year = null;            // year shown in Year view, null = off
		this.calNames = [];          // [{id,type,name,color}] in Full Calendar's source order (no credentials kept)
		this.calById = new Map();
		this.hidden = new Set();     // calendar ids switched off (Calendars panel / chips), kept in this plugin's data.json
		this.soloPrev = null;        // hidden set before a solo, restored by clicking the solo chip again
		this.loadCalNames();
		this.loadData().then(d => { this.settings = Object.assign({}, DEFAULTS, d || {}); hijriOn = !!this.settings.hijri; syncRoutine(this.settings); this.hidden = new Set(this.settings.hidden || []); this.soloPrev = Array.isArray(this.settings.soloPrev) ? new Set(this.settings.soloPrev) : null; this.reparseAll(); });
		this.addSettingTab(new SkinSettings(this.app, this));
		this.dayHeader = arg => {
			const d = arg.date, type = arg.view.type;
			const dow = d.toLocaleDateString(undefined, { weekday: 'short' });
			if (type.startsWith('dayGridMonth') || type.startsWith('multiMonth')) return { html: `<span class="fcas-dow">${dow}</span>` };
			const h = hijriParts(d);
			const hj = h ? `<span class="fcas-hijri${h.day === '1' ? ' is-first' : ''}" dir="rtl">${h.day === '1' ? h.month + ' ' : ''}${h.day}</span>` : '';
			return { html: `<span class="fcas-top"><span class="fcas-dow">${dow}</span><span class="fcas-num">${d.getDate()}</span></span>${hj}` };
		};
		this.titleFormat = { month: 'long', year: 'numeric' };
		// Display options: whole 24 h day in view, hour rows, 30-min default event.
		this.prefs = { slotDuration: '01:00:00', snapDuration: '00:15:00', expandRows: true, defaultTimedEventDuration: '00:30:00', dayMaxEvents: true, eventOrder: 'start,-duration,allDay,title' };   // dayMaxEvents: month cells end in "+N more" like Apple Calendar
		this.prefsDone = new WeakSet();
		this.app.workspace.onLayoutReady(() => this.scan());
		this.registerEvent(this.app.workspace.on('layout-change', () => this.scan()));
		// NAV 1.3.0: the toolbar's back/forward buttons follow the active leaf's history
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => { for (const v of this.views()) { const b = v.containerEl.querySelector('.ofc-calendar-container.fcas'); if (b) this.navState(b); } }));
		this.registerInterval(window.setInterval(() => this.scan(), 2000));
		// Skin a new calendar in the same frame Full Calendar builds it (no flash of the default look).
		// MutationObserver callbacks run before the browser paints; the check is cheap (a few leaves).
		this.fastScan = () => {
			for (const v of this.miniViews()) if (v.containerEl.querySelector('.ofc-calendar-container')?.fcasMiniFc !== v.fullCalendarView) { this.scan(); return; }
			for (const v of this.views()) {
				const box = v.containerEl.querySelector('.ofc-calendar-container');
				const fc = v.fullCalendarView;
				if (box && (!box.classList.contains('fcas') || box.fcasFc !== fc || (fc && !this.prefsDone.has(fc)))) { this.scan(); return; }
			}
		};
		const watch = doc => {
			if (!doc || !doc.body) return;
			const mo = new MutationObserver(this.fastScan);
			mo.observe(doc.body, { childList: true, subtree: true });
			this.register(() => mo.disconnect());
		};
		watch(document);
		this.registerEvent(this.app.workspace.on('window-open', w => watch(w.doc)));
		this.registerDomEvent(document, 'keydown', e => { if (e.key === 'Escape') this.closeInfo(); });
		this.registerDomEvent(document, 'mousedown', e => { if (this.pop && !this.pop.contains(e.target)) this.closeInfo(); }, true);
	}

	// Calendar names and colours for the chips, panel and Info card. Read from Full Calendar's in-memory settings; only id, type,
	// name and colour are kept (never credentials). Cheap enough to repeat on every scan, so a newly added calendar shows up.
	loadCalNames() {
		// Full Calendar does not expose its settings, so read the calendar list from its data file.
		// Only id / type / name / colour are kept; nothing else in that file is read into the skin.
		if (this.calBusy) return;
		this.calBusy = true;
		const path = this.app.vault.configDir + '/plugins/' + FC_ID + '/data.json';
		this.app.vault.adapter.read(path).then(txt => {
			let src = [];
			try { const j = JSON.parse(txt); if (j && Array.isArray(j.calendarSources)) src = j.calendarSources; } catch (e) { /* unreadable: no names */ }
			const next = src.map(s => ({ id: String(s.id || ''), type: s.type || '', name: s.name || '', color: (s.color || '').toLowerCase() }));
			const key = JSON.stringify(next);
			if (key === this.calKey) return;
			this.calKey = key; this.calNames = next;
			this.calById = new Map(next.map(c => [c.id, c]));
			this.reparseAll();
		}).catch(() => {}).then(() => { this.calBusy = false; });
	}


	// ---------- how each calendar's events are drawn (Full Calendar parses raw events through this; data untouched) ----------
	xform(srcId, raw) {
		if (this.hidden.has(srcId)) return false;            // false = Full Calendar skips the event (calendar switched off)
		if (!raw) return raw;
		// repeating timed items of BACKDROP_MIN+ minutes (a night's sleep, a shift) get the quieter striped "routine" look and form the back layer
		const rec = !!(raw.rrule || raw.daysOfWeek || raw.startRecur), m = rawMinutes(raw);
		if (routineOn && !raw.allDay && rec && m != null && m >= BACKDROP_MIN) return Object.assign({}, raw, { classNames: [].concat(raw.classNames || [], 'fcas-routine') });
		return raw;
	}
	hookFc(fc) {
		if (!fc || fc.__fcasHook || typeof fc.addEventSource !== 'function' || typeof fc.dispatch !== 'function') return;
		const self = this, orig = fc.addEventSource;
		fc.__fcasHook = orig;
		// Full Calendar re-adds a calendar's source on every sync: give each new source our transform
		fc.addEventSource = function (src) {
			if (src && typeof src === 'object' && !src.internalEventSource && src.id != null && !src.eventDataTransform) {
				const id = String(src.id); src = Object.assign({}, src, { eventDataTransform: r => self.xform(id, r) });
			}
			return orig.call(this, src);
		};
		this.reparse(fc);
	}
	// Re-parse sources already in the calendar (optionally only some ids) through the transform.
	reparse(fc, ids) {
		if (!fc || !fc.__fcasHook) return;
		const go = () => {
			for (const s of fc.getEventSources()) {
				const I = s.internalEventSource, id = String(s.id);
				if (!I || !Array.isArray(I.meta) || (ids && !ids.has(id))) continue;
				I.eventDataTransform = r => this.xform(id, r);
				this.receive(fc, I);
			}
		};
		try { typeof fc.batchRendering === 'function' ? fc.batchRendering(go) : go(); } catch (e) { console.warn('[fc-apple-skin] reparse', e); }
		// Full Calendar's search filter remembers each event's display and would put the old one back
		for (const v of this.views()) if (v.fullCalendarView === fc) try { v.searchHandler && v.searchHandler.clearCaches(); } catch (e) {}
	}
	// Re-run Full Calendar's own "events arrived" step for ONE source with its current raw events (same fetch id and range),
	// so only that source's events are rebuilt. (RESET_RAW_EVENTS would replace the whole store — tried 30 Oct, emptied the calendar.)
	receive(fc, I) {
		const range = I.fetchRange || (fc.getCurrentData && fc.getCurrentData().dateProfile && fc.getCurrentData().dateProfile.activeRange) || null;
		fc.dispatch({ type: 'RECEIVE_EVENTS', sourceId: I.sourceId, fetchId: I.latestFetchId, fetchRange: range, rawEvents: I.meta });
	}
	reparseAll(ids) { for (const v of this.views()) this.reparse(v.fullCalendarView, ids); for (const v of this.views()) { const b = v.containerEl.querySelector('.ofc-calendar-container'); if (b) this.paint(b); } }
	unhookFc(fc) {
		if (!fc || !fc.__fcasHook) return;
		fc.addEventSource = fc.__fcasHook; delete fc.addEventSource; delete fc.__fcasHook;   // own property gone → prototype method again
		try { fc.batchRendering(() => { for (const s of fc.getEventSources()) { const I = s.internalEventSource; if (!I || !Array.isArray(I.meta)) continue; I.eventDataTransform = null; this.receive(fc, I); } }); } catch (e) {}
	}

	// ---------- calendar visibility (panel + chips) ----------
	setHidden(next, opts) {
		const before = this.hidden; this.hidden = new Set(next);
		if (!(opts && opts.keepSolo)) this.soloPrev = null;
		const changed = new Set([...before, ...this.hidden].filter(id => before.has(id) !== this.hidden.has(id)));
		this.settings.hidden = [...this.hidden]; this.settings.soloPrev = this.soloPrev ? [...this.soloPrev] : null; this.saveData(this.settings);
		if (changed.size) this.reparseAll(changed);
		this.refreshPanels();
	}
	toggleCal(id) { const h = new Set(this.hidden); h.has(id) ? h.delete(id) : h.add(id); this.setHidden(h); }
	soloId() { const vis = this.calNames.filter(c => !this.hidden.has(c.id)); return vis.length === 1 && this.calNames.length > 1 ? vis[0].id : null; }
	solo(id) {
		if (this.soloId() === id) { const back = this.soloPrev ? new Set(this.soloPrev) : new Set(); back.delete(id); this.setHidden(back); return; }
		if (!this.soloId()) this.soloPrev = new Set(this.hidden);
		this.setHidden(this.calNames.map(c => c.id).filter(x => x !== id), { keepSolo: true });
	}
	showAll() { this.setHidden([]); }

	fd() { if (this.settings.firstDay >= 0) return this.settings.firstDay; const p = this.app.plugins && this.app.plugins.plugins && this.app.plugins.plugins[FC_ID], f = p && p.settings && p.settings.firstDay; return typeof f === 'number' ? f : 1; }
	weekToday(vt) { return vt === 'timeGridWeek' && this.settings.weekFromToday; }
	views() { return this.app.workspace.getLeavesOfType('full-calendar-view').map(l => l.view).filter(v => v && v.containerEl); }

	// Our display options (applied once per calendar object, in one batch).
	applyPrefs(fc) {
		const vt = (fc.view && fc.view.type) || fc.getOption('initialView');
		this.hookFc(fc);
		if (fc.getOption('dayHeaderContent') !== this.dayHeader) fc.setOption('dayHeaderContent', this.dayHeader);
		if (fc.getOption('defaultRangeSeparator') !== '–') fc.setOption('defaultRangeSeparator', '–');   // 09:30–10:00 as in Apple Calendar
		if (fc.getOption('titleFormat') !== this.titleFormat) fc.setOption('titleFormat', this.titleFormat);
		const ov = !!this.settings.layered; if (fc.getOption('slotEventOverlap') !== ov) fc.setOption('slotEventOverlap', ov);   // off: overlapping events sit side by side, as in Apple Calendar
		if (!this.prefsDone.has(fc)) {
			this.prefsDone.add(fc); for (const [k, val] of Object.entries(this.prefs)) fc.setOption(k, val);
			// optional: a freshly built week view opens with today in the first column (rolling 7 days)
			if (this.weekToday(vt)) { const d = new Date(); fc.setOption('firstDay', d.getDay()); fc.gotoDate(d); }
		}
		// "today first" only applies to the week view (when switched on); other views use the configured first day
		if (!this.weekToday(vt) && fc.getOption('firstDay') !== this.fd()) fc.setOption('firstDay', this.fd());
		else if (this.weekToday(vt) && fc.getOption('firstDay') !== new Date().getDay()) { fc.setOption('firstDay', new Date().getDay()); fc.gotoDate(new Date()); }
	}

	scan() {
		this.loadCalNames();
		this.scanMini();
		for (const v of this.views()) {
			const fc = v.fullCalendarView;
			const box = v.containerEl.querySelector('.ofc-calendar-container');
			if (!box) continue;
			v.containerEl.classList.add('fcas-leaf');
			const fresh = !box.classList.contains('fcas');
			box.classList.add('fcas');
			box.fcasFc = fc;
			box.fcasView = v;
			this.ensurePanel(v, box);
			if (fresh && fc && typeof fc.updateSize === 'function') requestAnimationFrame(() => { try { fc.updateSize(); } catch (e) {} });
			if (fc && typeof fc.setOption === 'function') {
				try {
					// every setOption/gotoDate re-renders the whole grid; apply them in one batch (one render)
					const run = f => (typeof fc.batchRendering === 'function' ? fc.batchRendering(f) : f());
					run(() => this.applyPrefs(fc));
				} catch (e) { console.warn('[fc-apple-skin]', e); }
			}
			if (!this.seen.has(box)) {
				let queued = false;
				const mo = new MutationObserver(() => {
					if (queued) return; queued = true;
					requestAnimationFrame(() => { queued = false; this.paint(box); });
				});
				mo.observe(box, { childList: true, subtree: true });
				this.seen.set(box, mo);
				this.register(() => mo.disconnect());
				this.wire(box);
			}
			this.paint(box);
			this.navState(box);
		}
	}

	// Click / hover handling on the calendar container (capture phase, so it runs before Full Calendar's own handlers).
	wire(box) {
		const fcOf = () => box.fcasFc;
		const onClick = e => {
			const t = e.target;
			// NAV 1.3.0: back / forward (Obsidian's own history)
			const nb = t.closest('.fcas-navb');
			if (nb) { e.stopPropagation(); e.preventDefault(); this.navGo(box, +nb.dataset.dir); return; }
			// Toolbar: Today / prev / next, and the Day–Week–Month–Year switch
			const chip = t.closest('.fcas-chip');
			if (chip) { e.stopPropagation(); e.preventDefault(); if (e.shiftKey) this.toggleCal(chip.dataset.cal); else this.solo(chip.dataset.cal); return; }
			if (t.closest('.fcas-ticon')) { e.stopPropagation(); e.preventDefault(); this.pinPanel(box.fcasView); return; }
			const syncBtn = t.closest('.fcas-sync');
			if (syncBtn) { e.stopPropagation(); e.preventDefault(); this.syncNow(syncBtn); return; }
			const seg = t.closest('.fcas-seg button');
			if (seg) { e.stopPropagation(); e.preventDefault(); this.switchView(box, seg.dataset.v); return; }
			if (this.year !== null && t.closest('.fc-prev-button, .fc-next-button, .fc-today-button')) {
				e.stopPropagation(); e.preventDefault();
				this.year = t.closest('.fc-today-button') ? new Date().getFullYear() : this.year + (t.closest('.fc-prev-button') ? -1 : 1);
				this.paint(box); return;
			}
			const fc = fcOf();
			if (t.closest('.fc-today-button') && fc && this.weekToday(fc.view.type)) {
				// optional (setting): Today puts today in the first column
				e.stopPropagation(); e.preventDefault();
				const d = new Date();
				if (fc.getOption('firstDay') !== d.getDay()) fc.setOption('firstDay', d.getDay());
				fc.gotoDate(d); return;
			}
			const yd = t.closest('.fcas-yday[data-date]');
			if (yd && fc) { this.year = null; box.classList.remove('fcas-year-on'); fc.setOption('firstDay', this.fd()); fc.changeView('timeGridWeek', yd.dataset.date); this.paint(box); return; }
			// Single click on an event selects it (Calendar.app); double click opens the Info card
			const ev = t.closest('.fc-event');
			if (ev && !t.closest('input, button, .ofc-task-checkbox, [type=checkbox]')) {
				e.stopPropagation(); e.preventDefault();
				box.querySelectorAll('.fcas-sel').forEach(x => x.classList.remove('fcas-sel'));
				ev.classList.add('fcas-sel');
			}
		};
		const onDbl = e => {
			const ev = e.target.closest('.fc-event');
			if (!ev) return;
			e.stopPropagation(); e.preventDefault();
			this.openInfo(box, ev);
		};
		// Hover = quick peek; double click = pinned card.
		// PEEK 1.3.0: the peek is interactive (links, Edit): it stays while the pointer is over the event OR the card,
		// and closes ~250 ms after leaving both (enough to cross the gap between them).
		let peekTimer = null, closeTimer = null, peekEl = null;
		const cancelPeek = () => { clearTimeout(peekTimer); clearTimeout(closeTimer); peekTimer = closeTimer = null; peekEl = null; if (this.pop && this.pop.classList.contains('is-peek')) this.closeInfo(); };
		const keepPeek = () => { clearTimeout(closeTimer); closeTimer = null; };
		const closeSoon = () => { clearTimeout(closeTimer); closeTimer = setTimeout(cancelPeek, 250); };
		const onOver = e => {
			const ev = e.target.closest('.fc-event');
			if (!ev || e.buttons) return;
			if (ev === peekEl) { keepPeek(); return; }
			if (this.pop && !this.pop.classList.contains('is-peek')) return;   // a pinned card is open
			cancelPeek(); peekEl = ev;
			peekTimer = setTimeout(() => {
				if (peekEl !== ev || !ev.isConnected) return;
				this.openInfo(box, ev, true);
				const pop = this.pop; if (!pop) return;
				pop.addEventListener('mouseenter', keepPeek);
				pop.addEventListener('mouseleave', e2 => { const to = e2.relatedTarget; if (to && peekEl && peekEl.contains(to)) return; closeSoon(); });
			}, 450);
		};
		const onOut = e => {
			if (!peekEl) return;
			const to = e.relatedTarget;
			if (to && (peekEl.contains(to) || (this.pop && this.pop.contains(to)))) return;
			if (!this.pop) { clearTimeout(peekTimer); peekTimer = null; peekEl = null; return; }
			closeSoon();
		};
		const onDown = () => cancelPeek();   // click, drag or right click on the calendar dismisses the peek at once
		const onCtx = e => {   // NAV 1.3.0: right-click on back / forward
			const nb = e.target.closest('.fcas-navb'); if (!nb) return;
			e.preventDefault(); e.stopPropagation();
			const m = new Menu();
			m.addItem(i => i.setTitle('Back').setIcon('arrow-left').onClick(() => this.navGo(box, -1)));
			m.addItem(i => i.setTitle('Forward').setIcon('arrow-right').onClick(() => this.navGo(box, 1)));
			m.addSeparator();
			m.addItem(i => i.setTitle('Open Full Calendar settings').setIcon('settings').onClick(() => { try { this.app.setting.open(); this.app.setting.openTabById(FC_ID); } catch (er) {} }));
			m.showAtMouseEvent(e);
		};
		box.addEventListener('contextmenu', onCtx, true);
		this.register(() => box.removeEventListener('contextmenu', onCtx, true));
		box.addEventListener('mouseover', onOver);
		box.addEventListener('mouseout', onOut);
		box.addEventListener('mousedown', onDown, true);
		box.addEventListener('wheel', onDown, { passive: true });
		this.register(() => { clearTimeout(peekTimer); box.removeEventListener('mouseover', onOver); box.removeEventListener('mouseout', onOut); box.removeEventListener('mousedown', onDown, true); box.removeEventListener('wheel', onDown); });
		box.addEventListener('click', onClick, true);
		box.addEventListener('dblclick', onDbl, true);
		this.register(() => { box.removeEventListener('click', onClick, true); box.removeEventListener('dblclick', onDbl, true); });
	}

	switchView(box, v) {
		const fc = box.fcasFc;
		if (!fc) return;
		if (v === 'year') { this.year = fc.getDate().getFullYear(); box.classList.add('fcas-year-on'); this.paint(box); return; }
		this.year = null; box.classList.remove('fcas-year-on');
		const map = { day: 'timeGridDay', week: 'timeGridWeek', month: 'dayGridMonth' };
		if (v === 'week' && this.settings.weekFromToday) { if (fc.getOption('firstDay') !== new Date().getDay()) fc.setOption('firstDay', new Date().getDay()); }   // weeks start on today (setting)
		else if (fc.getOption('firstDay') !== this.fd()) fc.setOption('firstDay', this.fd());
		fc.changeView(map[v]);
		requestAnimationFrame(() => { try { fc.updateSize(); } catch (e) {} });
		this.paint(box);
	}

	// Sync button: same as the command "Full Calendar: Revalidate remote calendars". Spins while it runs.
	syncNow(btn) {
		if (btn.classList.contains('is-syncing')) return;
		btn.classList.add('is-syncing');
		try { this.app.commands.executeCommandById(FC_ID + ':full-calendar-revalidate'); }
		catch (e) { console.warn('[fc-apple-skin] sync', e); }
		setTimeout(() => btn.classList.remove('is-syncing'), 3000);
	}

	// NAV 1.3.0: Obsidian's back / forward for this leaf (its view header, which has them, is hidden by styles.css)
	navGo(box, dir) {
		const v = box.fcasView; if (!v || !v.leaf) return;
		if (this.app.workspace.activeLeaf !== v.leaf) this.app.workspace.setActiveLeaf(v.leaf, { focus: true });
		try { this.app.commands.executeCommandById(dir < 0 ? 'app:go-back' : 'app:go-forward'); } catch (e) { console.warn('[fc-apple-skin] nav', e); }
		setTimeout(() => { if (box.isConnected) this.navState(box); }, 80);
	}
	// greyed when there is nowhere to go: the command's own check while this leaf is active, else the hidden header button's state
	navState(box) {
		const v = box.fcasView; if (!v) return;
		const active = this.app.workspace.activeLeaf === v.leaf;
		for (const b of box.querySelectorAll('.fcas-navb')) {
			const dir = +b.dataset.dir; let ok = true;
			if (active) { const c = this.app.commands.commands[dir < 0 ? 'app:go-back' : 'app:go-forward']; try { ok = !!(c && c.checkCallback && c.checkCallback(true)); } catch (e) { ok = true; } }
			else { const hb = dir < 0 ? v.backButtonEl : v.forwardButtonEl; ok = !hb || hb.getAttribute('aria-disabled') !== 'true'; }
			b.classList.toggle('is-off', !ok);
		}
	}


	// Event lookup from a rendered element (Full Calendar keeps the segment on el.fcSeg)
	eventOf(box, el) {
		const fc = box.fcasFc, seg = el.fcSeg;
		if (!fc || !seg || !seg.eventRange) return null;
		const iid = seg.eventRange.instance && seg.eventRange.instance.instanceId;
		return fc.getEvents().find(x => x._instance && x._instance.instanceId === iid) || fc.getEventById(seg.eventRange.def.publicId);
	}

	calendarOf(box, event) {
		const fc = box.fcasFc, src = event.source;
		if (!fc || !src) return null;
		const all = fc.getEventSources();
		const i = all.findIndex(s => s.id === src.id);
		const col = ((src.internalEventSource && src.internalEventSource.ui && src.internalEventSource.ui.backgroundColor) || '').toLowerCase();
		const byIdx = this.calNames[i];
		if (byIdx && (!col || byIdx.color === col)) return { name: byIdx.name, color: col || byIdx.color };
		const byCol = this.calNames.filter(c => c.color === col);
		return { name: byCol.length === 1 ? byCol[0].name : '', color: col };
	}

	openInfo(box, el, peek = false) {
		this.closeInfo();
		const event = this.eventOf(box, el);
		if (!event) return;
		const p = event.extendedProps || {};
		const cal = this.calendarOf(box, event);
		const color = (cal && cal.color) || el.style.getPropertyValue('--ev') || 'var(--interactive-accent)';
		const pop = document.body.createDiv({ cls: 'fcas-pop' + (peek ? ' is-peek' : '') });
		pop.style.setProperty('--ev', color);
		const head = pop.createDiv({ cls: 'fcas-pop-head' });
		head.createDiv({ cls: 'fcas-pop-title', text: event.title });
		// When
		const s = event.start, en = event.end;
		let when = '';
		if (s) {
			if (event.allDay) {
				const last = en ? new Date(en.getTime() - 86400000) : s;
				when = ymd(last) === ymd(s) ? longDate(s) + ' · all day' : longDate(s) + ' – ' + longDate(last) + ' · all day';
			} else {
				when = longDate(s) + ', ' + hm(s);
				if (en) when += ' – ' + (ymd(en) === ymd(s) ? '' : longDate(en) + ', ') + hm(en);
			}
		}
		const sec = pop.createDiv({ cls: 'fcas-pop-sec' });
		if (when) sec.createDiv({ cls: 'fcas-pop-when', text: when });
		if (p.rrule) sec.createDiv({ cls: 'fcas-pop-muted', text: 'Repeats' });
		(Array.isArray(p.alarms) ? p.alarms : []).forEach(a => {
			const m = Number(a && a.minutesBefore);
			if (!isFinite(m)) return;
			const txt = m === 0 ? 'At time of event' : m % 1440 === 0 ? `${m / 1440} day${m === 1440 ? '' : 's'} before` : m % 60 === 0 ? `${m / 60} hour${m === 60 ? '' : 's'} before` : `${m} minutes before`;
			sec.createDiv({ cls: 'fcas-pop-muted', text: 'Alert ' + txt + (m ? ' start' : '') });
		});
		if (p.location) {
			const row = pop.createDiv({ cls: 'fcas-pop-row' }), pl = placeOf(p.location);
			setIcon(row.createSpan({ cls: 'fcas-pop-ic' }), pl ? pl.icon : 'map-pin');
			const a = row.createEl('a', { text: p.location, href: pl && pl.url ? pl.url : 'https://maps.apple.com/?q=' + encodeURIComponent(p.location) });
			a.addEventListener('click', ev => { ev.preventDefault(); window.open(a.href); });
		}
		if (cal && cal.name) {
			const row = pop.createDiv({ cls: 'fcas-pop-row' });
			row.createSpan({ cls: 'fcas-pop-dot' });
			row.createSpan({ text: cal.name });
		}
		const desc = (p.description || '').trim();
		if (desc) {
			const d = pop.createDiv({ cls: 'fcas-pop-desc' });
			desc.split(/(\b(?:https?|applenotes|obsidian|message|mailto):[^\s<>"]+)/g).forEach((part, i) => {
				if (i % 2) { const a = d.createEl('a', { text: part, href: part }); a.addEventListener('click', ev => { ev.preventDefault(); window.open(part); }); }
				else d.appendText(part);
			});
		}
		if (event.url) {
			const row = pop.createDiv({ cls: 'fcas-pop-row' });
			setIcon(row.createSpan({ cls: 'fcas-pop-ic' }), 'link');
			const a = row.createEl('a', { text: event.url, href: event.url });
			a.addEventListener('click', ev => { ev.preventDefault(); window.open(event.url); });
		}
		const foot = pop.createDiv({ cls: 'fcas-pop-foot' });
		if (peek) foot.createSpan({ cls: 'fcas-pop-hint', text: 'Double-click to open' });
		const edit = foot.createEl('button', { text: 'Edit', cls: 'mod-cta' });
		edit.addEventListener('click', () => {
			this.closeInfo();
			const fc = box.fcasFc, h = fc && fc.getOption('eventClick');
			if (typeof h === 'function') h({ el, event, jsEvent: new MouseEvent('click'), view: fc.view });
		});
		// Position next to the event, like Calendar.app's popover
		const r = el.getBoundingClientRect(), W = 300;
		pop.style.width = W + 'px';
		const ph = Math.min(pop.offsetHeight, window.innerHeight - 20);
		let x = r.right + 10;
		if (x + W > window.innerWidth - 8) x = r.left - W - 10;
		if (x < 8) x = Math.max(8, Math.min(window.innerWidth - W - 8, r.left));
		let y = Math.max(10, Math.min(r.top, window.innerHeight - ph - 10));
		pop.style.left = x + 'px'; pop.style.top = y + 'px';
		this.pop = pop;
	}

	closeInfo() { if (this.pop) { this.pop.remove(); this.pop = null; } }

	paint(box) {
		const fc = box.fcasFc;
		// TIPS 1.3.0: the obvious toolbar buttons (prev / next / today / views / Analysis / More / search)
		// get no tooltip at all: strip both title (macOS tip) and aria-label (Obsidian tip). Tips stay on chips, sync and the title icon.
		box.querySelectorAll('.fc-header-toolbar .fc-button[title], .fc-header-toolbar .fc-button[aria-label], .fc-header-toolbar .ofc-toolbar-search-clear[aria-label]').forEach(b => { b.removeAttribute('title'); b.removeAttribute('aria-label'); });
		box.querySelectorAll('.fc-event').forEach(el => {
			const c = el.style.backgroundColor || el.style.borderColor;
			if (c && el.dataset.fcasEv !== c) { el.style.setProperty('--ev', c); el.dataset.fcasEv = c; }
			// Location line under the title (timed events tall enough to show it)
			if (el.classList.contains('fc-timegrid-event') && !el.classList.contains('fc-timegrid-event-short') && !el.dataset.fcasLoc) {
				el.dataset.fcasLoc = '1';
				// 1.3.0: read from the segment (no getEvents() scan per element); pin + short place, or video + "Online"; full text in the peek
				const def = el.fcSeg && el.fcSeg.eventRange && el.fcSeg.eventRange.def, pl = placeOf(def && def.extendedProps && def.extendedProps.location);
				const tc = el.querySelector('.fc-event-title-container');
				if (pl && tc && !tc.querySelector('.fcas-loc')) {
					const l = tc.createDiv({ cls: 'fcas-loc' });
					setIcon(l.createSpan({ cls: 'fcas-loc-ic' }), pl.icon);
					l.createSpan({ text: pl.text });
				}
			}
		});
		// Toolbar: Day / Week / Month / Year switch (once per toolbar)
		const tb = box.querySelector('.fc-header-toolbar');
		if (tb && !tb.querySelector('.fcas-seg')) {
			const seg = createDiv({ cls: 'fcas-seg' });
			for (const [k, label] of [['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['year', 'Year']]) seg.createEl('button', { text: label, attr: { 'data-v': k } });
			const chunks = tb.querySelectorAll('.fc-toolbar-chunk');
			(chunks[chunks.length - 1] || tb).prepend(seg);
		}
		if (tb && !tb.querySelector('.fcas-sync')) {
			const b = createEl('button', { cls: 'fcas-sync' });
			setIcon(b, 'refresh-cw'); tip(b, 'Sync remote calendars (Google, CalDAV, ICS feeds) through Full Calendar');
			const sg = tb.querySelector('.fcas-seg');
			if (sg) sg.before(b); else { const ch = tb.querySelectorAll('.fc-toolbar-chunk'); (ch[ch.length - 1] || tb).prepend(b); }
		}
		// NAV 1.3.0: ‹ › back / forward at the start of the toolbar (before the title)
		if (tb && !tb.querySelector('.fcas-nav')) {
			const nav = createDiv({ cls: 'fcas-nav' });
			for (const [dir, ic] of [[-1, 'arrow-left'], [1, 'arrow-right']]) setIcon(nav.createEl('button', { cls: 'fcas-navb', attr: { 'data-dir': String(dir) } }), ic);
			const tc = tb.querySelector('.fc-toolbar-title'); (tc ? tc.parentElement : tb).prepend(nav);
			this.navState(box);
		}
		const cur = this.year !== null ? 'year' : fc ? ({ timeGridDay: 'day', timeGridWeek: 'week', dayGridMonth: 'month' })[fc.view.type] : '';
		box.querySelectorAll('.fcas-seg button').forEach(b => b.classList.toggle('is-active', b.dataset.v === cur));
		// Title: never edit Full Calendar's own <h2> (it re-renders it); mirror it into a sibling span instead.
		// Calendar icon + one month ("October"; the month of today while today is in view, else the month with
		// most visible days; year only when it isn't this year) + the Islamic month(s) when that setting is on.
		const t = box.querySelector('.fc-toolbar-title');
		if (t) {
			let m = t.nextElementSibling;
			if (!m || !m.classList.contains('fcas-title')) { m = createSpan({ cls: 'fcas-title' }); t.after(m); }
			box.querySelectorAll('.fcas-title').forEach(x => { if (x !== m) x.remove(); });   // Full Calendar moved its title (toolbar re-layout): drop the stale mirror
			const tt = this.titleParts(fc);
			const key = tt.main + '|' + tt.sub + '|' + tt.hijri;
			if (m.dataset.src !== key) {
				m.dataset.src = key; m.empty();
				const ic = m.createSpan({ cls: 'fcas-ticon' }); setIcon(ic, 'calendar-days');
				tip(ic, 'Calendars: hover the left edge, or click here to pin the list open');
				m.createEl('b', { text: tt.main });
				if (tt.sub) m.createSpan({ cls: 'fcas-tyear', text: tt.sub });
				if (tt.hijri) m.createSpan({ cls: 'fcas-thijri', text: tt.hijri, attr: { dir: 'rtl' } });
			}
			this.paintChips(box, m);
		}
		box.querySelectorAll('.fcas-hmonth').forEach(x => x.remove());
		this.paintLayout(box);
		// Month view: Islamic day at the top-left of each cell (when on), "1 Oct" on the 1st (Apple Calendar)
		box.querySelectorAll('.fc-daygrid-day[data-date] .fc-daygrid-day-top').forEach(top => {
			const cell = top.closest('.fc-daygrid-day'), k = cell.dataset.date;
			const num = top.querySelector('.fc-daygrid-day-number');   // "1 Nov" on the 1st: a data attribute shown by CSS, Full Calendar's own text is left alone
			if (num && k.endsWith('-01') && !num.dataset.fcasMon) { const [y0, m0] = k.split('-').map(Number); num.dataset.fcasMon = new Date(y0, m0 - 1, 1).toLocaleDateString(undefined, { month: 'short' }); }
			if (top.dataset.fcasH === k) return;
			top.dataset.fcasH = k;
			top.querySelectorAll('.fcas-mhijri').forEach(x => x.remove());
			const [y, m, d] = k.split('-').map(Number), dt = new Date(y, m - 1, d), h = hijriParts(dt);
			if (h) top.prepend(createSpan({ cls: 'fcas-mhijri' + (h.day === '1' ? ' is-first' : ''), text: h.day === '1' ? h.month : h.day, attr: { dir: 'rtl' } }));
		});
		const now = new Date(), nowTxt = hm(now);
		box.querySelectorAll('.fc-timegrid-now-indicator-arrow').forEach(a => { if (a.dataset.now !== nowTxt) a.dataset.now = nowTxt; });
		this.paintYear(box);
	}

	// ---------- COMPACT 1.2.0 helpers ----------
	titleParts(fc) {
		const now = new Date(), none = { main: '', sub: '', hijri: '' };
		if (this.year !== null) return { main: String(this.year), sub: '', hijri: '' };
		if (!fc || !fc.view || !fc.view.currentStart) return none;
		const v = fc.view, a = v.currentStart, b = new Date(v.currentEnd.getTime() - 1);
		let d, main;
		if (v.type === 'timeGridDay') { d = a; main = a.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long' }); }
		else {
			if (now >= v.currentStart && now < v.currentEnd) d = now;
			else {   // the month with most days in view
				const cnt = new Map();
				for (const x = new Date(a); x <= b; x.setDate(x.getDate() + 1)) { const k = x.getFullYear() * 12 + x.getMonth(); cnt.set(k, (cnt.get(k) || 0) + 1); }
				const best = [...cnt.entries()].sort((p, q) => q[1] - p[1])[0][0]; d = new Date(Math.floor(best / 12), best % 12, 1);
			}
			main = d.toLocaleDateString(undefined, { month: 'long' });
		}
		const ha = hijriParts(a), hb = hijriParts(b);
		const hijri = ha ? (hb && hb.month !== ha.month ? ha.month + ' – ' + hb.month : ha.month) : '';
		return { main, sub: String(d.getFullYear()), hijri };
	}

	// does a hidden calendar have (non-repeating) events in [a, b)? Raw data only; repeating ones are remembered from before.
	rawIn(fc, id, a, b) {
		const s = fc.getEventSourceById(id), m = s && s.internalEventSource && s.internalEventSource.meta;
		if (!Array.isArray(m)) return false;
		return m.some(r => { if (!r || r.rrule || r.daysOfWeek) return false; const s0 = Date.parse(r.start || r.date), e0 = Date.parse(r.end || r.endDate || r.start || r.date); return isFinite(s0) && s0 < b && (isFinite(e0) ? e0 : s0) >= a; });
	}

	// Toolbar chips: one coloured ring per calendar with events in view. Click = only that calendar (again = back); Shift-click = hide/show.
	paintChips(box, after) {
		if (!this.settings.chips) { const old = box.querySelector('.fcas-chips'); if (old) old.remove(); return; }
		const fc = box.fcasFc;
		let row = box.querySelector('.fcas-chips');
		if (!fc || !fc.view || this.year !== null) { if (row) row.remove(); return; }
		const a = fc.view.activeStart, b = fc.view.activeEnd, rk = a.getTime() + ':' + b.getTime();
		const present = new Set(box.fcasPresent && box.fcasPresent.rk === rk ? box.fcasPresent.ids : []);
		// SRCGUARD (30 Oct): an event whose calendar source was just removed / re-added returns an EventSourceApi with no internal source → its
		// .id getter threw "reading 'publicId'" (433× in one session). Read it guarded; skip such events.
		for (const e of fc.getEvents()) { if (!e.start) continue; let sid = null; try { const s = e.source; sid = s ? s.id : null; } catch (x) { sid = null; } if (sid == null) continue; const en = e.end || e.start; if (e.start < b && en >= a) present.add(String(sid)); }
		for (const id of this.hidden) if (!present.has(id) && this.rawIn(fc, id, a, b)) present.add(id);
		box.fcasPresent = { rk, ids: present };
		const solo = this.soloId();
		const list = this.calNames.filter(c => present.has(c.id) || c.id === solo);
		const key = list.map(c => c.id + (this.hidden.has(c.id) ? '-' : '+') + c.color).join(',') + '|' + solo;
		if (!row) row = createDiv({ cls: 'fcas-chips' });
		if (row.previousElementSibling !== after) after.after(row);
		if (row.dataset.key === key) return;
		row.dataset.key = key; row.empty();
		for (const c of list) {
			const off = this.hidden.has(c.id);
			const btn = row.createEl('button', { cls: 'fcas-chip' + (off ? ' is-off' : '') + (solo === c.id ? ' is-solo' : ''), attr: { 'data-cal': c.id } });
			btn.style.setProperty('--c', c.color || '#888');
			tip(btn, c.name + '\n' + (solo === c.id ? 'Click = show the other calendars again' : 'Click = only this calendar') + '\nShift-click = ' + (off ? 'show' : 'hide') + ' it');
		}
	}


	// ---------- Layout: one collision pass per day column (docs/LAYOUT-RULES.md). Inline geometry only; FC's values are put back first. ----------
	resetLayout(box) {
		box.querySelectorAll('.fc-timegrid-event-harness').forEach(h => { const st = h.fcasSet; if (st) for (const k of Object.keys(st.o)) h.style[k] = st.o[k]; h.fcasSet = null; });
		box.querySelectorAll('.fc-timegrid-col').forEach(c => { c.fcasKey = null; });
		box.querySelectorAll('.fcas-ov, .fcas-fit1, .fcas-fit2, .fcas-drop').forEach(e => { e.classList.remove('fcas-ov', 'fcas-fit1', 'fcas-fit2', 'fcas-drop'); e.style.removeProperty('mask-image'); e.style.removeProperty('-webkit-mask-image'); });
	}
	paintLayout(box) {
		if (!this.settings.layered) { if (box.querySelector('.fcas-ov, .fcas-fit1, .fcas-fit2, .fcas-drop, .fc-timegrid-col[data-date]')) this.resetLayout(box); return; }
		if (this.year !== null) return;
		for (const col of box.querySelectorAll('.fc-timegrid-col[data-date]')) { try { this.layoutCol(col); } catch (e) { console.warn('[fc-apple-skin] layout', e); } }
	}
	layoutCol(col) {
		const hs = [...col.querySelectorAll('.fc-timegrid-event-harness')].map(h => ({ h, el: h.querySelector('.fc-timegrid-event') })).filter(e => e.el && !e.el.classList.contains('fc-event-mirror'));
		const colW = col.offsetWidth, colH = col.offsetHeight; if (!colW) return;
		const key = document.body.classList.contains('theme-dark') + '|' + colW + 'x' + colH + '|' + hs.map(e => { const g = e.el.fcSeg; return g ? +g.start + '-' + +g.end + ':' + g.eventRange.def.defId : ''; }).join(',');
		const SIDES = ['left', 'right', 'top', 'bottom', 'zIndex'];
		const kept = e => e.h.fcasSet && SIDES.every(k => e.h.style[k] === e.h.fcasSet.w[k]);
		if (col.fcasKey === key && hs.every(kept)) return;
		col.fcasKey = key;
		for (const e of hs) {   // back to Full Calendar's geometry (a side it rewrote itself stays as it is)
			const st = e.h.fcasSet; if (st) for (const k of SIDES) if (e.h.style[k] === st.w[k]) e.h.style[k] = st.o[k];
			e.h.fcasSet = null;
			e.el.classList.remove('fcas-ov', 'fcas-fit1', 'fcas-fit2', 'fcas-drop'); e.el.style.removeProperty('mask-image'); e.el.style.removeProperty('-webkit-mask-image');
		}
		const o = col.getBoundingClientRect(), evs = hs.map(e => {
			const r = e.el.getBoundingClientRect(), g = e.el.fcSeg, mins_ = g ? (g.end - g.start) / 60000 : 0;
			return Object.assign(e, { top: r.top - o.top, bot: r.bottom - o.top, x: 0, w: colW, depth: 0, grp: null, moved: false, back: routineOn && e.el.classList.contains('fcas-routine') && mins_ >= BACKDROP_MIN, short: e.el.classList.contains('fc-timegrid-event-short') });
		}).sort((a, b) => (b.back - a.back) || (a.top - b.top) || ((b.bot - b.top) - (a.bot - a.top)));
		// R2: ordinary events starting together share the width
		evs.forEach((e, i) => { if (e.back) return; for (let j = 0; j < i; j++) { const p = evs[j]; if (!p.back && overlapY(p, e) > Math.max(TINY_OVERLAP_PX, TINY_OVERLAP_RATIO * Math.min(p.bot - p.top, e.bot - e.top)) && Math.abs(p.top - e.top) <= SAME_START_PX) { e.grp = p.grp || p; e.grp.grp = e.grp; break; } } });
		// R5: a tiny edge overlap is removed instead of layered: the smaller box (or the backdrop) gives way
		evs.forEach((a, i) => { for (let j = i + 1; j < evs.length; j++) {
			const b = evs[j], ov = overlapY(a, b), ha = a.bot - a.top, hb = b.bot - b.top;
			if (ov <= 0 || (a.grp && a.grp === b.grp) || ov > Math.max(TINY_OVERLAP_PX, TINY_OVERLAP_RATIO * Math.min(ha, hb))) continue;
			const up = a.top <= b.top ? a : b, lo = up === a ? b : a; if (up.bot >= lo.bot) continue;   // contained: that's layering, not an edge
			const less = a.back !== b.back ? (a.back ? a : b) : ha <= hb ? a : b, h = less.bot - less.top;
			if (less === up) { if (h - ov >= MIN_BOX_PX) up.bot -= ov; else { up.top -= ov; up.bot -= ov; } }
			else { if (h - ov >= MIN_BOX_PX) lo.top += ov; else { lo.top += ov; lo.bot += ov; } }
			less.moved = true;
		} });
		// R1: everything spans the day; each layer starts a strip's width further right so what's behind keeps its side strip
		evs.forEach((e, i) => { let d = e.grp && e.grp.depth || 0; for (let j = 0; j < i; j++) { const p = evs[j]; if (overlapY(p, e) > 0.5 && !(e.grp && e.grp === p.grp)) d = Math.max(d, p.depth + 1); } e.depth = d; if (e.grp) e.grp.depth = Math.max(e.grp.depth || 0, d); });
		const offs = d => Math.min(d, STRIP_MAX_DEPTH) * STRIP_PX;
		for (const e of evs) {
			const g = e.grp ? evs.filter(x => x.grp === e.grp) : null, d = g ? e.grp.depth : e.depth;
			if (g) { const w = (colW - offs(d)) / g.length; e.x = offs(d) + g.indexOf(e) * w; e.w = w; e.depth = d; } else { e.x = offs(d); e.w = colW - e.x; }
			const st = { o: {}, w: {} }; for (const k of SIDES) st.o[k] = e.h.style[k];
			e.h.style.left = e.x + 'px'; e.h.style.right = (colW - e.x - e.w) + 'px'; e.h.style.zIndex = String(d + 1);
			if (e.moved) { e.h.style.top = e.top + 'px'; e.h.style.bottom = -e.bot + 'px'; }
			for (const k of SIDES) st.w[k] = e.h.style[k];
			e.h.fcasSet = st;
		}
		// R10: shrink the text one step at a time until it fits
		const fit = e => {
			if (e.short) return;
			if (e.back) return;
			e.el.classList.remove('fcas-fit1', 'fcas-fit2');
			const m = e.el.querySelector('.fc-event-main'), over = () => m && m.scrollHeight > e.el.clientHeight + 1;
			for (let n = 1; n <= FIT_STEPS && over(); n++) { e.el.classList.remove('fcas-fit' + (n - 1)); e.el.classList.add('fcas-fit' + n); }
		};
		evs.forEach(fit);
		const Y0 = col.getBoundingClientRect().top, X0 = col.getBoundingClientRect().left;
		for (const e of evs) e.ink = inkRects(e.el, X0, Y0);
		// R3 / R4: the top box thins where it covers a box, and much more where it covers text
		evs.forEach((e, i) => {
			const bands = [], texts = [], ey = e.top, eh = e.bot - e.top, me = { x: e.x, y: ey, w: e.w, h: eh };
			// R4b: when the top box's own text would land on the text behind and there's room below it, its text drops clear
			const under = []; for (let j = 0; j < i; j++) { const p = evs[j]; if (!(e.grp && e.grp === p.grp)) under.push(...p.ink.filter(q => hit(q, me))); }
			if (under.length && e.ink.length && e.ink.some(a => under.some(q => hit(a, q)))) {
				const drop = Math.ceil(Math.max(...under.map(q => q.y + q.h)) - Math.min(...e.ink.map(a => a.y))) + DROP_GAP_PX, own = Math.max(...e.ink.map(a => a.y + a.h)) - Math.min(...e.ink.map(a => a.y));
				if (drop + own <= eh - DROP_GAP_PX) { e.el.style.setProperty('--fcas-drop', drop + 'px'); e.el.classList.add('fcas-drop'); e.ink = inkRects(e.el, X0, Y0); }
			}
			for (let j = 0; j < i; j++) {
				const p = evs[j]; if (e.grp && e.grp === p.grp) continue;
				const yt = Math.max(p.top, e.top), yb = Math.min(p.bot, e.bot); if (yb <= yt) continue;
				bands.push({ x: 0, y: yt - ey, w: e.w, h: yb - yt });
				for (const q of p.ink) if (hit(q, me)) texts.push({ x: q.x - e.x - 1, y: q.y - ey - 1, w: q.w + 2, h: q.h + 2 });
			}
			if (bands.length) {
				const cs = getComputedStyle(e.el), fill = cs.backgroundImage !== 'none' ? cs.backgroundImage : cs.backgroundColor;
				e.el.style.setProperty('--fcas-fill', fill); e.el.style.setProperty('--fcas-bgmask', maskUrl(e.w, eh, bands, BOX_ALPHA)); e.el.classList.add('fcas-ov');
			}
			const mk = maskUrl(e.w, eh, texts, TEXT_ALPHA);
			if (mk) { e.el.style.setProperty('mask-image', mk); e.el.style.setProperty('-webkit-mask-image', mk); }
		});
	}

	// Calendars panel: slides in from the left edge of the calendar (Calendar.app's sidebar), narrow, overlays the grid.
	ensurePanel(v, box) {
		const host = v.containerEl.querySelector(':scope > .view-content');
		if (!host || host.querySelector(':scope > .fcas-side')) return;
		host.addClass('fcas-host');
		const edge = host.createDiv({ cls: 'fcas-edge' });
		const side = host.createDiv({ cls: 'fcas-side' });
		let tOpen = null, tClose = null;
		const open = () => { clearTimeout(tClose); if (!side.hasClass('is-open')) { side.addClass('is-open'); this.fillPanel(side); } };
		const close = () => { if (!side.hasClass('is-pinned')) side.removeClass('is-open'); };
		edge.addEventListener('mouseenter', () => { clearTimeout(tClose); tOpen = setTimeout(open, 120); });
		edge.addEventListener('mouseleave', () => { clearTimeout(tOpen); tClose = setTimeout(close, 350); });
		side.addEventListener('mouseenter', () => clearTimeout(tClose));
		side.addEventListener('mouseleave', () => { tClose = setTimeout(close, 350); });
		this.register(() => { clearTimeout(tOpen); clearTimeout(tClose); edge.remove(); side.remove(); host.removeClass('fcas-host'); });
	}
	fillPanel(side) {
		side.empty();
		const solo = this.soloId();
		const head = side.createDiv({ cls: 'fcas-side-head' });
		head.createSpan({ cls: 'fcas-side-title', text: 'Calendars' });
		if (this.hidden.size) { const b = head.createEl('button', { cls: 'fcas-side-btn', text: 'Show all' }); b.addEventListener('click', () => this.showAll()); }
		const pin = head.createEl('button', { cls: 'fcas-side-btn fcas-side-pin' + (side.hasClass('is-pinned') ? ' is-on' : '') });
		setIcon(pin, 'pin'); pin.setAttr('aria-label', side.hasClass('is-pinned') ? 'Unpin: hide when the pointer leaves' : 'Pin: keep the list open');
		pin.addEventListener('click', () => { side.toggleClass('is-pinned', !side.hasClass('is-pinned')); if (!side.hasClass('is-pinned')) side.removeClass('is-open'); else this.fillPanel(side); });
		const groups = [['google', 'Google'], ['caldav', 'CalDAV'], ['outlook', 'Outlook'], ['ical', 'ICS feeds'], ['other', 'Local & other']], named = groups.map(g => g[0]);
		for (const [gk, gl] of groups) {
			const cs = this.calNames.filter(c => gk === 'other' ? !named.includes(c.type) : c.type === gk);
			if (!cs.length) continue;
			const allOn = cs.every(c => !this.hidden.has(c.id));
			const g = side.createDiv({ cls: 'fcas-side-grp', text: gl });
			g.setAttr('aria-label', (allOn ? 'Hide' : 'Show') + ' every ' + gl + ' calendar');
			g.addEventListener('click', () => { const h = new Set(this.hidden); cs.forEach(c => allOn ? h.add(c.id) : h.delete(c.id)); this.setHidden(h); });
			for (const c of cs) {
				const row = side.createDiv({ cls: 'fcas-cal' + (this.hidden.has(c.id) ? ' is-off' : '') });
				row.style.setProperty('--c', c.color || '#888');
				setIcon(row.createSpan({ cls: 'fcas-cb' }), 'check');
				row.createSpan({ cls: 'fcas-cal-name', text: c.name, attr: { 'aria-label': c.name } });
				const only = row.createEl('button', { cls: 'fcas-only', text: solo === c.id ? 'All' : 'Only' });
				only.addEventListener('click', e => { e.stopPropagation(); this.solo(c.id); });
				row.addEventListener('click', () => this.toggleCal(c.id));
			}
		}
	}
	refreshPanels() { for (const v of this.views()) { const s = v.containerEl.querySelector('.fcas-side.is-open'); if (s) this.fillPanel(s); } }
	pinPanel(v) {
		const side = v && v.containerEl.querySelector('.fcas-side');
		if (!side) return;
		const on = !side.hasClass('is-pinned');
		side.toggleClass('is-pinned', on); side.toggleClass('is-open', on);
		if (on) this.fillPanel(side);
	}

	// Year view: 12 small months, days shaded by event count (Apple Calendar's heat map), Islamic month starts underlined (when on).
	paintYear(box) {
		let yv = box.querySelector(':scope > .fcas-year');
		if (this.year === null || !box.fcasFc) { if (yv) yv.remove(); box.classList.remove('fcas-year-on'); return; }
		box.classList.add('fcas-year-on');
		const fc = box.fcasFc, Y = this.year, today = ymd(new Date());
		const evs = fc.getEvents();
		const key = Y + ':' + evs.length + ':' + today;
		if (yv && yv.dataset.key === key) return;
		// count events per local day
		const count = {};
		for (const e of evs) {
			if (!e.start) continue;
			const s = new Date(e.start), end = e.end ? new Date(e.end) : new Date(e.start);
			if (s.getFullYear() > Y || end.getFullYear() < Y) continue;
			const d = new Date(s.getFullYear(), s.getMonth(), s.getDate());
			let guard = 0;
			do { const k = ymd(d); count[k] = (count[k] || 0) + 1; d.setDate(d.getDate() + 1); guard++; }
			while (d < end && guard < 62 && !(e.allDay && d >= end));
		}
		const level = n => !n ? 0 : n <= 2 ? 1 : n <= 4 ? 2 : n <= 7 ? 3 : 4;
		if (!yv) { yv = createDiv({ cls: 'fcas-year' }); box.appendChild(yv); }
		yv.empty(); yv.dataset.key = key;
		if (hijriOn) {
			const h1 = hijriParts(new Date(Y, 0, 1)), h2 = hijriParts(new Date(Y, 11, 31));
			const leg = yv.createDiv({ cls: 'fcas-year-legend', attr: { dir: 'rtl' } });
			leg.createSpan({ cls: 'fcas-year-u', text: 'اليوم الأول من الشهر الهجري' });
			leg.createSpan({ text: (h1 && h2 ? (h1.year === h2.year ? h1.year : h1.year + '–' + h2.year) : '') });
		}
		const grid = yv.createDiv({ cls: 'fcas-year-grid' });
		const fd = this.fd(), dows = Array.from({ length: 7 }, (_, i) => 'SMTWTFS'[(fd + i) % 7]);
		for (let mo = 0; mo < 12; mo++) {
			const card = grid.createDiv({ cls: 'fcas-ym' });
			card.createDiv({ cls: 'fcas-ym-name', text: new Date(Y, mo, 1).toLocaleDateString(undefined, { month: 'long' }) });
			const g = card.createDiv({ cls: 'fcas-ym-grid' });
			dows.forEach(x => g.createDiv({ cls: 'fcas-ym-dow', text: x }));
			const first = new Date(Y, mo, 1), off = (first.getDay() - fd + 7) % 7;
			const start = new Date(Y, mo, 1 - off);
			for (let i = 0; i < 42; i++) {
				const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
				const k = ymd(d), inMonth = d.getMonth() === mo;
				const cell = g.createDiv({ cls: 'fcas-yday', text: String(d.getDate()) });
				if (!inMonth) { cell.addClass('is-other'); continue; }
				cell.dataset.date = k;
				const lv = this.settings.yearHeat ? level(count[k]) : 0;
				if (lv) cell.addClass('lv' + lv);
				if (k === today) cell.addClass('is-today');
				const h = hijriParts(d), hf = !!(h && h.day === '1');
				if (hf) cell.addClass('is-hfirst');
					// one tooltip per busy day (date · event count · Islamic month start); nothing on an empty day
					const lines = []; if (count[k]) lines.push(count[k] + ' event' + (count[k] > 1 ? 's' : '')); if (hf) lines.push('1 ' + h.month + ' ' + h.year + ' begins (Islamic)');
					if (lines.length) cell.setAttr('aria-label', longDate(d) + ' · ' + lines.join(' · '));
			}
		}
	}

	// MINI: Full Calendar's sidebar view ("Open mini calendar view") drawn like
	// Fantastical's menu-bar window: month grid with one dot per calendar on top, the days' events as a list below.
	// The list is a FullCalendar list view spanning the grid's 6 weeks (so the dots come from what FC already holds);
	// clicking a day scrolls the list to it. Display only: nothing is written to settings or calendars.
	miniViews(all) { return this.app.workspace.getLeavesOfType('full-calendar-sidebar-view').map(l => l.view).filter(v => v && v.containerEl && (all || v.fullCalendarView)); }
	scanMini() { for (const v of this.miniViews()) try { this.skinMini(v); } catch (e) { console.warn('[fc-apple-skin] mini', String(e && (e.stack || e.message) || e)); } }
	miniGridStart() { const m = this.miniMonth; return addDays(m, -((m.getDay() - this.fd() + 7) % 7)); }   // first day of the configured week
	skinMini(v) {
		const fc = v.fullCalendarView, box = v.containerEl.querySelector('.ofc-calendar-container');
		if (!box || !fc) return;
		if (!this.miniMonth) { const t = new Date(); this.miniSel = new Date(t.getFullYear(), t.getMonth(), t.getDate()); this.miniMonth = new Date(t.getFullYear(), t.getMonth(), 1); }
		v.containerEl.classList.add('fcas-mini-view');
		let mm = box.previousElementSibling;
		if (!mm || !mm.classList.contains('fcas-mm')) { mm = createDiv('fcas-mm'); box.before(mm); this.wireMini(mm, box); }
		if (box.fcasMiniFc === fc) return;
		box.fcasMiniFc = fc; box.classList.add('fcas', 'fcas-mini');
		let ml = box.nextElementSibling;
		if (!ml || !ml.classList.contains('fcas-ml')) { ml = createDiv('fcas-ml'); box.after(ml); }
		// FC's own (hidden) view is left alone: its changeView / visibleRange do nothing in the sidebar leaf, and it already
		// holds every event, so the grid dots and the list below are drawn from fc.getEvents() directly.
		fc.setOption('headerToolbar', false); fc.setOption('footerToolbar', false);
		fc.on('eventsSet', () => requestAnimationFrame(() => this.drawMini(box)));
		requestAnimationFrame(() => { this.drawMini(box); this.miniScroll(box); });
	}
	wireMini(mm, box) {
		mm.addEventListener('click', e => {
			const t = e.target.closest('[data-mini]'); if (!t) return;
			const act = t.dataset.mini, m = this.miniMonth;
			if (act === 'prev' || act === 'next') { this.miniMonth = new Date(m.getFullYear(), m.getMonth() + (act === 'prev' ? -1 : 1), 1); }
			else if (act === 'today') { const d = new Date(); this.miniSel = new Date(d.getFullYear(), d.getMonth(), d.getDate()); this.miniMonth = new Date(d.getFullYear(), d.getMonth(), 1); }
			else { this.miniSel = dayOf(act); if (this.miniSel.getMonth() !== m.getMonth() || this.miniSel.getFullYear() !== m.getFullYear()) this.miniMonth = new Date(this.miniSel.getFullYear(), this.miniSel.getMonth(), 1); }
						this.drawMini(box); this.miniScroll(box);
		});
	}
	miniColor(ev) {
		const ui = ev._def && ev._def.ui, src = ev.source && ev.source.internalEventSource && ev.source.internalEventSource.ui;
		return ev.backgroundColor || (ui && ui.backgroundColor) || (src && src.backgroundColor) || ev.borderColor || (src && src.borderColor) || '';
	}
	drawMini(box) {
		const fc = box.fcasMiniFc, mm = box.previousElementSibling;
		if (!fc || !mm || !mm.classList.contains('fcas-mm') || !this.miniMonth) return;
		const start = this.miniGridStart(), dots = new Map();
		for (const ev of fc.getEvents()) {
			if (ev.display === 'background' || ev.display === 'none' || !ev.start) continue;
			const c = this.miniColor(ev) || 'var(--text-muted)';
			let d = new Date(ev.start.getFullYear(), ev.start.getMonth(), ev.start.getDate());
			const end = ev.end && ev.end > ev.start ? ev.end : new Date(ev.start.getTime() + 1);
			for (let i = 0; i < MINI_DAYS && d < end; i++, d = addDays(d, 1)) { const k = ymd(d); const set = dots.get(k) || new Set(); if (set.size < MINI_DOTS) set.add(c); dots.set(k, set); }
		}
		const m = this.miniMonth, today = ymd(new Date()), sel = ymd(this.miniSel);
		mm.empty();
		const head = mm.createDiv({ cls: 'fcas-mm-head' }), ttl = head.createSpan({ cls: 'fcas-mm-title' });
		ttl.createEl('b', { text: m.toLocaleDateString(undefined, { month: 'long' }) }); ttl.appendText(' '); ttl.createSpan({ cls: 'fcas-mm-year', text: String(m.getFullYear()) });
		const nav = head.createSpan({ cls: 'fcas-mm-nav' });
		nav.createEl('button', { text: '‹', attr: { 'data-mini': 'prev', 'aria-label': 'Previous month' } });
		nav.createEl('button', { text: 'Today', cls: 'fcas-mm-today', attr: { 'data-mini': 'today' } });
		nav.createEl('button', { text: '›', attr: { 'data-mini': 'next', 'aria-label': 'Next month' } });
		const grid = mm.createDiv({ cls: 'fcas-mm-grid' });
		for (let i = 0; i < 7; i++) { const dw = (this.fd() + i) % 7; grid.createSpan({ cls: 'fcas-mm-dow' + (dw === 0 || dw === 6 ? ' is-wkend' : ''), text: 'SMTWTFS'[dw] }); }
		for (let i = 0; i < MINI_DAYS; i++) {
			const d = addDays(start, i), k = ymd(d), cls = ['fcas-mm-day'];
			if (d.getMonth() !== m.getMonth()) cls.push('is-out'); if (k === today) cls.push('is-today'); if (k === sel) cls.push('is-sel'); if (d.getDay() === 0 || d.getDay() === 6) cls.push('is-wkend');
			const btn = grid.createEl('button', { cls: cls.join(' '), attr: { 'data-mini': k } });
			btn.createSpan({ cls: 'fcas-mm-num', text: String(d.getDate()) });
			const dd = btn.createSpan({ cls: 'fcas-mm-dots' });
			for (const c of dots.get(k) || []) dd.createEl('i').style.background = c;
		}
		this.drawMiniList(box, box.nextElementSibling, this.miniSel);
	}
	drawMiniList(box, ml, start) {
		if (!ml || !ml.classList.contains('fcas-ml')) return;
		const fc = box.fcasMiniFc, byDay = new Map(), end = addDays(start, MINI_DAYS), now = Date.now();
		for (const ev of fc.getEvents()) {
			if (ev.display === 'background' || ev.display === 'none' || !ev.start) continue;
			const e2 = ev.end && ev.end > ev.start ? ev.end : new Date(ev.start.getTime() + 1);
			let d = new Date(ev.start.getFullYear(), ev.start.getMonth(), ev.start.getDate());
			for (let i = 0; i < MINI_DAYS && d < e2; i++, d = addDays(d, 1)) { if (d < start || d >= end) continue; const k = ymd(d); (byDay.get(k) || byDay.set(k, []).get(k)).push(ev); }
		}
		const t0 = ymd(new Date()), t1 = ymd(addDays(new Date(), 1)), sel = ymd(this.miniSel);
		const keys = new Set([...byDay.keys(), sel]);
		ml.empty();
		for (const k of [...keys].sort()) {
			const d = dayOf(k), name = k === t0 ? 'Today' : k === t1 ? 'Tomorrow' : d.toLocaleDateString(undefined, { weekday: 'long' });
			const dh = ml.createDiv({ cls: 'fcas-ml-day' + (k === t0 ? ' is-today' : ''), attr: { 'data-date': k } });
			dh.createSpan({ cls: 'fcas-ml-name', text: name }); dh.createSpan({ cls: 'fcas-ml-date', text: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) });
			const evs = (byDay.get(k) || []).slice().sort((x, y) => (+!!x.allDay - +!!y.allDay) * -1 || x.start - y.start);
			if (!evs.length) ml.createDiv({ cls: 'fcas-ml-none', text: 'No events' });
			for (const ev of evs) {
				const c = this.miniColor(ev) || 'var(--text-muted)', e2 = ev.end || ev.start;
				const row = ml.createDiv({ cls: 'fcas-ml-ev' + (e2.getTime() < now ? ' is-past' : '') });
				row.createEl('i').style.background = c;
				row.createSpan({ cls: 'fcas-ml-t', text: ev.title });
				row.createSpan({ cls: 'fcas-ml-tm', text: ev.allDay ? 'All day' : hm(ev.start) + ' – ' + hm(e2) });
			}
		}
	}

	miniScroll(box) {
		requestAnimationFrame(() => {
			const ml = box.nextElementSibling; if (!ml || !ml.classList.contains('fcas-ml')) return;
			ml.scrollTop = 0;
		});
	}
	unskinMini(v) {
		v.containerEl.classList.remove('fcas-mini-view');
		const box = v.containerEl.querySelector('.ofc-calendar-container'); if (!box) return;
		const mm = box.previousElementSibling; if (mm && mm.classList.contains('fcas-mm')) mm.remove();
		const ml = box.nextElementSibling; if (ml && ml.classList.contains('fcas-ml')) ml.remove();
		box.classList.remove('fcas-mini'); const fc = box.fcasMiniFc; box.fcasMiniFc = null;
		if (fc && typeof v.refreshView === 'function') v.refreshView().catch(() => {});   // FC rebuilds its own sidebar calendar
	}
	onunload() {
		this.closeInfo();
		for (const v of this.miniViews(true)) this.unskinMini(v);
		for (const v of this.views()) {
			const box = v.containerEl.querySelector('.ofc-calendar-container');
			if (box) {
				box.classList.remove('fcas', 'fcas-year-on');
				box.querySelectorAll('.fcas-title, .fcas-seg, .fcas-year, .fcas-hmonth, .fcas-loc, .fcas-mhijri, .fcas-chips, .fcas-nav, .fcas-sync').forEach(e => e.remove());
				box.querySelectorAll('[data-fcas-loc]').forEach(e => delete e.dataset.fcasLoc);
				box.querySelectorAll('[data-fcas-mon]').forEach(e => delete e.dataset.fcasMon); box.querySelectorAll('[data-fcas-h]').forEach(e => delete e.dataset.fcasH);
				box.querySelectorAll('.fc-timegrid-event-harness').forEach(h => { const st = h.fcasSet; if (st) for (const k of Object.keys(st.o)) h.style[k] = st.o[k]; h.fcasSet = null; });
				box.querySelectorAll('.fc-timegrid-col').forEach(c => { c.fcasKey = null; });
				box.querySelectorAll('.fcas-ov, .fcas-fit1, .fcas-fit2, .fcas-drop').forEach(e => { e.classList.remove('fcas-ov', 'fcas-fit1', 'fcas-fit2', 'fcas-drop'); e.style.removeProperty('mask-image'); e.style.removeProperty('-webkit-mask-image'); });
			}
			const fc = v.fullCalendarView;
			this.unhookFc(fc);   // every calendar visible again
			v.containerEl.closest('.workspace-leaf-content')?.classList.remove('fcas-leaf');
			try { fc?.setOption('dayHeaderContent', undefined); fc?.setOption('titleFormat', undefined); fc?.setOption('firstDay', this.fd()); fc?.setOption('dayMaxEvents', false); fc?.setOption('slotEventOverlap', true); fc?.setOption('defaultRangeSeparator', ' - '); } catch (e) {}
		}
		document.querySelectorAll('.fcas-leaf').forEach(e => e.classList.remove('fcas-leaf'));
	}
};

class SkinSettings extends PluginSettingTab {
	constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
	display() {
		const { containerEl } = this, p = this.plugin;
		containerEl.empty();
		const save = async () => { await p.saveData(p.settings); hijriOn = !!p.settings.hijri; syncRoutine(p.settings); p.reparseAll(); for (const v of p.views()) { const b = v.containerEl.querySelector('.ofc-calendar-container'); if (b) { b.fcasFc && p.applyPrefs(b.fcasFc); p.paint(b); } } };
		containerEl.createEl('p', { cls: 'setting-item-description', text: 'Restyles Full Calendar Remastered. These options only change how events are displayed; calendar data is never modified.' });
		new Setting(containerEl).setName('First day of the week').setDesc('Used by the week, month, year and mini calendar views.')
			.addDropdown(d => d.addOption('-1', 'Follow Full Calendar').addOption('1', 'Monday').addOption('0', 'Sunday').addOption('6', 'Saturday')
				.setValue(String(p.settings.firstDay)).onChange(async v => { p.settings.firstDay = Number(v); await save(); }));
		new Setting(containerEl).setName('Week view starts on today').setDesc('The week view shows a rolling seven days with today in the first column.')
			.addToggle(t => t.setValue(!!p.settings.weekFromToday).onChange(async v => { p.settings.weekFromToday = v; await save(); }));
		new Setting(containerEl).setName('Layered overlap layout').setDesc('Off by default (Apple Calendar places overlapping events side by side). On: overlapping events stack in layers with a visible side strip, and text steps down to fit. See docs/LAYOUT-RULES.md.')
			.addToggle(t => t.setValue(!!p.settings.layered).onChange(async v => { p.settings.layered = v; await save(); }));
		new Setting(containerEl).setName('Striped look for long repeating events').setDesc('Off by default (Apple Calendar does not do this). Repeating timed events at least as long as the threshold below are drawn striped, behind other events.')
			.addToggle(t => t.setValue(!!p.settings.routine).onChange(async v => { p.settings.routine = v; await save(); }));
		new Setting(containerEl).setName('Striped look threshold (minutes)').setDesc('Minimum length for the striped look. Minimum 30.')
			.addText(t => t.setValue(String(p.settings.routineMin)).onChange(async v => { const n = Number(v); if (n >= 30) { p.settings.routineMin = Math.round(n); await save(); } }));
		new Setting(containerEl).setName('Calendar chips in the toolbar').setDesc('Off by default (Apple Calendar has none). Coloured rings in the toolbar: click one to show only that calendar, Shift-click to hide or show it.')
			.addToggle(t => t.setValue(!!p.settings.chips).onChange(async v => { p.settings.chips = v; await save(); }));
		new Setting(containerEl).setName('Busy-day shading in the year view').setDesc('Off by default (Apple Calendar does not shade days). Tints each day by how many events it has.')
			.addToggle(t => t.setValue(!!p.settings.yearHeat).onChange(async v => { p.settings.yearHeat = v; await save(); }));
		new Setting(containerEl).setName('Show Islamic calendar dates').setDesc('Adds the Islamic (civil) day next to each date, the month name in the title and in the year view.')
			.addToggle(t => t.setValue(!!p.settings.hijri).onChange(async v => { p.settings.hijri = v; await save(); }));
	}
}
