function renderStock() {
	// Stock toggle -- full catalog view (not route-specific), grouped by code
	// prefix so it's scannable rather than one long flat list. Toggles only
	// update state.stockPendingChanges locally; nothing is sent to the
	// backend until Save is pressed, so flipping several items costs one
	// network call, not one per toggle.
	const groupOrder = [
		{ prefix: 'W', label: 'WORS & MINCE' },
		{ prefix: 'R', label: 'RUSSIANS' },
		{ prefix: 'V', label: 'VIENNAS' },
		{ prefix: 'P', label: 'POLONY & PIZZA' },
		{ prefix: 'C', label: 'CHICKEN' },
		{ prefix: 'S', label: 'SIX GUN & SOUP PACK' },
		{ prefix: 'O', label: 'OFFAL & OTHER' },
		{ prefix: 'D', label: 'DC MEAT RESALE' },
		{ prefix: 'B', label: "BRITO'S RESALE" },
	];

	function rowHtml(p) {
		const checked = state.stockStatus[p.code] !== false; // fail-open, same default as Morning Load
		return `
			<div class="product-row stock-mode">
				<div>
					<div class="product-name">${p.name}</div>
					<div class="product-code">${p.code}</div>
				</div>
				<label class="stock-toggle">
					<input type="checkbox" ${checked ? 'checked' : ''}
						onchange="toggleStockStatus('${p.code}', this.checked)">
					<span class="stock-toggle-slider"></span>
				</label>
			</div>
		`;
	}

	function groupHtml(group) {
		const items = PRODUCTS.filter(p => p.code.startsWith(group.prefix));
		if (items.length === 0) return '';
		return `<div class="stock-group-title">${group.label}</div>${items.map(rowHtml).join('')}`;
	}

	const html = `
		<div class="route-summary">
			<div>
				<div class="route-name">Stock Availability</div>
				<div class="route-day">📅 ${state.date} — toggle off anything out of stock this week</div>
			</div>
		</div>

		<div class="action-bar">
			<button class="btn btn-primary" onclick="saveStockStatus()">💾 Save Stock Changes</button>
		</div>

		<div class="product-list">
			<div class="product-header stock-mode">
				<div>PRODUCT</div>
				<div style="text-align:center">IN STOCK</div>
			</div>
			${groupOrder.map(groupHtml).join('')}
		</div>
	`;

	document.getElementById('mainContent').innerHTML = html;
}

function toggleStockStatus(code, checked) {
	if (!state.stockPendingChanges) state.stockPendingChanges = {};
	state.stockPendingChanges[code] = checked;
}

async function saveStockStatus() {
	const changes = state.stockPendingChanges || {};
	const codes = Object.keys(changes);
	if (codes.length === 0) {
		showToast('Nothing changed', '');
		return;
	}
	showToast('💾 Saving stock changes...', '');
	const updates = codes.map(code => ({ code: code, inStock: changes[code] }));
	try {
		const resp = await fetch(SCRIPT_URL, {
			method: 'POST',
			headers: {'Content-Type': 'text/plain'},
			body: JSON.stringify({
				action: 'setStockStatus',
				sheetId: NEW_SHEET_ID,
				updates: updates
			})
		});
		const data = await resp.json();
		if (data.status === 'ok') {
			updates.forEach(u => { state.stockStatus[u.code] = u.inStock; });
			state.stockPendingChanges = {};
			showToast(`✅ Saved — ${data.updated} product(s) updated`, 'success');
		} else {
			showToast('⚠️ Save failed: ' + (data.message || 'unknown error'), 'error');
		}
	} catch (e) {
		showToast('⚠️ Save failed - check connection', 'error');
	}
}
