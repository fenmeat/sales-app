// ---------------------------------------------------------------------
// STOCK FILTER HELPERS (shared by Morning, Evening and the print lists)
// Added 21 Sep 2026. One source of truth: state.stockStatus[code] === false
// means "no stock". Rows are only HIDDEN at render time -- a hidden product
// stays in state.routeData[...].products with its OUT / IN / SOLD values, so
// totals, Save Sales, Cash Up and the Stock-vs-Zoho variance never lose it.
// ---------------------------------------------------------------------
function isStockHidden(p) {
	return !!state.stockStatus && state.stockStatus[p.code] === false;
}

// Server-side records for this route/date: a saved LOAD_LOG qty > 0, or a
// saved SALES_LOG row. (Flags are set when the logs are loaded / saved.)
function hasSavedRecord(p) {
	return (Number(p.loadedQty) || 0) > 0 || p.hasSalesRow === true;
}

// A no-stock product that still has something worth reaching: saved records,
// a Zoho invoice for this route/date, or returns already typed in.
function isReachableHidden(p) {
	return hasSavedRecord(p) || (Number(p.zohoQty) || 0) > 0 || (Number(p.inQty) || 0) > 0;
}

// Rows to show on the Evening screen / Evening print list. Each entry keeps
// its ORIGINAL index into the full products array (element ids and
// updateIn() address products by that index, never by list position).
function eveningVisibleEntries(routeName) {
	const rd = state.routeData[routeName];
	const products = rd ? rd.products : [];
	const showHidden = !!(state.eveningShowHidden && state.eveningShowHidden[routeName]);
	return products
		.map((p, originalIdx) => ({ p, originalIdx }))
		.filter(({ p }) => !isStockHidden(p) || (showHidden && isReachableHidden(p)));
}

// A product that is no-stock and has NO saved record carries no real OUT --
// its OUT is only the forecast. Park that number in suppressedOut and use 0,
// so a hidden row can never leak a phantom sale into Evening totals or
// Save Sales. When the product is marked in-stock again the forecast comes
// back. Products WITH saved records are never touched.
function applyStockSuppression(routeName) {
	const rd = state.routeData[routeName];
	if (!rd) return;
	rd.products = rd.products.map(p => {
		if (isStockHidden(p) && !hasSavedRecord(p) && p.out !== 0) {
			return { ...p, suppressedOut: p.out, out: 0 };
		}
		if (!isStockHidden(p) && p.suppressedOut !== undefined) {
			const { suppressedOut, ...rest } = p;
			return { ...rest, out: suppressedOut };
		}
		return p;
	});
}

function applyStockSuppressionAll() {
	Object.keys(state.routeData).forEach(applyStockSuppression);
}

function toggleHiddenLoaded(routeName) {
	if (!state.eveningShowHidden) state.eveningShowHidden = {};
	state.eveningShowHidden[routeName] = !state.eveningShowHidden[routeName];
	renderContent();
}

function hiddenBannerInner(routeName) {
	const rd = state.routeData[routeName];
	if (!rd) return '';
	const n = rd.products.filter(p => isStockHidden(p) && isReachableHidden(p)).length;
	if (n === 0) return '';
	const showing = !!(state.eveningShowHidden && state.eveningShowHidden[routeName]);
	const plural = n === 1 ? 'product' : 'products';
	const text = showing
		? `👁 Showing ${n} no-stock ${plural} that ${n === 1 ? 'has' : 'have'} records for this date.`
		: `📦 ${n} no-stock ${plural} already loaded or recorded ${n === 1 ? 'is' : 'are'} hidden. Still counted in the totals.`;
	return `
		<div class="hidden-banner">
			<div class="hidden-banner-text">${text}</div>
			<button class="hidden-banner-btn" onclick="toggleHiddenLoaded('${routeName}')">${showing ? 'Hide' : 'Show'}</button>
		</div>`;
}

function refreshHiddenBanner(routeName) {
	if (state.mode !== 'evening' || routeName !== state.activeRoute) return;
	const el = document.getElementById('hiddenBanner');
	if (el) el.innerHTML = hiddenBannerInner(routeName);
}

async function loadStockStatus() {
	// Stock toggle -- fetches the current weekly IN_STOCK Y/N flag for every
	// product code, once per date-load (not per route -- it's not route-
	// specific). Populates state.stockStatus as a simple code -> boolean map.
	// Defaults to visible (fail-open) if the fetch fails, matching the
	// backend's own fail-safe default -- a connection hiccup should never
	// silently hide products that are actually available.
	if (!state.stockStatus) state.stockStatus = {};
	try {
		const url = `${SCRIPT_URL}?action=getStockStatus&sheetId=${NEW_SHEET_ID}`;
		const resp = await fetch(url);
		const data = await resp.json();
		if (data.status === 'ok' && data.products) {
			state.stockStatus = {};
			data.products.forEach(p => { state.stockStatus[p.code] = p.inStock; });
		}
	} catch (e) {
		// No connection - state.stockStatus stays as-is (empty on first load),
		// everything defaults to visible since state.stockStatus[code] !== false.
	}
}

async function loadForecastData() {
	await loadStockStatus();

	renderContent(); // Show loading state

	for (const route of state.routes) {
		try {
			const url = `${SCRIPT_URL}?action=getForecast&route=${encodeURIComponent(route.name)}&date=${state.date}&sheetId=${NEW_SHEET_ID}`;
			const resp = await fetch(url);
			const data = await resp.json();

			if (data.products && data.products.length > 0) {
				// Map forecast data to products
				state.routeData[route.name].products = PRODUCTS.map(p => {
					const f = data.products.find(fp => fp.code === p.code);
					return {
						...p,
						out: f ? f.qty : 0,
						forecast: f ? f.qty : 0,
						inQty: 0,
						loaded: true,
					};
				});
			} else {
				// Use FORECAST sheet averages from our new sheet as fallback
				await loadFromNewForecastSheet(route.name);
			}
		} catch(e) {
			// Fallback to new sheet direct
			await loadFromNewForecastSheet(route.name);
		}

		// Apply any saved Morning Load override so confirmed loads persist (restored 23 June 2026)
		await applyLoadLogOverride(route.name);

		// Apply any saved Evening Capture IN override so captured sales persist (added 25 June 2026)
		await applySalesLogOverride(route.name);

		// Restore Morning Load tick marks from localStorage so they survive a page
		// refresh mid-load (added 22 July 2026).
		restoreCheckedState(route.name);

		// Stock filter (21 Sep 2026): a no-stock product with no saved record
		// carries no real OUT -- see applyStockSuppression().
		applyStockSuppression(route.name);
	}

	state.forecastLoaded = true;
	renderContent();
}

async function applyLoadLogOverride(routeName) {
	try {
		const url = `${SCRIPT_URL}?action=getLoadLog&route=${encodeURIComponent(routeName)}&date=${state.date}&sheetId=${NEW_SHEET_ID}`;
		const resp = await fetch(url);
		const data = await resp.json();
		if (data.found && data.products && data.products.length > 0) {
			state.routeData[routeName].products = state.routeData[routeName].products.map(p => {
				const saved = data.products.find(sp => sp.code === p.code);
				return saved ? { ...p, out: saved.qty, loadedQty: Number(saved.qty) || 0 } : p;
			});
		}
	} catch (e) {
		// No connection - keep forecast values, don't block the app
	}
}

async function applySalesLogOverride(routeName) {
	try {
		const url = `${SCRIPT_URL}?action=getSalesLog&route=${encodeURIComponent(routeName)}&date=${state.date}&sheetId=${NEW_SHEET_ID}`;
		const resp = await fetch(url);
		const data = await resp.json();
		if (data.found && data.products && data.products.length > 0) {
			state.routeData[routeName].products = state.routeData[routeName].products.map(p => {
				const soldRow = data.products.find(sp => sp.code === p.code);
				if (!soldRow) return p;
				const inQty = Math.max(0, p.out - soldRow.sold);
				return { ...p, inQty: inQty, hasSalesRow: true };
			});
		}
	} catch (e) {
		// No connection - keep default inQty, don't block the app
	}
}

async function loadFromNewForecastSheet(routeName) {
	try {
		// Read from FORECAST sheet in new Master File
		const url = `${SCRIPT_URL}?action=getNewForecast&route=${encodeURIComponent(routeName)}&sheetId=${NEW_SHEET_ID}`;
		const resp = await fetch(url);
		const data = await resp.json();

		if (data.products && data.products.length > 0) {
			state.routeData[routeName].products = PRODUCTS.map(p => {
				const f = data.products.find(fp => fp.code === p.code);
				const qty = f ? Math.round(f.avg_qty) : 0;
				return { ...p, out: qty, forecast: qty, inQty: 0, loaded: true };
			});
		} else {
			// Mark as loaded with zeros
			state.routeData[routeName].products = PRODUCTS.map(p => ({
				...p, out: 0, forecast: 0, inQty: 0, loaded: true
			}));
		}
	} catch(e) {
		// No connection - use zeros
		state.routeData[routeName].products = PRODUCTS.map(p => ({
			...p, out: 0, forecast: 0, inQty: 0, loaded: true
		}));
	}
}

function renderMorning(route, products, totalOut, totalValue) {
	// Stock toggle -- hide anything marked out-of-stock this week, so the
	// Morning Load list only shows what's actually available. Evening
	// Capture and Cash Up stay untouched and show every product regardless.
	// IMPORTANT: each row keeps its ORIGINAL index into
	// state.routeData[...].products (not its position in this filtered
	// list) -- updateOut/toggleChecked address products by that original
	// index, and using the filtered position instead would silently update
	// the wrong product when someone types a quantity.
	const indexed = products.map((p, originalIdx) => ({ p, originalIdx }));
	const visible = indexed.filter(({ p }) => state.stockStatus[p.code] !== false);
	const visibleTotalOut = visible.reduce((s, { p }) => s + p.out, 0);

	const html = `
		<div class="route-summary">
			<div>
				<div class="route-name">${route.name}</div>
				<div class="route-day">📅 ${route.day} — ${state.date}</div>
			</div>
			<div class="totals">
				<div class="total-val">${visibleTotalOut} bags</div>
				<div>Load Total</div>
			</div>
		</div>

		<div class="action-bar">
			<button class="btn btn-print" onclick="printMorningLoad()">🖨️ Print List</button>
			<button class="btn btn-primary" onclick="confirmMorning()">✅ Confirm Load</button>
		</div>

		<div class="product-list">
			<div class="product-header morning-mode">
				<div>PRODUCT</div>
				<div style="text-align:center">FCST</div>
				<div style="text-align:center">OUT QTY</div>
				<div style="text-align:center">✓</div>
			</div>
			${visible.map(({ p, originalIdx }) => `
				<div class="product-row morning-mode">
					<div>
						<div class="product-name">${p.name}</div>
						<div class="product-code">${p.code}</div>
					</div>
					<div class="out-display" style="color:var(--muted);font-size:13px">${p.forecast}</div>
					<div>
						<input type="text" inputmode="numeric" pattern="[0-9]*" class="qty-input ${p.out !== p.forecast ? 'modified' : ''}"
							id="out_${originalIdx}" value="${p.out}" min="0"
							oninput="updateOut(${originalIdx}, this.value)"
							onfocus="this.select()">
					</div>
					<div style="text-align:center">
						<input type="checkbox" class="load-check" ${p.checked ? 'checked' : ''}
							onchange="toggleChecked(${originalIdx}, this.checked)">
					</div>
				</div>
			`).join('')}
		</div>
	`;

	document.getElementById('mainContent').innerHTML = html;
}

function renderEvening(route, products, totalOut, totalIn, totalSold, totalValue) {
	// Stock filter (21 Sep 2026) -- same saved status as Morning Load. No-stock
	// products leave the normal list; the ones that were already loaded (or have
	// sales / Zoho records) stay reachable through the banner's Show button.
	// Rows are only hidden here: totals above come from ALL products, so
	// nothing is lost. Each row keeps its ORIGINAL index (element ids and
	// updateIn() use it, never the position in this filtered list).
	const entries = eveningVisibleEntries(route.name);

	const html = `
		<div class="route-summary">
			<div>
				<div class="route-name">${route.name}</div>
				<div class="route-day">📅 ${route.day} — ${state.date}</div>
			</div>
			<div class="totals">
				<div class="total-val">R ${formatRand(totalValue)}</div>
				<div>Sales Value</div>
			</div>
		</div>

		<div class="status-bar">
			<div class="status-item">
				<div class="status-val" style="color:var(--dark)">${totalOut}</div>
				<div class="status-label">OUT</div>
			</div>
			<div class="status-item">
				<div class="status-val" style="color:var(--blue)">${totalIn}</div>
				<div class="status-label">IN (Returns)</div>
			</div>
			<div class="status-item">
				<div class="status-val" style="color:var(--green)">${totalSold}</div>
				<div class="status-label">SOLD</div>
			</div>
		</div>

		<div id="hiddenBanner">${hiddenBannerInner(route.name)}</div>

		<div class="action-bar">
			<button class="btn btn-secondary" onclick="printRoute()">🖨️ Print</button>
			<button class="btn btn-success" onclick="saveSalesData()">💾 Save Sales</button>
		</div>

		<div class="product-list">
			<div class="product-header evening-mode">
				<div>PRODUCT</div>
				<div style="text-align:center">OUT</div>
				<div style="text-align:center">IN</div>
				<div style="text-align:center">SOLD</div>
				<div style="text-align:center">ZOHO</div>
			</div>
			${entries.map(({ p, originalIdx: i }) => {
				const sold = p.out - p.inQty;
				const soldClass = sold > 0 ? 'sold-positive' : sold < 0 ? 'sold-negative' : 'sold-zero';
				const noStock = isStockHidden(p);
				const tag = noStock
					? `<div class="no-stock-tag">NO STOCK · ${(Number(p.loadedQty) || 0) > 0 ? 'LOADED' : 'RECORDS'}</div>`
					: '';
				return `
				<div class="product-row evening-mode ${noStock ? 'no-stock-row' : ''}">
					<div>
						<div class="product-name">${p.name}</div>
						<div class="product-code">${p.code}</div>
						${tag}
					</div>
					<div class="out-display">${p.out}</div>
					<div>
						<input type="text" inputmode="numeric" pattern="[0-9]*" class="qty-input"
							id="in_${i}" value="${p.inQty}" min="0"
							oninput="updateIn(${i}, this.value)"
							onfocus="this.select()">
					</div>
					<div class="sold-display ${soldClass}" id="sold_${i}">${sold}</div>
					<div class="zoho-display" id="zoho_${i}">${typeof p.zohoQty === 'number' ? p.zohoQty : '–'}</div>
				</div>
				`;
			}).join('')}
		</div>
	`;

	document.getElementById('mainContent').innerHTML = html;
	loadZohoItemSales(route.name);
}

async function loadZohoItemSales(routeName) {
	try {
		const url = `${SCRIPT_URL}?action=getZohoItemSales&route=${encodeURIComponent(routeName)}&date=${state.date}&sheetId=${NEW_SHEET_ID}`;
		// cache: 'no-store' added 26 August 2026 — this endpoint's data changes
		// throughout the day as invoices are created, but a plain fetch() to the
		// same URL can be served from the browser's HTTP cache even after a full
		// page reload, showing stale (possibly empty/zero) Zoho quantities. See
		// Master Context Doc Section 4 for the real incident this fixed.
		const resp = await fetch(url, { cache: 'no-store' });
		const data = await resp.json();
		if (data.status !== 'ok') return;
		const zohoMap = {};
		(data.products || []).forEach(p => { zohoMap[p.code] = p.zohoQty; });
		const products = state.routeData[routeName].products;
		products.forEach((p, i) => {
			const zohoQty = zohoMap.hasOwnProperty(p.code) ? zohoMap[p.code] : 0;
			p.zohoQty = zohoQty;
			const el = document.getElementById(`zoho_${i}`);
			if (!el) return; // hidden (no-stock) rows have no element -- value is still stored above
			const sold = p.out - p.inQty;
			el.textContent = zohoQty;
			el.className = `zoho-display ${zohoQty === sold ? 'zoho-match' : 'zoho-mismatch'}`;
		});
		// A no-stock product invoiced in Zoho for this route/date is a record
		// worth reaching -- update the banner now that the Zoho figures are in.
		refreshHiddenBanner(routeName);
	} catch (e) {
		// No connection - leave ZOHO column blank, don't block the app
	}
}

function updateOut(idx, val) {
	const v = parseInt(val) || 0;
	state.routeData[state.activeRoute].products[idx].out = v;
	refreshSoldCells(idx);
	updateTotals();
}

function loadCheckStorageKey(routeName) {
	return 'fenmeat_loadChecked_' + state.date + '_' + routeName;
}

function saveCheckedState(routeName) {
	try {
		const checkedCodes = state.routeData[routeName].products.filter(p => p.checked).map(p => p.code);
		localStorage.setItem(loadCheckStorageKey(routeName), JSON.stringify(checkedCodes));
	} catch (e) {
		// localStorage unavailable/full - ticks just won't persist, don't block the app
	}
}

function restoreCheckedState(routeName) {
	try {
		const raw = localStorage.getItem(loadCheckStorageKey(routeName));
		if (!raw) return;
		const checkedCodes = JSON.parse(raw);
		state.routeData[routeName].products = state.routeData[routeName].products.map(p =>
			checkedCodes.includes(p.code) ? { ...p, checked: true } : p
		);
	} catch (e) {
		// No saved ticks or bad data - leave unchecked, don't block the app
	}
}

function toggleChecked(idx, checked) {
	state.routeData[state.activeRoute].products[idx].checked = checked;
	saveCheckedState(state.activeRoute);
}

function updateIn(idx, val) {
	const v = parseInt(val) || 0;
	state.routeData[state.activeRoute].products[idx].inQty = v;
	refreshSoldCells(idx);
	updateTotals();
}

// Refresh the SOLD and ZOHO cells of ONE product by element id. (Replaces the
// old positional lookups -- querySelectorAll(...)[idx] -- which broke as soon
// as any row was filtered out of the list: list position != product index.)
function refreshSoldCells(idx) {
	const p = state.routeData[state.activeRoute].products[idx];
	const sold = p.out - p.inQty;
	const soldEl = document.getElementById(`sold_${idx}`);
	if (soldEl) {
		soldEl.textContent = sold;
		soldEl.className = `sold-display ${sold > 0 ? 'sold-positive' : sold < 0 ? 'sold-negative' : 'sold-zero'}`;
	}
	const zohoEl = document.getElementById(`zoho_${idx}`);
	if (zohoEl && typeof p.zohoQty === 'number') {
		zohoEl.className = `zoho-display ${p.zohoQty === sold ? 'zoho-match' : 'zoho-mismatch'}`;
	}
}

function updateTotals() {
	const products = state.routeData[state.activeRoute].products;
	const totalOut = products.reduce((s, p) => s + p.out, 0);
	const totalIn = products.reduce((s, p) => s + p.inQty, 0);
	const totalSold = totalOut - totalIn;
	const totalValue = products.reduce((s, p) => s + (p.out - p.inQty) * p.price, 0);

	// Update status bars
	const vals = document.querySelectorAll('.status-val');
	if (vals.length >= 3) {
		vals[0].textContent = totalOut;
		vals[1].textContent = totalIn;
		vals[2].textContent = totalSold;
	}
	const totalValEl = document.querySelector('.total-val');
	if (totalValEl) {
		totalValEl.textContent = `R ${formatRand(totalValue)}`;
	}
}

async function confirmMorning() {
	const products = state.routeData[state.activeRoute].products;
	// Stock toggle -- out-of-stock items are written to LOAD_LOG as qty:0,
	// not skipped entirely. Every other product always gets a LOAD_LOG row
	// once confirmed, and Evening Capture's fallback logic treats "no row
	// found" as "not confirmed yet today" -- if we skipped these instead of
	// zeroing them, Evening would fall back to their stale forecast quantity
	// instead of showing the honest zero.
	// EXCEPTION (21 Sep 2026): a no-stock product that was ALREADY loaded
	// today (saved LOAD_LOG qty > 0) keeps that qty -- re-confirming the load
	// must never wipe a real load, or its returns could not be captured.
	const rows = products.map(p => ({
		code: p.code,
		name: p.name,
		qty: isStockHidden(p) ? ((Number(p.loadedQty) || 0) > 0 ? Number(p.loadedQty) : 0) : p.out
	}));
	const totalOut = rows.reduce((s, r) => s + r.qty, 0);
	if (totalOut === 0) {
		showToast('⚠️ No quantities entered', 'error');
		return;
	}
	if (!confirm(`Confirm loading ${totalOut} bags for ${state.activeRoute}?\n\nThis cannot be undone.`)) return;
	showToast('💾 Saving load...', '');
	try {
		const resp = await fetch(SCRIPT_URL, {
			method: 'POST',
			headers: {'Content-Type': 'text/plain'},
			body: JSON.stringify({
				action: 'writeLoadLog',
				sheetId: NEW_SHEET_ID,
				date: state.date,
				route: state.activeRoute,
				rows: rows
			})
		});
		const data = await resp.json();
		if (data.status === 'ok') {
			// Remember what is now saved, so a later no-stock flip in this same
			// session still knows these products were already loaded.
			products.forEach((p, i) => { p.loadedQty = rows[i].qty; });
			showToast(`✅ ${state.activeRoute} load confirmed — ${totalOut} bags`, 'success');
			setMode('evening');
		} else {
			showToast('⚠️ Save failed: ' + (data.message || 'unknown error'), 'error');
		}
	} catch (e) {
		showToast('⚠️ Save failed - check connection', 'error');
	}
}

async function saveSalesData() {
	const products = state.routeData[state.activeRoute].products;
	const totalSold = products.reduce((s, p) => s + (p.out - p.inQty), 0);
	const totalValue = products.reduce((s, p) => s + (p.out - p.inQty) * p.price, 0);

	if (totalSold <= 0) {
		showToast('⚠️ No sales to save', 'error');
		return;
	}

	if (!confirm(`Save sales for ${state.activeRoute}?\n\nTotal Sold: ${totalSold} bags\nValue: R ${formatRand(totalValue)}`)) return;

	showToast('💾 Saving...', '');

	const _d = new Date(state.date + 'T12:00:00');
	const _dayNum = _d.getDay() === 0 ? 7 : _d.getDay();
	_d.setDate(_d.getDate() - (_dayNum - 1));
	const weekStart = _d.toISOString().split('T')[0];

	const salesRows = products
		// FIXED 22 July 2026 — was previously .filter(p => (p.out - p.inQty) > 0), which
		// dropped any product where everything was returned (sold=0) from SALES_LOG
		// entirely. On reload, applySalesLogOverride found no matching row for that
		// product and silently left it at the default inQty:0 — so a fully-returned
		// item (e.g. Chicken Steak: OUT=4, IN=4, sold=0) came back showing IN=0 after
		// closing and reopening the app, making it look like all 4 had sold. Filtering
		// on p.out > 0 instead saves a row for every loaded product, including sold=0
		// ones, so the reload calculation (out - sold) reconstructs IN correctly.
		.filter(p => p.out > 0)
		.map(p => ({
			date: state.date,
			weekStart: weekStart,
			route: state.activeRoute,
			code: p.code,
			name: p.name,
			out: p.out,
			inQty: p.inQty,
			sold: p.out - p.inQty,
			price: p.price,
			value: (p.out - p.inQty) * p.price
		}));

	try {
		const resp = await fetch(SCRIPT_URL, {
			method: 'POST',
			headers: {'Content-Type': 'text/plain'},
			body: JSON.stringify({
				action: 'writeSalesLog',
				sheetId: NEW_SHEET_ID,
				date: state.date,
				route: state.activeRoute,
				rows: salesRows
			})
		});
		const data = await resp.json();
		if (data.status === 'ok') {
			products.forEach(p => { if (p.out > 0) p.hasSalesRow = true; });
			showToast(`✅ Saved! ${salesRows.length} products — R ${formatRand(totalValue)}`, 'success');
		} else {
			throw new Error(data.message || 'Save failed');
		}
	} catch(e) {
		// Save locally as fallback
		const saved = JSON.stringify({date: state.date, route: state.activeRoute, rows: salesRows});
		console.log('SALES DATA (copy if needed):', saved);
		showToast('⚠️ Could not save to Sheet — see console for data', 'error');
	}
}
