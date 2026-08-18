async function renderCashUp(route, totalValue, itemsSoldExclS02) {
	state.cashUpSalesValue = totalValue;
	state.cashUpItemsSold = itemsSoldExclS02 || 0;
	// Added 22 July 2026 -- RIVERSDALE / OUDTSHOORN / STILBAAI use a flat R5-per-item
	// (excl. Six Gun 200g) commission split 50/50 between two chosen sales people,
	// instead of the usual 0.7%-of-sales-value single-person commission.
	const FLAT_RATE_ROUTES = ['RIVERSDALE', 'OUDTSHOORN', 'STILBAAI'];
	const SALES_PEOPLE = ['Tapiz', 'Mosa', 'Albert'];
	const isFlatRate = FLAT_RATE_ROUTES.includes(route.name.toUpperCase());
	state.cashUpFlatRate = isFlatRate;
	function spOptionsHtml(selectedVal) {
		return '<option value="">Select...</option>' + SALES_PEOPLE.map(function(name) {
			return '<option value="' + name + '"' + (name === selectedVal ? ' selected' : '') + '>' + name + '</option>';
		}).join('');
	}
	const commissionBoxHtml = isFlatRate ? `
		<h3 style="margin-bottom:10px;">Sales Commission (R5 per item, excl. Six Gun 200g)</h3>
		<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;color:var(--muted);">
			<span>Items Sold (excl. Six Gun 200g)</span><span id="itemsSoldDisplay">${itemsSoldExclS02 || 0}</span>
		</div>
		<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;color:var(--muted);">
			<span>Total Commission Pool</span><span id="commissionPoolVal">R 0.00</span>
		</div>
		<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;">
			<span style="font-weight:600;">Sales Person 1</span>
			<select id="salesPerson1Select" style="width:160px;padding:8px;font-size:15px;text-align:right;border:1px solid var(--border);border-radius:6px;" onchange="updateCommissionDisplay()">${spOptionsHtml('')}</select>
		</div>
		<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;">
			<span style="font-weight:600;">Sales Person 2</span>
			<select id="salesPerson2Select" style="width:160px;padding:8px;font-size:15px;text-align:right;border:1px solid var(--border);border-radius:6px;" onchange="updateCommissionDisplay()">${spOptionsHtml('')}</select>
		</div>
		<div style="display:flex;justify-content:space-between;padding:8px 0;font-weight:700;font-size:16px;">
			<span>Commission (each)</span><span id="commissionVal">—</span>
		</div>
	` : `
		<h3 style="margin-bottom:10px;">Sales Commission</h3>
		<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;">
			<span style="font-weight:600;">Sales Person</span>
			<select id="salesPersonInput" style="width:160px;padding:8px;font-size:15px;text-align:right;border:1px solid var(--border);border-radius:6px;" onchange="updateCommissionDisplay()">${spOptionsHtml('')}</select>
		</div>
		<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;">
			<span style="font-size:13px;color:var(--muted);">Current Credit for Today</span>
			<input type="text" inputmode="decimal" id="currentCreditInput" placeholder="0.00"
				style="width:120px;padding:7px 8px;font-size:14px;text-align:right;border:1px solid var(--border);border-radius:6px;"
				oninput="updateCommissionDisplay()" onfocus="stripCreditInputFormatting(this)" onblur="formatCreditInputOnBlur(this); updateCommissionDisplay()">
		</div>
		<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;">
			<span style="font-size:13px;color:var(--muted);">Total Credit Outstanding</span>
			<input type="text" inputmode="decimal" id="totalCreditInput" placeholder="0.00"
				style="width:120px;padding:7px 8px;font-size:14px;text-align:right;border:1px solid var(--border);border-radius:6px;"
				oninput="updateCommissionDisplay()" onfocus="stripCreditInputFormatting(this)" onblur="formatCreditInputOnBlur(this); updateCommissionDisplay()">
		</div>
		<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;font-size:13px;color:var(--muted);">
			<span>Overdue Credit (from Age Analysis)</span><span id="overdueCreditDisplay">R 0.00</span>
		</div>
		<div id="cashShortfallRow" style="display:none;align-items:center;justify-content:space-between;padding:6px 0;font-size:13px;color:var(--red);border-top:1px solid var(--border);margin-top:6px;">
			<span>Cash Shortfall</span>
			<span style="display:flex;align-items:center;gap:10px;">
				<span id="cashShortfallVal">R 0.00</span>
				<label style="display:flex;align-items:center;gap:4px;font-size:11px;font-weight:600;color:var(--text);cursor:pointer;">
					<input type="checkbox" id="cashShortfallResolved" onchange="updateCommissionDisplay()"> Resolved
				</label>
			</span>
		</div>
		<div id="stockShortfallRow" style="display:none;align-items:center;justify-content:space-between;padding:6px 0;font-size:13px;color:var(--red);">
			<span>Stock Shortfall</span>
			<span style="display:flex;align-items:center;gap:10px;">
				<span id="stockShortfallVal">R 0.00</span>
				<label style="display:flex;align-items:center;gap:4px;font-size:11px;font-weight:600;color:var(--text);cursor:pointer;">
					<input type="checkbox" id="stockShortfallResolved" onchange="updateCommissionDisplay()"> Resolved
				</label>
			</span>
		</div>
		<div style="display:flex;justify-content:space-between;padding:8px 0;font-weight:700;font-size:16px;">
			<span>Commission (0.7%)</span><span id="commissionVal">—</span>
		</div>
	`;
	document.getElementById('mainContent').innerHTML = `
		<div class="route-summary">
			<div>
				<div class="route-name">${route.name}</div>
				<div class="route-day">📅 ${route.day} — ${state.date}</div>
			</div>
			<div class="totals">
				<div class="total-val">R ${formatRand(totalValue)}</div>
				<div>Stock Sales Value</div>
			</div>
		</div>

		<div id="zohoBox" style="padding:16px;background:var(--card);border:1px solid var(--border);border-radius:8px;margin:12px 0;">
			Loading Zoho figures...
		</div>

		<div id="commissionBox" style="padding:16px;background:var(--card);border:1px solid var(--border);border-radius:8px;margin:12px 0;">
			${commissionBoxHtml}
		</div>

		<div id="denomBox" style="padding:16px;"></div>

		<div id="causesBox" style="display:none;margin:12px 0;"></div>

		<div class="action-bar">
			<button class="btn btn-secondary" onclick="refreshCashUpScreen()">🔄 Refresh</button>
			<button class="btn btn-secondary" onclick="printCashUp()">🖨️ Print</button>
			<button class="btn btn-success" onclick="saveCashUp(${totalValue})">💾 Save Cash Up</button>
		</div>
	`;

	const denoms = [
		{key:'r200', label:'R200', value:200},
		{key:'r100', label:'R100', value:100},
		{key:'r50', label:'R50', value:50},
		{key:'r20', label:'R20', value:20},
		{key:'r10', label:'R10', value:10},
		{key:'r5', label:'R5', value:5},
		{key:'r2', label:'R2', value:2},
		{key:'r1', label:'R1', value:1},
		{key:'r050', label:'50c', value:0.5}
	];

	document.getElementById('denomBox').innerHTML = `
		<h3 style="margin-bottom:10px;">Cash Count</h3>
		${denoms.map(d => `
			<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);">
				<span style="font-weight:600;">${d.label}</span>
				<input type="text" inputmode="numeric" pattern="[0-9]*" min="0" id="denom_${d.key}" value="0"
					style="width:80px;padding:8px;font-size:16px;text-align:center;border:1px solid var(--border);border-radius:6px;"
					oninput="updateCashTotal()" onfocus="this.select()">
				<span id="sub_${d.key}" style="width:90px;text-align:right;color:var(--muted);">R 0.00</span>
			</div>
		`).join('')}
		<div style="display:flex;justify-content:space-between;padding:12px 0;font-weight:700;font-size:18px;">
			<span>Counted Total</span>
			<span id="cashCountedTotal">R 0.00</span>
		</div>
		<div style="display:flex;justify-content:space-between;padding:8px 0;font-weight:700;font-size:18px;" id="diffRow">
			<span>Cash Difference</span>
			<span id="cashDiffValue">—</span>
		</div>
	`;

	// ADDED 23 July 2026 -- Apply any previously saved Cash Up counts + saved Zoho
	// snapshot FIRST, before attempting a live Zoho pull. This means reopening a
	// past date shows the figures that were saved at the time, instead of forcing
	// a "Re-sync this date" click every time. Only "Re-sync this date" (or a brand
	// new date with no CASH_UP_LOG row yet) triggers a fresh Zoho API pull.
	let cuDataFound = null;
	state.causesChecked = {};

	// Speed fix (28 July 2026) — getCashUpLog and getCommissionLog are independent of
	// each other (different sheets, no shared data), so firing them together instead of
	// one after another cuts a full Apps Script round trip off every Cash Up screen open.
	// The Zoho live pull still waits for the Cash Up result below, since it genuinely is
	// conditional on it (skipped entirely if a saved snapshot is found).
	const cuUrl = `${SCRIPT_URL}?action=getCashUpLog&route=${encodeURIComponent(route.name)}&date=${state.date}&sheetId=${NEW_SHEET_ID}`;
	const commUrl = `${SCRIPT_URL}?action=getCommissionLog&route=${encodeURIComponent(route.name)}&date=${state.date}&sheetId=${NEW_SHEET_ID}`;

	const [cuResult, commResult] = await Promise.all([
		fetch(cuUrl).then(r => r.json()).catch(() => null),
		fetch(commUrl).then(r => r.json()).catch(() => null)
	]);

	if (cuResult && cuResult.status === 'ok' && cuResult.found) {
		const cuData = cuResult;
		cuDataFound = cuData.data;
		const fieldMap = {r200:'R200_QTY', r100:'R100_QTY', r50:'R50_QTY', r20:'R20_QTY', r10:'R10_QTY', r5:'R5_QTY', r2:'R2_QTY', r1:'R1_QTY', r050:'R0.50_QTY'};
		Object.keys(fieldMap).forEach(key => {
			const val = cuData.data[fieldMap[key]];
			const el = document.getElementById(`denom_${key}`);
			if (el && val !== undefined && val !== '') el.value = val;
		});
		if (cuData.data.CAUSES_CHECKED_JSON) {
			try { state.causesChecked = JSON.parse(cuData.data.CAUSES_CHECKED_JSON) || {}; } catch (e) { state.causesChecked = {}; }
		}
	}

	// FIX (5 August 2026) -- Difference Causes ticks used to reset whenever the
	// app was closed/reopened without pressing "Save Cash Up" again, because
	// they only lived in state.causesChecked until that explicit save. Now
	// mirrored to localStorage on every tick (see toggleCause), keyed by
	// date+route -- same pattern already used for Morning Load tick marks.
	// Restored here as an overlay on top of whatever was last actually saved
	// to CASH_UP_LOG, so a not-yet-saved tick survives a close/reopen too.
	try {
		const rawCauses = localStorage.getItem(causesCheckedStorageKey(state.date, route.name));
		if (rawCauses) {
			const parsedCauses = JSON.parse(rawCauses);
			if (parsedCauses && typeof parsedCauses === 'object') state.causesChecked = parsedCauses;
		}
	} catch (e) {
		// localStorage unavailable/bad data -- fall back to whatever was loaded above
	}

	try {
		if (cuDataFound && cuDataFound.ZOHO_TOTAL_SALES !== undefined && cuDataFound.ZOHO_TOTAL_SALES !== '') {
			// Use the Zoho snapshot saved the last time Cash Up was saved for this
			// date, instead of re-pulling live Zoho data every time this screen
			// opens. Press "Re-sync this date" any time to pull fresh figures.
			state.cashUpZoho = {
				zohoTotalSales: cuDataFound.ZOHO_TOTAL_SALES,
				cashTotal: cuDataFound.ZOHO_CASH,
				shop2shopTotal: cuDataFound.ZOHO_SHOP2SHOP,
				newCreditToday: cuDataFound.NEW_CREDIT_TODAY,
				creditCollectedToday: cuDataFound.CREDIT_COLLECTED_TODAY,
				// ADDED 29 July 2026 -- Cash Sales / Credit Collected in Cash split
				cashSalesToday: cuDataFound.ZOHO_CASH_SALES,
				creditCollectedInCash: cuDataFound.ZOHO_CREDIT_COLLECTED_CASH
			};
			document.getElementById('zohoBox').innerHTML = renderZohoBoxHtml(state.cashUpZoho);
		} else {
			const url = `${SCRIPT_URL}?action=getZohoSyncForRoute&route=${encodeURIComponent(route.name)}&date=${state.date}&sheetId=${NEW_SHEET_ID}`;
			const resp = await fetch(url);
			const data = await resp.json();

			if (data.status === 'ok' && data.found) {
				state.cashUpZoho = data.data;
				document.getElementById('zohoBox').innerHTML = renderZohoBoxHtml(data.data);
			} else {
				state.cashUpZoho = null;
				document.getElementById('zohoBox').innerHTML = `
					<div style="color:var(--orange);">⚠️ No Zoho sync data yet for ${route.name} on ${state.date}. Run the sync, or save anyway — Zoho fields will show as 0.</div>
					<div style="margin-top:10px;text-align:right;"><button class="btn btn-secondary" style="font-size:12px;padding:6px 12px;" onclick="resyncZohoForDate()">🔄 Re-sync this date</button></div>
				`;
			}
		}
	} catch (err) {
		state.cashUpZoho = null;
		document.getElementById('zohoBox').innerHTML = `<div style="color:var(--red);">⚠️ Could not load Zoho data: ${err.message}</div>`;
	}

	// Show the commission figure immediately using the default (blank = R0) credit fields
	updateCommissionDisplay();

	// Prefill Sales Person, Current Credit, and Total Credit from any previously saved commission entry (added 10 July 2026)
	try {
		if (commResult && commResult.status === 'ok' && commResult.found) {
			const commData = commResult;
			if (isFlatRate) {
				const rows = commData.rows || [];
				const sp1El = document.getElementById('salesPerson1Select');
				const sp2El = document.getElementById('salesPerson2Select');
				if (sp1El && rows[0] && rows[0].SALESPERSON) sp1El.value = rows[0].SALESPERSON;
				if (sp2El && rows[1] && rows[1].SALESPERSON) sp2El.value = rows[1].SALESPERSON;
			} else {
				const spEl = document.getElementById('salesPersonInput');
				if (spEl && commData.data.SALESPERSON) spEl.value = commData.data.SALESPERSON;
				const currentEl = document.getElementById('currentCreditInput');
				if (currentEl && commData.data.CURRENT_CREDIT !== undefined && commData.data.CURRENT_CREDIT !== '') {
					currentEl.value = commData.data.CURRENT_CREDIT;
					formatCreditInputOnBlur(currentEl);
				}
				const totalEl = document.getElementById('totalCreditInput');
				if (totalEl && commData.data.TOTAL_CREDIT_OUTSTANDING !== undefined && commData.data.TOTAL_CREDIT_OUTSTANDING !== '') {
					totalEl.value = commData.data.TOTAL_CREDIT_OUTSTANDING;
					formatCreditInputOnBlur(totalEl);
				}
				// ADDED 6 August 2026 -- Cash Shortfall / Stock Shortfall "Resolved"
				// checkboxes prefill from the last saved COMMISSION_LOG row, so
				// reopening a date/route shows whatever Alex last confirmed --
				// blank/undefined (pre-migration rows, or a shortfall that never
				// applied that day) is treated as unresolved (unchecked).
				const cashResolvedEl = document.getElementById('cashShortfallResolved');
				if (cashResolvedEl) cashResolvedEl.checked = commData.data.CASH_SHORTFALL_RESOLVED === true;
				const stockResolvedEl = document.getElementById('stockShortfallResolved');
				if (stockResolvedEl) stockResolvedEl.checked = commData.data.STOCK_SHORTFALL_RESOLVED === true;
			}
			updateCommissionDisplay();
		}
	} catch (e) {
		// Unexpected data shape - leave Sales Person and credit fields blank, don't block the app
	}

	updateCashTotal();
}
function renderZohoBoxHtml(zoho) {
	const totalValue = state.cashUpSalesValue || 0;
	const zohoSales = Number(zoho.zohoTotalSales) || 0;
	const variance = Math.round((totalValue - zohoSales) * 100) / 100;
	let label, color;
	if (variance > 0) { label = 'DELIVERED NOT INVOICED'; color = 'var(--blue)'; }
	else if (variance < 0) { label = 'INVOICED NOT DELIVERED'; color = 'var(--red)'; }
	else { label = 'MATCHED'; color = 'var(--green)'; }
	// ADDED 29 July 2026 -- Cash Sales / Credit Collected in Cash split. Older saved
	// rows (from before this migration) won't have these two fields -- fall back to
	// the single combined "Cash (Zoho)" line for those instead of showing blank/zero.
	const hasCashSplit = zoho.cashSalesToday !== undefined && zoho.cashSalesToday !== '' &&
		zoho.creditCollectedInCash !== undefined && zoho.creditCollectedInCash !== '';
	const cashSplitHtml = hasCashSplit ? `
		<div style="display:flex;justify-content:space-between;padding:4px 0;"><span>Cash Sales</span><b>R ${formatRand(Number(zoho.cashSalesToday))}</b></div>
		<div style="display:flex;justify-content:space-between;padding:4px 0;"><span>Credit Collected in Cash</span><b>R ${formatRand(Number(zoho.creditCollectedInCash))}</b></div>
	` : `
		<div style="display:flex;justify-content:space-between;padding:4px 0;"><span>Cash (Zoho)</span><b>R ${formatRand(Number(zoho.cashTotal))}</b></div>
	`;
	return `
		<h3 style="margin-bottom:10px;">Zoho Figures (${state.date})</h3>
		<div style="display:flex;justify-content:space-between;padding:4px 0;"><span>Zoho Total Sales</span><b>R ${formatRand(zohoSales)}</b></div>
		${cashSplitHtml}
		<div style="display:flex;justify-content:space-between;padding:4px 0;"><span>Shop2Shop</span><b>R ${formatRand(Number(zoho.shop2shopTotal))}</b></div>
		<div style="display:flex;justify-content:space-between;padding:4px 0;"><span>New Credit Today</span><b>R ${formatRand(Number(zoho.newCreditToday))}</b></div>
		<div style="display:flex;justify-content:space-between;padding:4px 0;"><span>Credit Collected Today</span><b>R ${formatRand(Number(zoho.creditCollectedToday))}</b></div>
		<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;padding-bottom:2px;">
			<span>Stock vs Zoho Variance</span>
			<b style="color:${color};">R ${formatRand(variance, 2)}</b>
		</div>
		<div style="text-align:right;font-size:11px;color:${color};font-weight:600;">${label}</div>
		<div style="margin-top:14px;text-align:right;">
			<button class="btn btn-secondary" style="font-size:12px;padding:6px 12px;" onclick="resyncZohoForDate()">🔄 Re-sync this date</button>
		</div>
	`;
}
async function resyncZohoForDate() {
	showToast(`🔄 Re-syncing Zoho for ${state.date}...`, '');
	try {
		const resp = await fetch(SCRIPT_URL, {
			method: 'POST',
			headers: {'Content-Type': 'text/plain'},
			body: JSON.stringify({
				action: 'resyncZohoForDate',
				sheetId: NEW_SHEET_ID,
				date: state.date,
				route: state.activeRoute
			})
		});
		const data = await resp.json();
		if (data.status === 'ok' && data.data) {
			state.cashUpZoho = data.data;
			document.getElementById('zohoBox').innerHTML = renderZohoBoxHtml(data.data);
			updateCashTotal();
			showToast(`✅ Zoho re-synced for ${state.date}`, 'success');
		} else if (data.status === 'ok') {
			showToast('⚠️ Re-sync ran, but no data found for this route/date', 'error');
		} else {
			throw new Error(data.message || 'Re-sync failed');
		}
	} catch (err) {
		showToast(`⚠️ Re-sync failed: ${err.message}`, 'error');
	}
}
function updateCashTotal() {
	const denoms = [
		{key:'r200', value:200}, {key:'r100', value:100}, {key:'r50', value:50},
		{key:'r20', value:20}, {key:'r10', value:10}, {key:'r5', value:5},
		{key:'r2', value:2}, {key:'r1', value:1}, {key:'r050', value:0.5}
	];
	let total = 0;
	denoms.forEach(d => {
		const qty = Number(document.getElementById(`denom_${d.key}`).value) || 0;
		const sub = qty * d.value;
		total += sub;
		document.getElementById(`sub_${d.key}`).textContent = `R ${formatRand(sub, 2)}`;
	});
	document.getElementById('cashCountedTotal').textContent = `R ${formatRand(total, 2)}`;

	const zoho = state.cashUpZoho;
	const diffEl = document.getElementById('cashDiffValue');
	if (zoho) {
		const expectedCash = Number(zoho.cashTotal) || 0;
		const shop2shop = Number(zoho.shop2shopTotal) || 0; // informational only, not used in cash diff
		const diff = total - expectedCash; // Counted Cash vs Zoho Cash (fixed 25 June 2026)
		diffEl.textContent = `R ${formatRand(diff, 2)} ${diff >= 0 ? '(Over)' : '(Short)'}`;
		diffEl.style.color = diff === 0 ? 'var(--green)' : (diff > 0 ? 'var(--blue)' : 'var(--red)');
		state.cashUpLastDiff = diff;
	} else {
		diffEl.textContent = '—';
		state.cashUpLastDiff = 0;
	}
	if (typeof updateCausesSection === 'function') updateCausesSection();
	// ADDED 6 August 2026 -- Cash Shortfall (Sales Commission box) is derived
	// from state.cashUpLastDiff, which this function just updated -- refresh
	// the commission display so it stays live as denomination counts change.
	if (typeof updateCommissionDisplay === 'function') updateCommissionDisplay();
}
async function refreshCashUpScreen() {
	const route = state.routes.find(r => r.name === state.activeRoute);
	if (!route) { showToast('⚠️ Could not refresh — route not found', 'error'); return; }
	showToast('🔄 Refreshing...', '');
	await renderCashUp(route, state.cashUpSalesValue || 0, state.cashUpItemsSold || 0);
	showToast('✅ Refreshed', 'success');
}
async function saveCashUp(totalValue) {
	const denoms = [
		{key:'r200', value:200}, {key:'r100', value:100}, {key:'r50', value:50},
		{key:'r20', value:20}, {key:'r10', value:10}, {key:'r5', value:5},
		{key:'r2', value:2}, {key:'r1', value:1}, {key:'r050', value:0.5}
	];
	let cashCountedTotal = 0;
	const counts = {};
	denoms.forEach(d => {
		const qty = Number(document.getElementById(`denom_${d.key}`).value) || 0;
		counts[d.key] = qty;
		cashCountedTotal += qty * d.value;
	});

	const zoho = state.cashUpZoho || {};
	const expectedCash = Number(zoho.cashTotal) || 0;
	const shop2shop = Number(zoho.shop2shopTotal) || 0; // informational only, not used in cash diff
	const cashDifference = cashCountedTotal - expectedCash; // Counted Cash vs Zoho Cash (fixed 25 June 2026)

	try {
		const resp = await fetch(SCRIPT_URL, {
			method: 'POST',
			headers: {'Content-Type': 'text/plain'},
			body: JSON.stringify({
				action: 'writeCashUpLog',
				sheetId: NEW_SHEET_ID,
				date: state.date,
				route: state.activeRoute,
				cashUp: {
					stockSalesValue: totalValue,
					zohoTotalSales: Number(zoho.zohoTotalSales) || 0,
					zohoCash: Number(zoho.cashTotal) || 0,
					zohoShop2Shop: shop2shop,
					newCreditToday: Number(zoho.newCreditToday) || 0,
					creditCollectedToday: Number(zoho.creditCollectedToday) || 0,
					// ADDED 29 July 2026 -- Cash Sales / Credit Collected in Cash split
					cashSalesToday: Number(zoho.cashSalesToday) || 0,
					creditCollectedInCash: Number(zoho.creditCollectedInCash) || 0,
					...counts,
					cashCountedTotal,
					cashDifference,
					causesChecked: JSON.stringify(state.causesChecked || {})
				}
			})
		});
		const data = await resp.json();
		if (data.status === 'ok') {
			let toastMsg = `✅ Cash Up saved — Difference: R ${formatRand(cashDifference, 2)}`;

			// Added 22 July 2026 -- flat-rate routes (Riversdale/Oudtshoorn/Stilbaai) save
			// TWO commission entries (one per chosen sales person), each getting half the
			// R5-per-item pool, instead of the usual single-person 0.7%-of-sales entry.
			if (state.cashUpFlatRate) {
				const sp1El = document.getElementById('salesPerson1Select');
				const sp2El = document.getElementById('salesPerson2Select');
				const sp1 = sp1El ? sp1El.value : '';
				const sp2 = sp2El ? sp2El.value : '';
				if (sp1 && sp2) {
					const itemsSold = state.cashUpItemsSold || 0;
					const pool = Math.round(itemsSold * 5 * 100) / 100;
					const each = Math.round((pool / 2) * 100) / 100;
					try {
						for (const sp of [sp1, sp2]) {
							await fetch(SCRIPT_URL, {
								method: 'POST',
								headers: {'Content-Type': 'text/plain'},
								body: JSON.stringify({
									action: 'writeCommissionLog',
									sheetId: NEW_SHEET_ID,
									date: state.date,
									route: state.activeRoute,
									commission: {
										salesPerson: sp,
										salesValue: itemsSold,
										commissionValue: each,
										commissionMode: 'FLAT_RATE'
									}
								})
							});
						}
						toastMsg += ` | Commission: R ${formatRand(each, 2)} each (${sp1} & ${sp2})`;
					} catch (e) {
						// Commission save failed silently — Cash Up itself already saved successfully
					}
				}
			} else {
			const salesPersonEl = document.getElementById('salesPersonInput');
			const salesPerson = salesPersonEl ? salesPersonEl.value.trim() : '';
			if (salesPerson) {
				const currentEl = document.getElementById('currentCreditInput');
				const totalEl = document.getElementById('totalCreditInput');
				const currentCredit = parseCreditValue(currentEl);
				const totalCredit = parseCreditValue(totalEl);
				const overdueCredit = Math.max(0, Math.round((totalCredit - currentCredit) * 100) / 100);

				// ADDED 6 August 2026 -- Cash Shortfall / Stock Shortfall, same
				// source figures and Resolved checkboxes as updateCommissionDisplay()
				// (see that function for the reasoning). Server-side (writeCommissionLog
				// in Code.gs) recomputes Commission from these independently, same as
				// it already does for Overdue Credit -- this client-side commission
				// value is only for the toast message.
				const cashShortfallForSave = cashDifference < -0.005 ? Math.round(Math.abs(cashDifference) * 100) / 100 : 0;
				const stockDiffForSave = typeof getStockDifference === 'function' ? getStockDifference() : 0;
				const stockShortfallForSave = stockDiffForSave > 0.005 ? Math.round(stockDiffForSave * 100) / 100 : 0;
				const cashShortfallResolvedEl = document.getElementById('cashShortfallResolved');
				const stockShortfallResolvedEl = document.getElementById('stockShortfallResolved');
				const cashShortfallResolved = !!(cashShortfallResolvedEl && cashShortfallResolvedEl.checked);
				const stockShortfallResolved = !!(stockShortfallResolvedEl && stockShortfallResolvedEl.checked);
				const cashShortfallDeduction = cashShortfallResolved ? 0 : cashShortfallForSave;
				const stockShortfallDeduction = stockShortfallResolved ? 0 : stockShortfallForSave;

				const commission = Math.max(0, Math.round(((totalValue - overdueCredit) * 0.007 - cashShortfallDeduction - stockShortfallDeduction) * 100) / 100);
				try {
					await fetch(SCRIPT_URL, {
						method: 'POST',
						headers: {'Content-Type': 'text/plain'},
						body: JSON.stringify({
							action: 'writeCommissionLog',
							sheetId: NEW_SHEET_ID,
							date: state.date,
							route: state.activeRoute,
							commission: {
								salesPerson: salesPerson,
								salesValue: totalValue,
								currentCredit: currentCredit,
								totalCreditOutstanding: totalCredit,
								creditNotCollected: overdueCredit,
								commission: commission,
								cashShortfall: cashShortfallForSave,
								cashShortfallResolved: cashShortfallResolved,
								stockShortfall: stockShortfallForSave,
								stockShortfallResolved: stockShortfallResolved
							}
						})
					});
					let commMsg = ` | Commission: R ${formatRand(commission, 2)}`;
					if (cashShortfallDeduction > 0 || stockShortfallDeduction > 0) {
						commMsg += ` (after R ${formatRand(cashShortfallDeduction + stockShortfallDeduction, 2)} shortfall deduction)`;
					}
					toastMsg += commMsg;
				} catch (e) {
					// Commission save failed silently — Cash Up itself already saved successfully
				}
			}
			}

			showToast(toastMsg, 'success');
		} else {
			showToast(`❌ ${data.message}`, 'error');
		}
	} catch (err) {
		showToast(`❌ Save failed: ${err.message}`, 'error');
	}
}
