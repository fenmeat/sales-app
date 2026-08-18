const CAUSE_LISTS = {
	cashShort: [
		'Invoice marked as Cash, but customer actually paid Credit/Shop2Shop',
		'Credit collected but not recorded on Cash Up',
		'Change given incorrectly',
		'Cash lost or stolen',
		'Denomination count error (miscounted on sheet)',
		'Zoho invoice not yet synced when comparison was made'
	],
	cashOver: [
		'Customer paid more than invoice amount (change not given)',
		'Credit collection counted twice by mistake'
	],
	stockDiff: [
		'Invoice still in Zoho Drafts — not saved as "Sent"',
		'Stock left with customer but no invoice created',
		'Stock miscounted at load (Morning Load) or Evening Returns',
		'Stock stolen or lost',
		// ADDED 6 August 2026 -- root cause Alex identified from real cases
		// (Braai Wors -1 alone; Cheese Russian -1 / Cheese Vienna +1 together
		// as a product swap): staff not checking what was physically handed
		// over against the invoice before leaving the customer. Removed
		// "Sample/return product not recorded" and "Breakage/spoilage not
		// recorded" -- Alex confirmed these are not realistic causes given
		// how the route actually operates.
		'Product delivered didn\'t match the invoice — stock not checked against invoice before handover'
	]
};
const CAUSE_LISTS_XH = {
	cashShort: [
		'I-invoyisi ibhalwe njenge-Cash, kodwa umthengi ubhatale nge-Credit/Shop2Shop',
		'Ityala liqokelelwe kodwa alibhalwanga kwi-Cash Up',
		'Ushintyo lunikwe ngokungachanekanga',
		'Imali ilahlekile okanye ibiwe',
		'Impazamo yokubala iinoti/iindibano (ukubala okungachanekanga kwiphepha)',
		'I-invoyisi ye-Zoho beyingekafakwa xa kusenziwa umahluko'
	],
	cashOver: [
		'Umthengi ubhatale ngaphezulu kwesixa se-invoyisi (ushintyo alunikwanga)',
		'Ukuqokelelwa kwetyala kubaliwe kabini ngempazamo'
	],
	stockDiff: [
		'I-invoyisi isekwi-Drafts kwi-Zoho — ayigcinwanga njenge "Sent"',
		'Isitokhwe sishiywe nomthengi kodwa akwenziwanga invoyisi',
		'Isitokhwe sibalwe ngokungachanekanga xa silayishwa (Ekuseni) okanye xa kubuyiswa (Ngokuhlwa)',
		'Isitokhwe sibiwe okanye silahlekile',
		// ADDED 6 August 2026 -- see matching English-list comment above.
		'Impahla ehanjisiweyo ayivumelani ne-invoyisi — isitokhwe asizange sijongwe ngokuchasene ne-invoyisi ngaphambi kokunikezelwa'
	]
};
const REPORT_I18N = {
	en: {
		heading: 'Delivery & Cash Report',
		route: 'Route',
		date: 'Date',
		salesPerson: 'Sales Person',
		cashShort: (amt) => `Cash was short by R${amt} today.`,
		cashOver: (amt) => `Cash was over by R${amt} today — more cash was counted than expected.`,
		cashMatched: 'Cash matched exactly today. Well done.',
		stockIntro: 'There is a difference between what was recorded as sold and what Zoho shows as invoiced. See the product list below.',
		stockMatched: 'Stock and Zoho invoices matched exactly today. Well done.',
		productHeader: 'Products to check',
		deliveredNotInvoiced: (name, sold, zoho, diff) =>
			`${name}: You recorded ${sold} sold, but only ${zoho} is invoiced in Zoho. ${diff} item(s) may still need an invoice, or were given away without one — please check.`,
		invoicedNotDelivered: (name, sold, zoho, diff) =>
			`${name}: Zoho shows ${zoho} invoiced, but only ${sold} is recorded as sold. ${diff} item(s) may have been left with a customer without being counted, or the stock count may be wrong — please check.`,
		causesHeaderShort: 'Possible reasons the cash was short',
		causesHeaderOver: 'Possible reasons the cash was over',
		causesHeaderStock: 'Possible reasons for the stock difference',
		alreadyChecked: 'Already checked by Alex — not the reason:',
		stillToCheck: 'Please check if this could be the reason:',
		footer: 'Please check these and let Alex know what you find. This helps avoid a wrong deduction from your pay.'
	},
	xh: {
		heading: 'Ingxelo Yemveliso Nemali',
		route: 'Uhambo',
		date: 'Umhla',
		salesPerson: 'Umthengisi',
		cashShort: (amt) => `Imali ishoti nge-R${amt} namhlanje.`,
		cashOver: (amt) => `Imali igqithile nge-R${amt} namhlanje — kubaliwe imali engaphezulu kunelindelekileyo.`,
		cashMatched: 'Imali ihambelana ngokupheleleyo namhlanje. Enkosi ngomsebenzi wakho olungileyo.',
		stockIntro: 'Kukho umahluko phakathi kwento ebhalwe njengethengisiweyo nento ebonisa i-Zoho njenge-invoyisiweyo. Jonga uluhlu lweemveliso ngezantsi.',
		stockMatched: 'Isitokhwe kunye ne-invoyisi ze-Zoho zihambelana ngokupheleleyo namhlanje. Enkosi.',
		productHeader: 'Iimveliso ekufuneka zijongwe',
		deliveredNotInvoiced: (name, sold, zoho, diff) =>
			`${name}: Ubhale phantsi ukuba kuthengisiwe ${sold}, kodwa yi-${zoho} kuphela e-invoyisiweyo kwi-Zoho. ${diff} isenokuba isafuna i-invoyisi, okanye yanikwa umthengi ngaphandle kwe-invoyisi — nceda ujonge.`,
		invoicedNotDelivered: (name, sold, zoho, diff) =>
			`${name}: I-Zoho ibonisa ukuba i-invoyisiwe ${zoho}, kodwa yi-${sold} kuphela ebhalwe njengethengisiweyo. ${diff} isenokuba ishiywe nomthengi ngaphandle kokubalwa, okanye ukubalwa kwesitokhwe kwakungachananga — nceda ujonge.`,
		causesHeaderShort: 'Izizathu ezinokubangela ukuba imali ishoti',
		causesHeaderOver: 'Izizathu ezinokubangela ukuba imali igqithe',
		causesHeaderStock: 'Izizathu ezinokubangela umahluko wesitokhwe',
		alreadyChecked: 'Sele ijongiwe ngu-Alex — asiyiyo ingxaki:',
		stillToCheck: 'Nceda ujonge ukuba oku kusenokuba yingxaki:',
		footer: 'Nceda ujonge ezi zinto uze uxelele u-Alex oko ukufumeneyo. Oku kunceda ukuphepha ukutsalwa kwemali okungachananga kumvuzo wakho.'
	}
};
function getStockDifference() {
	const zoho = state.cashUpZoho || {};
	return Math.round(((state.cashUpSalesValue || 0) - (Number(zoho.zohoTotalSales) || 0)) * 100) / 100;
}
function updateCausesSection() {
	const box = document.getElementById('causesBox');
	if (!box) return;
	if (!state.causesChecked) state.causesChecked = {};

	const cashDiff = state.cashUpLastDiff || 0;
	const stockDiff = getStockDifference();

	function renderList(key, title, list) {
		const items = list.map((text, idx) => {
			const id = key + '_' + idx;
			const checked = state.causesChecked[id] ? 'checked' : '';
			return `<label style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;font-size:14px;">
				<input type="checkbox" id="cause_${id}" ${checked} onchange="toggleCause('${id}', this.checked)" style="margin-top:3px;width:18px;height:18px;flex-shrink:0;">
				<span>${text}</span>
			</label>`;
		}).join('');
		return `<div style="margin-bottom:14px;"><div style="font-weight:700;margin-bottom:4px;">${title}</div>${items}</div>`;
	}

	let sections = '';
	if (cashDiff < -0.005) sections += renderList('cashShort', 'Possible Causes — Cash Short', CAUSE_LISTS.cashShort);
	if (cashDiff > 0.005) sections += renderList('cashOver', 'Possible Causes — Cash Over', CAUSE_LISTS.cashOver);
	if (Math.abs(stockDiff) > 0.005) sections += renderList('stockDiff', 'Possible Causes — Stock Difference', CAUSE_LISTS.stockDiff);

	if (!sections) {
		box.style.display = 'none';
		box.innerHTML = '';
		return;
	}
	if (!state.reportLang) state.reportLang = 'en';
	box.style.display = 'block';
	box.innerHTML = `
		<div style="padding:16px;background:var(--card);border:1px solid var(--border);border-radius:8px;">
			<h3 style="margin-bottom:6px;">Difference Causes</h3>
			<div style="font-size:12px;color:var(--muted);margin-bottom:12px;">Tick off anything you've already checked — this is for your own reference and is not sent to the sales rep.</div>
			${sections}
			<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);">
				<div style="font-size:12px;color:var(--muted);margin-bottom:6px;">Report language for the PDF you send to the sales rep:</div>
				<div style="display:flex;gap:16px;align-items:center;">
					<label style="font-size:14px;display:flex;align-items:center;gap:6px;">
						<input type="radio" name="reportLang" value="en" ${state.reportLang !== 'xh' ? 'checked' : ''} onchange="state.reportLang='en';">
						English
					</label>
					<label style="font-size:14px;display:flex;align-items:center;gap:6px;">
						<input type="radio" name="reportLang" value="xh" ${state.reportLang === 'xh' ? 'checked' : ''} onchange="state.reportLang='xh';">
						isiXhosa
					</label>
				</div>
			</div>
			<div style="text-align:right;margin-top:12px;">
				<button class="btn btn-secondary" style="font-size:13px;padding:8px 14px;" onclick="shareCausesPdf()">📄 Share Report PDF</button>
			</div>
		</div>
	`;
}
function causesCheckedStorageKey(date, routeName) {
	return 'fenmeat_causesChecked_' + date + '_' + routeName;
}
function toggleCause(id, checked) {
	if (!state.causesChecked) state.causesChecked = {};
	state.causesChecked[id] = checked;
	try {
		const routeName = state.activeRoute;
		localStorage.setItem(causesCheckedStorageKey(state.date, routeName), JSON.stringify(state.causesChecked));
	} catch (e) {
		// localStorage unavailable/full -- ticks just won't persist, don't block the app
	}
}
async function shareCausesPdf() {
	if (typeof window.jspdf === 'undefined') {
		showToast('⚠️ PDF library not loaded — check internet connection and try again', 'error');
		return;
	}
	const lang = state.reportLang === 'xh' ? 'xh' : 'en';
	const T = REPORT_I18N[lang];
	const causeList = lang === 'xh' ? CAUSE_LISTS_XH : CAUSE_LISTS;

	const { jsPDF } = window.jspdf;
	const doc = new jsPDF({ unit: 'pt', format: 'a4' });
	const route = state.activeRoute;
	const date = state.date;
	const cashDiff = state.cashUpLastDiff || 0;
	const stockDiff = getStockDifference();

	// ADDED 3 Aug 2026 -- Sales Person name(s) for the report header. Flat-rate
	// routes (Riversdale/Oudtshoorn/Stilbaai) have two salespeople splitting
	// the pool, so both names are joined; standard routes have one dropdown.
	let salesPersonDisplay = '';
	if (state.cashUpFlatRate) {
		const sp1El = document.getElementById('salesPerson1Select');
		const sp2El = document.getElementById('salesPerson2Select');
		const names = [sp1El && sp1El.value, sp2El && sp2El.value].filter(Boolean);
		salesPersonDisplay = names.join(' & ');
	} else {
		const spEl = document.getElementById('salesPersonInput');
		salesPersonDisplay = (spEl && spEl.value) || '';
	}

	showToast('📄 Building report...', '');

	// Pull fresh per-product Zoho invoiced quantities for this route/date
	// (same endpoint the Evening screen's ZOHO column already calls), so
	// the report can name exact products rather than one lump Rand figure.
	let zohoMap = {};
	try {
		const url = `${SCRIPT_URL}?action=getZohoItemSales&route=${encodeURIComponent(route)}&date=${date}&sheetId=${NEW_SHEET_ID}`;
		const resp = await fetch(url);
		const data = await resp.json();
		if (data.status === 'ok') {
			(data.products || []).forEach(p => { zohoMap[p.code] = p.zohoQty; });
		}
	} catch (e) {
		// No connection -- report will still generate, just without the
		// product-level breakdown (falls back to the Rand total only).
	}

	const products = (state.routeData[route] && state.routeData[route].products) || [];
	const productDiffs = [];
	products.forEach(p => {
		const sold = p.out - p.inQty;
		if (!zohoMap.hasOwnProperty(p.code)) return;
		const zohoQty = zohoMap[p.code];
		if (sold === zohoQty) return;
		productDiffs.push({ name: p.name, sold, zoho: zohoQty, diff: Math.abs(sold - zohoQty), deliveredNotInvoiced: sold > zohoQty });
	});

	// REDESIGNED 5 August 2026 -- report was plain black-on-white text with no
	// visual hierarchy (Alex: "hard to read, doesn't look professional"). Now
	// uses a branded header band, a route/date/sales-person info card, colour
	// tagged section headings, real drawn checkboxes (not relying on unicode
	// glyph support in jsPDF's default font), coloured status dots on the
	// per-product stock lines, page-break handling for long reports, and a
	// page-numbered footer -- matching the Elevated Precision palette already
	// used across the app (Royal Blue #003CFF / #0026B3, functional colours
	// for success/warning/danger). HEADER_LOGO_B64 is the same PNG constant
	// already embedded in this file for the on-screen app header (defined
	// near the top of index.html); its natural aspect ratio is 1600x390.
	const PAGE_W = doc.internal.pageSize.getWidth();
	const PAGE_H = doc.internal.pageSize.getHeight();
	const MARGIN = 40;
	const CONTENT_W = PAGE_W - MARGIN * 2;
	// FIXED 5 August 2026 -- HEADER_LOGO_B64 is a "3D bevel" logo (blue FEN +
	// white/grey MEAT with drop-shadow bevels) designed to sit on the app's
	// dark Charcoal->Steel header background (see .header CSS, ~line 53) --
	// NOT on solid Royal Blue. Placed directly on Royal Blue (the original
	// version of this redesign), the blue FEN lettering disappeared into the
	// backdrop and the grey bevel shading on MEAT read as a pixelated mess
	// (confirmed via Alex's screenshot of the live PDF). CHARCOAL/STEEL here
	// match the on-screen header's CSS variables exactly (--charcoal:#12141C,
	// --steel:#262B38), so the PDF header is now the same treatment as every
	// other header in the app, and the logo renders correctly again.
	const CHARCOAL = [18, 20, 28];
	const STEEL = [38, 43, 56];
	const BRAND = [0, 60, 255];
	const BRAND_DEEP = [0, 38, 179];
	const INK = [30, 32, 40];
	const MUTED = [110, 116, 130];
	const BORDER = [221, 225, 234];
	const CARD_BG = [246, 247, 250];
	const SUCCESS = [29, 138, 92];
	const WARNING = [193, 120, 14];
	const DANGER = [178, 58, 58];
	const FOOTER_SAFE = 60;

	let y = 0;

	function setColor(c) { doc.setTextColor(c[0], c[1], c[2]); }
	function setFillC(c) { doc.setFillColor(c[0], c[1], c[2]); }
	function setDrawC(c) { doc.setDrawColor(c[0], c[1], c[2]); }

	function drawHeaderBand() {
		const headerH = 88;
		// Soft vertical gradient CHARCOAL -> STEEL (jsPDF has no native
		// gradient fill, so this is faked with thin interpolated bands --
		// same visual direction as the on-screen header's CSS gradient).
		const bands = 28;
		for (let i = 0; i < bands; i++) {
			const t = i / (bands - 1);
			const r = Math.round(CHARCOAL[0] + (STEEL[0] - CHARCOAL[0]) * t);
			const g = Math.round(CHARCOAL[1] + (STEEL[1] - CHARCOAL[1]) * t);
			const b = Math.round(CHARCOAL[2] + (STEEL[2] - CHARCOAL[2]) * t);
			doc.setFillColor(r, g, b);
			const bandH = headerH / bands;
			doc.rect(0, i * bandH, PAGE_W, bandH + 0.5, 'F');
		}
		setFillC(BRAND);
		doc.rect(0, headerH, PAGE_W, 3, 'F');
		try {
			doc.addImage(HEADER_LOGO_B64, 'PNG', MARGIN, 24, 114.9, 28);
		} catch (e) {
			doc.setFont(undefined, 'bold');
			doc.setFontSize(20);
			setColor([255, 255, 255]);
			doc.text('FenMeat', MARGIN, 46);
		}
		doc.setFont(undefined, 'bold');
		doc.setFontSize(13);
		setColor([255, 255, 255]);
		doc.text(T.heading, MARGIN, 70);
		doc.setFont(undefined, 'normal');
		setColor(INK);
	}

	function drawInfoCard() {
		const cardH = 50;
		setFillC(CARD_BG);
		setDrawC(BORDER);
		doc.setLineWidth(0.75);
		doc.roundedRect(MARGIN, y, CONTENT_W, cardH, 6, 6, 'FD');
		const cols = [
			{ label: T.route, value: route },
			{ label: T.date, value: date },
			{ label: T.salesPerson, value: salesPersonDisplay || '—' }
		];
		const colW = CONTENT_W / cols.length;
		cols.forEach((c, i) => {
			const cx = MARGIN + i * colW + 18;
			doc.setFont(undefined, 'bold');
			doc.setFontSize(8);
			setColor(MUTED);
			doc.text(String(c.label).toUpperCase(), cx, y + 19);
			doc.setFont(undefined, 'bold');
			doc.setFontSize(12.5);
			setColor(INK);
			const valLines = doc.splitTextToSize(String(c.value), colW - 24);
			doc.text(valLines[0], cx, y + 37);
			if (i > 0) {
				setDrawC(BORDER);
				doc.setLineWidth(0.75);
				doc.line(MARGIN + i * colW, y + 12, MARGIN + i * colW, y + cardH - 12);
			}
		});
		doc.setFont(undefined, 'normal');
		y += cardH + 30;
	}

	// REDESIGNED 5 August 2026 -- Alex: "rest of the document looks like a
	// cheap copy and paste attempt (headings are crammed etc.)". The whole
	// body below the header/info card was rebuilt around real bordered/tinted
	// CARDS (measure content height first, then draw the card, then draw
	// content inside it with generous internal padding) instead of loose
	// text with only small fixed gaps -- this is what was actually causing
	// the cramped feel, not the header. Product lines and checklist rows are
	// bounded in count (max ~31 products, max ~6 causes per category) so
	// precomputing a card's full height up front is safe and never risks an
	// unbounded/never-fitting box.
	const PAD = 16;

	function tint(c, amt) {
		return [
			Math.round(c[0] + (255 - c[0]) * amt),
			Math.round(c[1] + (255 - c[1]) * amt),
			Math.round(c[2] + (255 - c[2]) * amt)
		];
	}

	function newPage() {
		doc.addPage();
		y = MARGIN;
		doc.setFont(undefined, 'bold');
		doc.setFontSize(9);
		setColor(MUTED);
		doc.text(`${T.heading} — ${route} — ${date}`, MARGIN, y);
		setDrawC(BORDER);
		doc.setLineWidth(0.5);
		doc.line(MARGIN, y + 8, PAGE_W - MARGIN, y + 8);
		doc.setFont(undefined, 'normal');
		setColor(INK);
		y += 26;
	}

	function checkSpace(h) {
		if (y + h > PAGE_H - FOOTER_SAFE) newPage();
	}

	// Wraps text against the CURRENTLY SET font/size, matching jsPDF's own
	// metric-dependent splitTextToSize behaviour -- callers must setFont/
	// setFontSize before calling this (measure and draw use the same font
	// state so wrapping is identical both times).
	function wrapAt(text, width) {
		return doc.splitTextToSize(text, width);
	}

	function sectionHeading(text, color) {
		if (!text) return;
		checkSpace(30);
		setFillC(color);
		doc.roundedRect(MARGIN, y, 5, 15, 1.5, 1.5, 'F');
		doc.setFont(undefined, 'bold');
		doc.setFontSize(13.5);
		setColor(INK);
		doc.text(text, MARGIN + 13, y + 11.5);
		doc.setFont(undefined, 'normal');
		setColor(INK);
		y += 30;
	}

	// A short tinted callout card for the one-sentence explanation at the
	// top of each section (e.g. "Cash was over by R2023.00..."). Always
	// bounded to a couple of lines, so height is safe to precompute.
	function calloutCard(text, color) {
		doc.setFont(undefined, 'normal');
		doc.setFontSize(10.5);
		const innerW = CONTENT_W - PAD * 2 - 5;
		const lines = wrapAt(text, innerW);
		const leading = 15;
		const cardH = PAD * 2 - 4 + lines.length * leading;
		checkSpace(cardH + 8);
		setFillC(tint(color, 0.92));
		setDrawC(tint(color, 0.72));
		doc.setLineWidth(0.75);
		doc.roundedRect(MARGIN, y, CONTENT_W, cardH, 6, 6, 'FD');
		setFillC(color);
		doc.rect(MARGIN, y, 4, cardH, 'F');
		setColor(INK);
		let ty = y + PAD - 4;
		lines.forEach(line => {
			ty += leading;
			doc.text(line, MARGIN + PAD + 5, ty);
		});
		y += cardH + 16;
	}

	function drawCheckbox(cx, cyTop, checked) {
		const s = 9;
		const cyBox = cyTop - s + 2;
		if (checked) {
			setFillC(SUCCESS);
			setDrawC(SUCCESS);
			doc.roundedRect(cx, cyBox, s, s, 2, 2, 'FD');
			doc.setDrawColor(255, 255, 255);
			doc.setLineWidth(1.2);
			doc.line(cx + 1.8, cyBox + 4.6, cx + 3.6, cyBox + 6.4);
			doc.line(cx + 3.6, cyBox + 6.4, cx + 7.2, cyBox + 2);
		} else {
			doc.setFillColor(255, 255, 255);
			setDrawC(BORDER);
			doc.setLineWidth(1);
			doc.roundedRect(cx, cyBox, s, s, 2, 2, 'FD');
		}
		doc.setLineWidth(0.75);
	}

	// A tinted checklist card, grouped ("still to check" / "already
	// checked"). Total height is precomputed from the bounded item list so
	// the whole card is checked/paginated as one unit -- never splits a
	// checkbox row awkwardly across a page break.
	function checklistCard(label, items, checked, accentColor) {
		if (!items.length) return;
		const textIndent = PAD + 18;
		const innerW = CONTENT_W - textIndent - PAD;
		doc.setFontSize(10);
		const rowLeading = 14.5;
		let itemsH = 0;
		const wrapped = items.map(t => {
			const lines = wrapAt(t, innerW);
			itemsH += lines.length * rowLeading + 6;
			return lines;
		});
		const labelH = 22;
		const cardH = PAD + labelH + itemsH + PAD - 6;
		checkSpace(cardH + 8);
		setFillC(checked ? tint(SUCCESS, 0.95) : [250, 250, 251]);
		setDrawC(BORDER);
		doc.setLineWidth(0.75);
		doc.roundedRect(MARGIN, y, CONTENT_W, cardH, 6, 6, 'FD');
		doc.setFont(undefined, 'bold');
		doc.setFontSize(8.5);
		setColor(checked ? SUCCESS : MUTED);
		doc.text(String(label).toUpperCase(), MARGIN + PAD, y + PAD + 2);
		doc.setFont(undefined, 'normal');
		setColor(INK);
		let iy = y + PAD + labelH;
		wrapped.forEach(lines => {
			drawCheckbox(MARGIN + PAD, iy + 10, checked);
			doc.setFontSize(10);
			lines.forEach(line => {
				doc.text(line, MARGIN + textIndent, iy + 10);
				iy += rowLeading;
			});
			iy += 6;
		});
		y += cardH + 16;
	}

	// One product-diff row: bold product name + figures on the first line,
	// a lighter explanatory line below, and a light divider under each row.
	// Individually paginated (checkSpace per row) since the product count is
	// data-driven and can genuinely run long on a bad day.
	function productRow(pd, isLast) {
		const sentence = pd.deliveredNotInvoiced
			? T.deliveredNotInvoiced(pd.name, pd.sold, pd.zoho, pd.diff)
			: T.invoicedNotDelivered(pd.name, pd.sold, pd.zoho, pd.diff);
		const colonIdx = sentence.indexOf(':');
		const title = colonIdx > -1 ? sentence.slice(0, colonIdx) : pd.name;
		const rest = colonIdx > -1 ? sentence.slice(colonIdx + 1).trim() : sentence;
		const textIndent = 16;
		const innerW = CONTENT_W - textIndent;
		doc.setFont(undefined, 'bold');
		doc.setFontSize(10.5);
		const titleLines = wrapAt(title, innerW);
		doc.setFont(undefined, 'normal');
		doc.setFontSize(9.5);
		const restLines = wrapAt(rest, innerW);
		const rowH = titleLines.length * 14 + restLines.length * 13 + 12;
		checkSpace(rowH + 4);
		setFillC(pd.deliveredNotInvoiced ? BRAND : DANGER);
		doc.circle(MARGIN + 4, y + 9, 3, 'F');
		doc.setFont(undefined, 'bold');
		doc.setFontSize(10.5);
		setColor(INK);
		let ty = y;
		titleLines.forEach(line => {
			doc.text(line, MARGIN + textIndent, ty + 10);
			ty += 14;
		});
		doc.setFont(undefined, 'normal');
		doc.setFontSize(9.5);
		setColor(MUTED);
		restLines.forEach(line => {
			doc.text(line, MARGIN + textIndent, ty + 9);
			ty += 13;
		});
		setColor(INK);
		y = ty + 8;
		if (!isLast) {
			setDrawC(BORDER);
			doc.setLineWidth(0.5);
			doc.line(MARGIN + textIndent, y - 4, PAGE_W - MARGIN, y - 4);
		}
	}

	// ---------- Draw ----------
	drawHeaderBand();
	y = 112;
	drawInfoCard();

	// --- Cash section ---
	const cashColor = cashDiff < -0.005 ? DANGER : (cashDiff > 0.005 ? WARNING : SUCCESS);
	const cashHeading = cashDiff < -0.005 ? T.causesHeaderShort : (cashDiff > 0.005 ? T.causesHeaderOver : '');
	sectionHeading(cashHeading, cashColor);
	if (cashDiff < -0.005) calloutCard(T.cashShort(Math.abs(cashDiff).toFixed(2)), DANGER);
	else if (cashDiff > 0.005) calloutCard(T.cashOver(cashDiff.toFixed(2)), WARNING);
	else calloutCard(T.cashMatched, SUCCESS);

	if (Math.abs(cashDiff) > 0.005) {
		const key = cashDiff < 0 ? 'cashShort' : 'cashOver';
		const list = causeList[key];
		const checkedItems = [], uncheckedItems = [];
		list.forEach((text, idx) => {
			const id = key + '_' + idx;
			(state.causesChecked && state.causesChecked[id] ? checkedItems : uncheckedItems).push(text);
		});
		checklistCard(T.stillToCheck, uncheckedItems, false, cashColor);
		checklistCard(T.alreadyChecked, checkedItems, true, cashColor);
	}

	// --- Stock section ---
	checkSpace(34);
	y += 6;
	setDrawC(BORDER);
	doc.setLineWidth(0.5);
	doc.line(MARGIN, y, PAGE_W - MARGIN, y);
	y += 22;
	sectionHeading(T.causesHeaderStock, BRAND);
	if (Math.abs(stockDiff) > 0.005) {
		calloutCard(T.stockIntro, BRAND);
		if (productDiffs.length) {
			checkSpace(20);
			doc.setFont(undefined, 'bold');
			doc.setFontSize(9);
			setColor(MUTED);
			doc.text(String(T.productHeader).toUpperCase(), MARGIN, y + 6);
			doc.setFont(undefined, 'normal');
			setColor(INK);
			y += 18;
			productDiffs.forEach((pd, idx) => {
				productRow(pd, idx === productDiffs.length - 1);
			});
			y += 10;
		}
		const key = 'stockDiff';
		const list = causeList[key];
		const checkedItems = [], uncheckedItems = [];
		list.forEach((text, idx) => {
			const id = key + '_' + idx;
			(state.causesChecked && state.causesChecked[id] ? checkedItems : uncheckedItems).push(text);
		});
		checklistCard(T.stillToCheck, uncheckedItems, false, BRAND);
		checklistCard(T.alreadyChecked, checkedItems, true, BRAND);
	} else {
		calloutCard(T.stockMatched, SUCCESS);
	}

	checkSpace(40);
	y += 6;
	setDrawC(BORDER);
	doc.setLineWidth(0.5);
	doc.line(MARGIN, y, PAGE_W - MARGIN, y);
	y += 18;
	doc.setFont(undefined, 'italic');
	doc.setFontSize(9);
	setColor(MUTED);
	const footerLines = doc.splitTextToSize(T.footer, CONTENT_W);
	footerLines.forEach(line => {
		checkSpace(13);
		doc.text(line, MARGIN, y + 9);
		y += 13;
	});
	doc.setFont(undefined, 'normal');
	setColor(INK);

	// ---------- Footer bar (finalize across all pages) ----------
	// FIXED 5 August 2026 -- a thin grey rule + tiny muted text left a large,
	// unbalanced blank gap at the bottom of short reports (nothing anchoring
	// the page). Replaced with a solid Charcoal footer bar mirroring the
	// header, which bookends the page and reads as a deliberately finished
	// document rather than content that simply ran out partway down the page.
	const totalPages = doc.internal.getNumberOfPages();
	const footerH = 26;
	for (let p = 1; p <= totalPages; p++) {
		doc.setPage(p);
		setFillC(CHARCOAL);
		doc.rect(0, PAGE_H - footerH, PAGE_W, footerH, 'F');
		setFillC(BRAND);
		doc.rect(0, PAGE_H - footerH, PAGE_W, 2, 'F');
		doc.setFont(undefined, 'normal');
		doc.setFontSize(8);
		setColor([201, 205, 214]);
		doc.text('FenMeat Sales App', MARGIN, PAGE_H - footerH / 2 + 3);
		doc.text(`${p} / ${totalPages}`, PAGE_W - MARGIN, PAGE_H - footerH / 2 + 3, { align: 'right' });
		setColor(INK);
	}

	const blob = doc.output('blob');
	const langSuffix = lang === 'xh' ? 'XH' : 'EN';
	const fileName = `FenMeat_${route}_${date}_Report_${langSuffix}.pdf`;
	const pdfFile = new File([blob], fileName, { type: 'application/pdf' });

	if (navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
		try {
			await navigator.share({
				files: [pdfFile],
				title: 'FenMeat Report',
				text: `${T.heading} — ${route} — ${date}`
			});
			return;
		} catch (e) {
			// User cancelled the share sheet, or share failed — fall through to download
		}
	}
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = fileName;
	a.click();
	showToast('📄 PDF downloaded — share it via WhatsApp manually', '');
}
