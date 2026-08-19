function printCashUp() {
	const route = state.routes.find(r => r.name === state.activeRoute);
	const denoms = [
	{key:'r200', label:'R200', value:200}, {key:'r100', label:'R100', value:100},
	{key:'r50', label:'R50', value:50}, {key:'r20', label:'R20', value:20},
	{key:'r10', label:'R10', value:10}, {key:'r5', label:'R5', value:5},
	{key:'r2', label:'R2', value:2}, {key:'r1', label:'R1', value:1},
	{key:'r050', label:'50c', value:0.5}
	];

	const counts = {};
	let countedTotal = 0;
	denoms.forEach(d => {
	const el = document.getElementById(`denom_${d.key}`);
	const qty = el ? (parseInt(el.value) || 0) : 0;
	counts[d.key] = qty;
	countedTotal += qty * d.value;
	});

	const zoho = state.cashUpZoho || {};
	const zohoCash = Number(zoho.cashTotal) || 0;
	const shop2shop = Number(zoho.shop2shopTotal) || 0;
	const cashDifference = countedTotal - zohoCash;

	function denomCell(d) {
	return `<div class="denom-cell"><span class="denom-label">${d.label}</span><span class="box denom-box filled">${counts[d.key]}</span></div>`;
	}

	const printWin = window.open('', '_blank');
	printWin.document.write(`
	<html><head><title>FenMeat — ${state.activeRoute} — Cash Up</title>
	<style>
	@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap');
	@page { size: A4; margin: 12mm; }
	body { font-family: 'Poppins', Arial, Helvetica, sans-serif; font-size: 11px; color: #24262E; margin: 0; }

	.header { display: flex; justify-content: space-between; align-items: flex-end;
	border-bottom: 2px solid #003CFF; padding-bottom: 8px; margin-bottom: 20px; }
	.header h1 { font-size: 23px; margin: 0; letter-spacing: 0.5px; }
	.header h1 .fen { color: #003CFF; }
	.header .route-name { font-size: 16px; font-weight: bold; margin-top: 3px; }
	.header .meta { text-align: right; font-size: 11px; color: #555; line-height: 1.5; }
	.print-logo { height: 34px; display: block; }

	.box { border: 1.5px solid #333; border-radius: 3px; display: inline-flex;
	align-items: center; justify-content: center; font-weight: bold; }
	.box.filled { background: #f7f7f7; }

	.cashup-card { border: 2px solid #1a1a1a; border-radius: 5px; overflow: hidden; }
	.cashup-title { background: linear-gradient(135deg, #003CFF, #0026B3); color: #fff; padding: 9px 16px; font-size: 15px; font-weight: bold; letter-spacing: 0.3px; }
	.cashup-body { padding: 20px 24px; }

	.cashup-columns { display: flex; gap: 34px; }
	.denom-section { flex: 1.1; }
	.denom-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px 22px; }
	.denom-cell { display: flex; align-items: center; gap: 8px; font-size: 13px; }
	.denom-label { font-weight: bold; width: 32px; }
	.denom-box { width: 58px; height: 26px; font-size: 14px; }

	.totals-section { flex: 1; border-left: 1px solid #ddd; padding-left: 28px; }
	.totals-row { display: flex; justify-content: space-between; align-items: center; font-size: 13px; margin-bottom: 14px; }
	.totals-row .totals-label { color: #333; }
	.totals-row .currency { color: #555; margin-right: 4px; }
	.totals-box { min-width: 95px; height: 26px; padding: 0 8px; font-size: 14px; }
	.totals-box.highlight { border-color: #003CFF; border-width: 2px; color: #003CFF; }

	.zoho-recap { margin-top: 18px; padding-top: 14px; border-top: 1px solid #ddd;
	display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px 30px; font-size: 11.5px; color: #444; }
	.zoho-recap div { display: flex; justify-content: space-between; }
	</style></head><body>

	<div class="header">
	<div>
	<img class="print-logo" src="data:image/png;base64,${PRINT_LOGO_B64}" alt="FenMeat">
	<div class="route-name">${state.activeRoute} — CASH UP</div>
	</div>
	<div class="meta">📅 ${state.date}<br>${route.day}</div>
	</div>

	<div class="cashup-card">
	<div class="cashup-title">CASH UP — ${state.activeRoute} — ${state.date}</div>
	<div class="cashup-body">
	<div class="cashup-columns">

	<div class="denom-section">
	<div class="denom-grid">
	${denoms.map(denomCell).join('')}
	</div>
	</div>

	<div class="totals-section">
	<div class="totals-row"><span class="totals-label">Total Cash Counted</span><span><span class="currency">R</span><span class="box totals-box filled">${countedTotal.toFixed(2)}</span></span></div>
	<div class="totals-row"><span class="totals-label">Zoho Cash (recorded)</span><span><span class="currency">R</span><span class="box totals-box filled">${zohoCash.toFixed(2)}</span></span></div>
	<div class="totals-row"><span class="totals-label">Shop2Shop Total</span><span><span class="currency">R</span><span class="box totals-box filled">${shop2shop.toFixed(2)}</span></span></div>
	<div class="totals-row"><span class="totals-label"><b>Cash Difference</b> (Over/Short)</span><span><span class="currency">R</span><span class="box totals-box highlight filled">${cashDifference.toFixed(2)}</span></span></div>
	</div>

	</div>

	<div class="zoho-recap">
	<div><span>Zoho Total Sales</span><b>R ${(Number(zoho.zohoTotalSales)||0).toFixed(2)}</b></div>
	<div><span>New Credit Today</span><b>R ${(Number(zoho.newCreditToday)||0).toFixed(2)}</b></div>
	<div><span>Credit Collected Today</span><b>R ${(Number(zoho.creditCollectedToday)||0).toFixed(2)}</b></div>
	<div><span>Stock Sales Value</span><b>R ${(state.routeData[state.activeRoute].products.reduce((s,p)=>s+(p.out-p.inQty)*p.price,0)).toFixed(2)}</b></div>
	</div>

	</div>
	</div>

	<script>
	(function() {
	function doPrint() { window.print(); window.close(); }
	var imgs = Array.prototype.slice.call(document.images);
	var pending = imgs.filter(function(img){ return !img.complete; });
	if (pending.length === 0) { doPrint(); return; }
	var done = false, remaining = pending.length;
	function checkDone() { remaining--; if (remaining <= 0 && !done) { done = true; doPrint(); } }
	pending.forEach(function(img){ img.addEventListener('load', checkDone); img.addEventListener('error', checkDone); });
	setTimeout(function(){ if (!done) { done = true; doPrint(); } }, 1000);
	})();
	<\/script>
	</body></html>
	`);
	}
	function printMorningLoad() {
	const products = state.routeData[state.activeRoute].products;
	const route = state.routes.find(r => r.name === state.activeRoute);

	// Split into two columns to keep the whole list compact enough for one page
	const half = Math.ceil(products.length / 2);
	const colA = products.slice(0, half);
	const colB = products.slice(half);

	// Requirement 2: OUT must always show a number, never a blank cell
	function outVal(p) {
	return (p.out !== undefined && p.out !== null && p.out !== '') ? p.out : 0;
	}

	function productTable(list) {
	return `
	<table>
	<colgroup><col style="width:11%"><col style="width:45%"><col style="width:16%"><col style="width:12%"><col style="width:16%"></colgroup>
	<tr><th>Code</th><th>Product</th><th style="text-align:center">OUT</th><th style="text-align:center">✓</th><th style="text-align:center">IN</th></tr>
	${list.map(p => `
	<tr>
	<td class="code">${p.code}</td>
	<td>${p.name}</td>
	<td class="num">${outVal(p)}</td>
	<td class="num">☐</td>
	<td class="num"></td>
	</tr>
	`).join('')}
	</table>
	`;
	}

	const denomLabels = ['R200','R100','R50','R20','R10','R5','R2','R1','50c'];
	function denomCell(label) {
	return `<div class="denom-cell"><span class="denom-label">${label}</span><span class="box denom-box"></span></div>`;
	}

	const printWin = window.open('', '_blank');
	printWin.document.write(`
	<html><head><title>FenMeat — ${state.activeRoute} — Morning Load</title>
	<style>
	@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap');
	@page { size: A4; margin: 10mm; }
	* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
	body { font-family: 'Poppins', Arial, Helvetica, sans-serif; font-size: 11px; color: #24262E; margin: 0; }

	#printRoot { display: flex; flex-direction: column; min-height: 277mm; transform-origin: top left; }

	.header { display: flex; justify-content: space-between; align-items: flex-end;
	border-bottom: 2px solid #003CFF; padding-bottom: 6px; margin-bottom: 12px; }
	.header h1 { font-size: 22px; margin: 0; letter-spacing: 0.5px; }
	.header h1 .fen { color: #003CFF; }
	.header .route-name { font-size: 15px; font-weight: bold; margin-top: 3px; }
	.header .meta { text-align: right; font-size: 11px; color: #555; line-height: 1.5; }
	.print-logo { height: 28px; display: block; }

	.columns { display: flex; gap: 16px; margin-bottom: 12px; }
	.col { flex: 1; }
	table { width: 100%; border-collapse: collapse; table-layout: fixed; }
	th { background: #12141C; color: #fff; padding: 4px 6px; font-size: 9.5px; text-align: left; }
	td { padding: 4px 7px; border-bottom: 1px solid #eee; font-size: 10.5px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
	tr:nth-child(even) td { background: #f7f7f7; }
	.code { color: #999; font-size: 8.5px; }
	.num { text-align: center; font-weight: bold; font-size: 17px; }

	.box { border: 1.5px solid #333; border-radius: 3px; display: inline-block; }

	.cashup-card { border: 2px solid #1a1a1a; border-radius: 5px; overflow: hidden; margin-top: auto; }
	.cashup-title { background: linear-gradient(135deg, #003CFF, #0026B3); color: #fff; padding: 7px 14px; font-size: 15px; font-weight: bold; letter-spacing: 0.3px; }
	.cashup-body { padding: 14px 22px 12px; }

	.cashup-columns { display: flex; gap: 30px; }
	.denom-section { flex: 1.1; }
	.denom-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 20px; }
	.denom-cell { display: flex; align-items: center; gap: 8px; font-size: 13px; }
	.denom-label { font-weight: bold; width: 34px; }
	.denom-box { width: 60px; height: 24px; }

	.totals-section { flex: 1; border-left: 1px solid #ddd; padding-left: 26px; }
	.totals-row { display: flex; justify-content: space-between; align-items: center; font-size: 13px; margin-bottom: 10px; }
	.totals-row .totals-label { color: #333; }
	.totals-row .currency { color: #555; margin-right: 4px; }
	.totals-box { width: 95px; height: 24px; }
	.totals-box.highlight { border-color: #003CFF; border-width: 2px; }

	.staff-section { margin-top: 14px; }
	.staff-row { font-size: 13px; display: flex; align-items: center; margin-bottom: 10px; }
	.staff-row:last-child { margin-bottom: 0; }
	.staff-row span:first-child { font-weight: bold; width: 50px; }
	.staff-line { display: inline-block; flex: 1; border-bottom: 1.5px solid #333; height: 16px; }
	</style></head><body>

	<div id="printRoot">

	<div class="header">
	<div>
	<img class="print-logo" src="data:image/png;base64,${PRINT_LOGO_B64}" alt="FenMeat">
	<div class="route-name">${state.activeRoute}</div>
	</div>
	<div class="meta">📅 ${state.date}<br>${route.day}${route.late ? ' · ⏰ LATE LOAD 13:00' : ''}</div>
	</div>

	<div class="columns">
	<div class="col">${productTable(colA)}</div>
	<div class="col">${productTable(colB)}</div>
	</div>

	<div class="cashup-card">
	<div class="cashup-title">CASH UP — ${state.activeRoute} — ${state.date}</div>
	<div class="cashup-body">
	<div class="cashup-columns">

	<div class="denom-section">
	<div class="denom-grid">
	${denomLabels.map(denomCell).join('')}
	</div>
	<div class="staff-section">
	<div class="staff-row"><span>Sales:</span><span class="staff-line"></span></div>
	<div class="staff-row"><span>Driver:</span><span class="staff-line"></span></div>
	<div class="staff-row"><span>Stock:</span><span class="staff-line"></span></div>
	</div>
	</div>

	<div class="totals-section">
	<div class="totals-row"><span class="totals-label">Cash Counted</span><span><span class="currency">R</span><span class="box totals-box"></span></span></div>
	<div class="totals-row"><span class="totals-label">Cash Difference</span><span><span class="currency">R</span><span class="box totals-box"></span></span></div>
	<div class="totals-row"><span class="totals-label">Stock Sales</span><span><span class="currency">R</span><span class="box totals-box"></span></span></div>
	<div class="totals-row"><span class="totals-label">Zoho Sales</span><span><span class="currency">R</span><span class="box totals-box"></span></span></div>
	<div class="totals-row"><span class="totals-label">Stock Difference</span><span><span class="currency">R</span><span class="box totals-box"></span></span></div>
	</div>

	</div>

	</div>
	</div>

	</div>

	<script>
	(function() {
	var root = document.getElementById('printRoot');
	// FIXED 23 July 2026 -- on mobile (iPhone/iPad), the printout was overflowing
	// to a 2nd page unless Print scaling was manually dropped to ~85%. Root cause:
	// this fit-to-page scale calculation used to run IMMEDIATELY, before the
	// Poppins web font (loaded via @import) had finished downloading -- so it
	// measured the shorter fallback-font text height instead of the taller
	// Poppins text height, and under-scaled (or didn't scale at all). Now waits
	// for both the logo image AND document.fonts.ready before measuring, so the
	// one-page scaling always sees the real, final layout -- mobile and desktop.
	function scaleToFit() {
	var pageHeightPx = 1046; // A4 (297mm) minus 10mm top+bottom @page margins, at 96dpi
	var contentHeight = root.scrollHeight;
	if (contentHeight > pageHeightPx) {
	var scale = pageHeightPx / contentHeight;
	if (scale < 0.7) scale = 0.7;
	root.style.transform = 'scale(' + scale + ')';
	root.style.width = (100 / scale) + '%';
	}
	}
	function doPrint() { scaleToFit(); window.print(); window.close(); }
	var imgs = Array.prototype.slice.call(document.images);
	var pending = imgs.filter(function(img){ return !img.complete; });
	var fontsReady = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
	var imagesReady = new Promise(function(resolve) {
	if (pending.length === 0) { resolve(); return; }
	var remaining = pending.length;
	function checkDone() { remaining--; if (remaining <= 0) resolve(); }
	pending.forEach(function(img){ img.addEventListener('load', checkDone); img.addEventListener('error', checkDone); });
	});
	var done = false;
	function finish() { if (!done) { done = true; doPrint(); } }
	Promise.all([fontsReady, imagesReady]).then(finish);
	setTimeout(finish, 1500); // safety net for slow mobile networks
	})();
	<\/script>
	</body></html>
	`);
	}
	function printRoute() {
	

	const products = state.routeData[state.activeRoute].products;
	

	const route = state.routes.find(r => r.name === state.activeRoute);
	

	

	

	const printWin = window.open('', '_blank');
	

	printWin.document.write(`
	

	<html><head><title>FenMeat — ${state.activeRoute}</title>
	

	<style>
	

	@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap');
	body { font-family: 'Poppins', Arial, sans-serif; font-size: 12px; color: #24262E; }
	

	h1 { font-size: 18px; margin-bottom: 4px; border-bottom: 2px solid #003CFF; padding-bottom: 6px; }
	h1 .fen { color: #003CFF; }
	.print-logo { height: 26px; display: block; margin-bottom: 4px; border-bottom: 2px solid #003CFF; padding-bottom: 6px; }
	

	.meta { color: #666; margin-bottom: 12px; font-size: 11px; }
	

	table { width: 100%; border-collapse: collapse; }
	

	th { background: #12141C; color: white; padding: 6px 8px; text-align: left; font-size: 11px; }
	

	td { padding: 5px 8px; border-bottom: 1px solid #eee; }
	

	tr:nth-child(even) td { background: #f9f9f9; }
	

	.code { color: #999; font-size: 10px; }
	

	.num { text-align: center; font-weight: bold; font-size: 15px; }
	

	.footer { margin-top: 16px; font-size: 11px; color: #666; border-top: 1px solid #ccc; padding-top: 8px; }
	

	</style></head><body>
	

	<img class="print-logo" src="data:image/png;base64,${PRINT_LOGO_B64}" alt="FenMeat">
	

	<div class="meta">📅 ${state.date} | ${route.day}${route.late ? ' | ⏰ LATE LOAD 13:00' : ''}</div>
	

	<table>
	

	<tr>
	

	<th>Code</th>
	

	<th>Product</th>
	

	<th style="text-align:center">OUT</th>
	

	<th style="text-align:center">✓</th>
	

	<th style="text-align:center">IN</th>
	

	</tr>
	

	${products.map(p => `
	

	<tr>
	

	<td class="code">${p.code}</td>
	

	<td>${p.name}</td>
	

	<td class="num">${p.out || ''}</td>
	

	<td class="num">☐</td>
	

	<td class="num"></td>
	

	</tr>
	

	`).join('')}
	

	</table>
	

	<div class="footer">
	

	CASH UP: R _____________ | Signed: _________________ | Date: ${state.date}
	

	</div>
	

	<script>
	(function() {
	function doPrint() { window.print(); window.close(); }
	var imgs = Array.prototype.slice.call(document.images);
	var pending = imgs.filter(function(img){ return !img.complete; });
	if (pending.length === 0) { doPrint(); return; }
	var done = false, remaining = pending.length;
	function checkDone() { remaining--; if (remaining <= 0 && !done) { done = true; doPrint(); } }
	pending.forEach(function(img){ img.addEventListener('load', checkDone); img.addEventListener('error', checkDone); });
	setTimeout(function(){ if (!done) { done = true; doPrint(); } }, 1000);
	})();
	<\/script>
	

	</body></html>
	

	`);
	

	}
