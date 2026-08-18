function parseCreditValue(el) {
	return el ? (Number(String(el.value).replace(/\s/g, '')) || 0) : 0;
}
function stripCreditInputFormatting(el) {
	el.value = el.value.replace(/\s/g, '');
}
function formatCreditInputOnBlur(el) {
	if (!el || el.value.trim() === '') return;
	const num = parseCreditValue(el);
	el.value = Number.isInteger(num) ? formatRand(num) : formatRand(num, 2);
}
function updateCommissionDisplay() {
	const commissionEl = document.getElementById('commissionVal');
	if (!commissionEl) return;
	// Added 22 July 2026 -- RIVERSDALE / OUDTSHOORN / STILBAAI: R5 per item sold
	// (excl. Six Gun 200g), split 50/50 between the two chosen sales people.
	if (state.cashUpFlatRate) {
		const itemsSold = state.cashUpItemsSold || 0;
		const pool = Math.round(itemsSold * 5 * 100) / 100;
		const each = Math.round((pool / 2) * 100) / 100;
		const poolEl = document.getElementById('commissionPoolVal');
		if (poolEl) poolEl.textContent = `R ${formatRand(pool, 2)}`;
		commissionEl.textContent = `R ${formatRand(each, 2)} each`;
		return;
	}
	const currentEl = document.getElementById('currentCreditInput');
	const totalEl = document.getElementById('totalCreditInput');
	const currentCredit = parseCreditValue(currentEl);
	const totalCredit = parseCreditValue(totalEl);
	const overdueCredit = Math.max(0, Math.round((totalCredit - currentCredit) * 100) / 100);

	const overdueDisplayEl = document.getElementById('overdueCreditDisplay');
	if (overdueDisplayEl) overdueDisplayEl.textContent = `R ${formatRand(overdueCredit, 2)}`;

	// ADDED 6 August 2026 -- Cash Shortfall / Stock Shortfall deductions.
	// Alex: cash short, or a net stock VALUE shortfall (not unit count),
	// gets deducted from commission -- usually caused by staff not checking
	// what was delivered against the invoice. Cash Shortfall reuses the
	// existing Cash Difference figure (state.cashUpLastDiff) when it's
	// short (negative). Stock Shortfall reuses the existing Stock vs Zoho
	// Variance figure (getStockDifference()) ONLY when it's Blue/positive
	// (Delivered not Invoiced = stock physically left worth more than what
	// was invoiced) -- Red/negative (Invoiced not Delivered) is explicitly
	// ignored per Alex's instruction. Both rows stay hidden unless their
	// shortfall is actually nonzero, and each has its own "Resolved"
	// checkbox -- once Alex ticks it (after the rep sorts out the mistake),
	// that shortfall's deduction becomes R0, both in this display and in
	// what gets saved to COMMISSION_LOG when Save Cash Up is pressed.
	const cashDiffForShortfall = state.cashUpLastDiff || 0;
	const cashShortfall = cashDiffForShortfall < -0.005 ? Math.round(Math.abs(cashDiffForShortfall) * 100) / 100 : 0;
	const stockDiffForShortfall = typeof getStockDifference === 'function' ? getStockDifference() : 0;
	const stockShortfall = stockDiffForShortfall > 0.005 ? Math.round(stockDiffForShortfall * 100) / 100 : 0;

	const cashShortfallRow = document.getElementById('cashShortfallRow');
	const cashShortfallValEl = document.getElementById('cashShortfallVal');
	const cashShortfallResolvedEl = document.getElementById('cashShortfallResolved');
	if (cashShortfallRow) {
		cashShortfallRow.style.display = cashShortfall > 0 ? 'flex' : 'none';
		if (cashShortfallValEl) cashShortfallValEl.textContent = `R ${formatRand(cashShortfall, 2)}`;
	}

	const stockShortfallRow = document.getElementById('stockShortfallRow');
	const stockShortfallValEl = document.getElementById('stockShortfallVal');
	const stockShortfallResolvedEl = document.getElementById('stockShortfallResolved');
	if (stockShortfallRow) {
		stockShortfallRow.style.display = stockShortfall > 0 ? 'flex' : 'none';
		if (stockShortfallValEl) stockShortfallValEl.textContent = `R ${formatRand(stockShortfall, 2)}`;
	}

	const cashShortfallDeduction = (cashShortfallResolvedEl && cashShortfallResolvedEl.checked) ? 0 : cashShortfall;
	const stockShortfallDeduction = (stockShortfallResolvedEl && stockShortfallResolvedEl.checked) ? 0 : stockShortfall;

	const salesValue = state.cashUpSalesValue || 0;
	const baseCommission = (salesValue - overdueCredit) * 0.007;
	const commission = Math.max(0, Math.round((baseCommission - cashShortfallDeduction - stockShortfallDeduction) * 100) / 100);
	commissionEl.textContent = `R ${formatRand(commission, 2)}`;
}
function getWeekEndingFridayJS(dateStr) {
	const d = new Date(dateStr + 'T12:00:00');
	const dow = d.getDay(); // 0=Sun...6=Sat
	let diffToFriday;
	if (dow >= 1 && dow <= 5) {
		diffToFriday = 5 - dow;
	} else {
		diffToFriday = (dow === 6) ? -1 : 5;
	}
	d.setDate(d.getDate() + diffToFriday);
	const yyyy = d.getFullYear();
	const mm = String(d.getMonth()+1).padStart(2,'0');
	const dd = String(d.getDate()).padStart(2,'0');
	return `${yyyy}-${mm}-${dd}`;
}
function renderCommission() {
	const defaultWeekEnding = getWeekEndingFridayJS(state.date || new Date().toISOString().split('T')[0]);

	document.getElementById('mainContent').innerHTML = `
		<div class="summary-card">
			<div class="summary-title">🧾 Weekly Commission</div>
			<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
				<label style="font-size:13px;font-weight:600;">Week Ending (Friday):</label>
				<input type="date" id="commissionWeekInput" value="${defaultWeekEnding}"
					style="padding:8px;border:1px solid var(--border);border-radius:6px;font-size:14px;">
			</div>
			<div class="action-bar" style="margin-bottom:0;">
				<button class="btn btn-primary" onclick="calculateWeekCommissionClick()">🧮 Calculate Week's Commission</button>
			</div>
		</div>

		<div id="commissionResults"></div>

		<div class="summary-card">
			<div class="summary-title">📅 Past Weeks</div>
			<div id="commissionHistory">
				<button class="btn btn-secondary" onclick="loadCommissionHistory()">Show Past Weeks</button>
			</div>
		</div>
	`;
}
function snapToFridayIfNeeded(dateStr) {
	return getWeekEndingFridayJS(dateStr);
}
async function calculateWeekCommissionClick() {
	const raw = document.getElementById('commissionWeekInput').value;
	if (!raw) {
		showToast('⚠️ Pick a week ending date first', 'error');
		return;
	}
	const weekEnding = snapToFridayIfNeeded(raw);
	document.getElementById('commissionWeekInput').value = weekEnding;

	document.getElementById('commissionResults').innerHTML = `<div class="loading"><div class="spinner"></div>Calculating...</div>`;

	try {
		const resp = await fetch(SCRIPT_URL, {
			method: 'POST',
			headers: {'Content-Type': 'text/plain'},
			body: JSON.stringify({
				action: 'calculateWeekCommission',
				sheetId: NEW_SHEET_ID,
				weekEnding: weekEnding
			})
		});
		const data = await resp.json();
		if (data.status === 'ok') {
			renderCommissionResults(weekEnding, data.results);
		} else {
			document.getElementById('commissionResults').innerHTML = `<div class="summary-card" style="color:var(--red);">❌ ${data.message}</div>`;
		}
	} catch (err) {
		document.getElementById('commissionResults').innerHTML = `<div class="summary-card" style="color:var(--red);">❌ Could not calculate: ${err.message}</div>`;
	}
}
function renderCommissionResults(weekEnding, results) {
	const box = document.getElementById('commissionResults');
	if (!results || results.length === 0) {
		box.innerHTML = `<div class="summary-card">No commission entries saved for week ending ${weekEnding} yet — save Cash Up with a Sales Person on each route first.</div>`;
		return;
	}
	const grandTotal = results.reduce((s, r) => s + r.totalCommission, 0);
	box.innerHTML = `
		<div class="summary-card">
			<div class="summary-title">Week Ending ${weekEnding}</div>
			${results.map(r => `
				<div class="summary-row">
					<span>${r.salesperson} <span style="color:var(--muted);font-size:11px;">(${r.routeCount} route${r.routeCount === 1 ? '' : 's'})</span></span>
					<span class="summary-total">R ${formatRand(r.totalCommission, 2)}</span>
				</div>
			`).join('')}
			<div class="summary-row" style="border-top:2px solid var(--dark);margin-top:6px;padding-top:10px;font-weight:800;">
				<span>Total</span>
				<span class="summary-total">R ${formatRand(grandTotal, 2)}</span>
			</div>
		</div>
	`;
}
async function loadCommissionHistory() {
	const box = document.getElementById('commissionHistory');
	box.innerHTML = `<div class="loading"><div class="spinner"></div>Loading...</div>`;
	try {
		const resp = await fetch(`${SCRIPT_URL}?action=getWeeklyCommission&sheetId=${NEW_SHEET_ID}`);
		const data = await resp.json();
		const weeks = data.weeks || [];
		if (weeks.length === 0) {
			box.innerHTML = `<div style="color:var(--muted);">No past weeks calculated yet.</div>`;
			return;
		}
		box.innerHTML = weeks.map(w => `
			<div class="summary-row" style="cursor:pointer;" onclick="viewCommissionWeek('${w.weekEnding}')">
				<span>Week Ending ${w.weekEnding}</span>
				<span class="summary-total">R ${formatRand(w.totalCommission, 2)}</span>
			</div>
		`).join('');
	} catch (err) {
		box.innerHTML = `<div style="color:var(--red);">Could not load history: ${err.message}</div>`;
	}
}
async function viewCommissionWeek(weekEnding) {
	document.getElementById('commissionWeekInput').value = weekEnding;
	document.getElementById('commissionResults').innerHTML = `<div class="loading"><div class="spinner"></div>Loading week ${weekEnding}...</div>`;
	try {
		const resp = await fetch(`${SCRIPT_URL}?action=getWeeklyCommission&weekEnding=${weekEnding}&sheetId=${NEW_SHEET_ID}`);
		const data = await resp.json();
		if (data.status === 'ok') {
			renderCommissionResults(weekEnding, data.results);
		}
	} catch (err) {
		document.getElementById('commissionResults').innerHTML = `<div class="summary-card" style="color:var(--red);">❌ Could not load week: ${err.message}</div>`;
	}
	window.scrollTo({top: 0, behavior: 'smooth'});
}
