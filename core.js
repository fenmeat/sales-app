const HEADER_LOGO_B64 = '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';
const PRINT_LOGO_B64 = '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';
document.getElementById('headerLogoImg').src = 'data:image/jpeg;base64,' + HEADER_LOGO_B64;

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzOvHW0qLnNQUP_kgImFdAXNcU7SMDsA6vYOFfeyyuBrs7j4MOrtWBgvoMv8Wba_A1yYw/exec';
const NEW_SHEET_ID = '1UzTdOY9_Ade5bQ4FsQz5_gMgQNmiWWEwIYDoRUKPpak';

function formatRand(n, decimals) {
	decimals = (decimals === undefined) ? 0 : decimals;
	const num = Number(n) || 0;
	const isNeg = num < 0;
	const fixed = Math.abs(num).toFixed(decimals);
	const parts = fixed.split('.');
	parts[0] = parts[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g, ' ');
	return (isNeg ? '-' : '') + parts.join('.');
}

const PRODUCTS = [
	{code:'W01', name:'BRAAI WORS', price:160},
	{code:'W02', name:'OUMA', price:85},
	{code:'W03', name:'CHAKALAKA', price:85},
	{code:'W04', name:'SUPERBRAAI', price:85},
	{code:'W05', name:'BABALAS WORS', price:85},
	{code:'W06', name:'BOEREWORS', price:120},
	{code:'W07', name:'PATTIES', price:80},
	{code:'W08', name:'MINCE', price:92},
	{code:'R01', name:'RUSSIAN 6', price:159},
	{code:'R02', name:'RUSSIAN 5', price:136},
	{code:'R03', name:'RUSSIAN 4', price:112},
	{code:'R04', name:'RUSSIAN 3', price:96},
	{code:'R05', name:'ECONO RUSSIAN', price:152},
	{code:'R06', name:'CHEESE RUSSIAN', price:200},
	{code:'R07', name:'BABALAS RUSSIAN', price:200},
	{code:'R08', name:'JUMBO RUSSIAN', price:80},
	{code:'V01', name:'VIENNA', price:120},
	{code:'V02', name:'CHEESE VIENNA', price:160},
	{code:'P01', name:'PIZZA TOPPINGS', price:160},
	{code:'P02', name:'POLONY SMALL', price:40},
	{code:'P03', name:'POLONY MED', price:64},
	{code:'P04', name:'POLONY LONG', price:112},
	{code:'C01', name:'CHICKEN BURGER', price:108},
	{code:'C02', name:'CHICKEN STEAK', price:108},
	{code:'C03', name:'CHICKEN NUGGETS', price:108},
	{code:'S01', name:'SIX GUN 20g', price:95},
	{code:'S02', name:'SIX GUN 200g', price:20},
	{code:'S03', name:'CHICKEN SOUPPACK', price:300},
	{code:'O01', name:'HEADS & FEET', price:200},
	{code:'O02', name:'CHICKEN NECKS', price:220},
	{code:'O03', name:'CHICKEN LIVERS', price:155},

	// DC Meat resale items (added 15 Aug 2026) -- bought-in products resold
	// alongside FenMeat's own range, not produced in-house.
	// Prices synced to live Zoho rates (TSK-00020, 6 Sep 2026).
	{code:'D01', name:'FRENCH POLONY BULK', price:82.00},
	{code:'D02', name:'BACON & EGG LOAF', price:18.00},
	{code:'D03', name:'RUSSIAN LOAF', price:18.00},
	{code:'D04', name:'LIVER SPREAD', price:15.00},
	{code:'D05', name:'VALUE POLONY HAMPER', price:195.00},
	{code:'D06', name:'SANDWICH HAM', price:24.00},
	{code:'D07', name:'FRENCH POLONY SLICED 200G', price:14.00},
	{code:'D08', name:'SELECT POLONY HAMPER 2.3KG', price:105.00},

	// Brito's resale items (added 24 Aug 2026) -- bought-in products resold
	// alongside FenMeat's own range, not produced in-house.
	// Prices synced to live Zoho rates (TSK-00020, 6 Sep 2026).
	{code:'B01', name:'SUPER BRAAIWORS BOX', price:150.00},
	{code:'B02', name:'LUNCH BOX HAMPER', price:95.00},
	{code:'B03', name:'STEWING PORK PIECES 2KG', price:55.00},
	{code:'B04', name:'SMOKED VIENNAS 5X280G', price:73.91},
	{code:'B05', name:'RUSSIANS SHORT 1.085KG', price:47.83},
];

function getRoutesForDate(dateStr) {
	const d = new Date(dateStr + 'T12:00:00');
	const day = d.getDay(); // 0=Sun,1=Mon,2=Tue,3=Wed,4=Thu,5=Fri,6=Sat

	// Friday alternation anchored to a known date (19 June 2026 = STILBAAI), counted in whole weeks.
	// This avoids calendar week-of-year drift across year boundaries.
	const altAnchor = new Date('2026-06-19T12:00:00');
	const weeksFromAnchor = Math.round((d - altAnchor) / (7 * 86400000));
	const isEvenWeek = weeksFromAnchor % 2 === 0;

	if (day === 1) return [{name:'GEORGE', day:'Monday', late:false}];
	if (day === 2) return [
		{name:'KNYSNA', day:'Tuesday', late:false},
		{name:'RIVERSDALE', day:'Tuesday', late:false},
		{name:'GROOTBRAK', day:'Tuesday', late:true},
	];
	if (day === 3) return [
		{name:'PACALTSDORP', day:'Wednesday', late:false},
		{name:'CRAGS', day:'Wednesday', late:false},
	];
	if (day === 4) return [
		{name:'MOSSEL BAY', day:'Thursday', late:false},
		{name:'PLETT', day:'Thursday', late:false},
	];
	if (day === 5) {
		const altRoute = isEvenWeek ? 'STILBAAI' : 'OUDTSHOORN';
		return [
			{name:'THEMBALETHU', day:'Friday', late:false},
			{name:altRoute, day:'Friday', late:false},
		];
	}
	return [];
}

let state = {
	date: '',
	mode: 'morning',
	routes: [],
	activeRoute: '',
	// Per route data: { routeName: { products: [{code, name, price, out, in, forecast}] } }
	routeData: {},
	forecastLoaded: false,
};

window.onload = function() {
	// Set today's date
	const today = new Date();
	const yyyy = today.getFullYear();
	const mm = String(today.getMonth()+1).padStart(2,'0');
	const dd = String(today.getDate()).padStart(2,'0');
	document.getElementById('dateInput').value = `${yyyy}-${mm}-${dd}`;
	onDateChange();

	// Test connection to Apps Script
	testConnection();
};

async function testConnection() {
	try {
		const url = `${SCRIPT_URL}?action=ping&sheetId=${NEW_SHEET_ID}`;
		const resp = await fetch(url);
		const data = await resp.json();
		if (data.status === 'ok') {
			setStatus('🟢 Connected', 'green');
		} else {
			setStatus('🟡 Script connected', 'orange');
		}
	} catch(e) {
		setStatus('🔴 Offline — using forecast data', 'red');
	}
}

function setStatus(msg, color) {
	const el = document.getElementById('connectionStatus');
	el.textContent = msg;
	el.style.color = color === 'green' ? '#27AE60' : color === 'red' ? '#E74C3C' : '#F39C12';
}

function onDateChange() {
	const dateStr = document.getElementById('dateInput').value;
	if (!dateStr) return;

	state.date = dateStr;
	state.routes = getRoutesForDate(dateStr);
	state.forecastLoaded = false;

	if (state.routes.length === 0) {
		document.getElementById('routeTabs').innerHTML = '';
		document.getElementById('mainContent').innerHTML = `
			<div class="loading">
				<div style="font-size:40px;margin-bottom:12px">😴</div>
				<strong>No routes today</strong><br>
				<span style="color:var(--muted)">Routes run Monday to Friday only</span>
			</div>`;
		return;
	}

	// Init route data
	state.routes.forEach(r => {
		if (!state.routeData[r.name]) {
			state.routeData[r.name] = {
				products: PRODUCTS.map(p => ({...p, out: 0, inQty: 0, forecast: 0, loaded: false}))
			};
		}
	});

	state.activeRoute = state.routes[0].name;
	renderRouteTabs();
	loadForecastData();
}

function renderRouteTabs() {
	const tabsEl = document.getElementById('routeTabs');
	tabsEl.innerHTML = state.routes.map(r => `
		<button class="route-tab ${r.name === state.activeRoute ? 'active' : ''}"
			onclick="setActiveRoute('${r.name}')">
			${r.name}
			${r.late ? '<span class="late-badge">13:00</span>' : ''}
		</button>
	`).join('');
}

function setActiveRoute(name) {
	state.activeRoute = name;
	renderRouteTabs();
	renderContent();
}

function setMode(mode) {
	state.mode = mode;
	document.getElementById('btnMorning').className = `mode-btn morning ${mode === 'morning' ? 'active' : ''}`;
	document.getElementById('btnEvening').className = `mode-btn evening ${mode === 'evening' ? 'active' : ''}`;
	document.getElementById('btnCashUp').className = `mode-btn cashup ${mode === 'cashup' ? 'active' : ''}`;
	document.getElementById('btnCommission').className = `mode-btn commission ${mode === 'commission' ? 'active' : ''}`;
	document.getElementById('btnStock').className = `mode-btn stock ${mode === 'stock' ? 'active' : ''}`;

	// Commission and Stock are views across all routes, not per-route — hide the route tabs for both
	document.getElementById('routeTabs').style.display = (mode === 'commission' || mode === 'stock') ? 'none' : '';

	renderContent();
}

function renderContent() {
	// Commission and Stock are views across all routes, not tied to state.activeRoute
	if (state.mode === 'commission') {
		renderCommission();
		return;
	}
	if (state.mode === 'stock') {
		renderStock();
		return;
	}

	const route = state.routes.find(r => r.name === state.activeRoute);
	if (!route) return;

	const rData = state.routeData[state.activeRoute];
	if (!rData || !rData.products[0].loaded) {
		document.getElementById('mainContent').innerHTML = `
			<div class="loading">
				<div class="spinner"></div>
				Loading ${state.activeRoute} data...
			</div>`;
		return;
	}

	const products = rData.products;
	const totalOut = products.reduce((s, p) => s + p.out, 0);
	const totalIn = products.reduce((s, p) => s + p.inQty, 0);
	const totalSold = totalOut - totalIn;
	const totalValue = products.reduce((s, p) => s + (p.out - p.inQty) * p.price, 0);
	// Added 22 July 2026 -- flat-rate commission (R5/item, excl. Six Gun 200g) for
	// RIVERSDALE / OUDTSHOORN / STILBAAI needs a total items-sold count.
	const itemsSoldExclS02 = products.reduce((s, p) => s + (p.code === 'S02' ? 0 : (p.out - p.inQty)), 0);

	if (state.mode === 'morning') {
		renderMorning(route, products, totalOut, totalValue);
	} else if (state.mode === 'evening') {
		renderEvening(route, products, totalOut, totalIn, totalSold, totalValue);
	} else {
		renderCashUp(route, totalValue, itemsSoldExclS02);
	}
}

function showToast(msg, type) {
	const existing = document.querySelector('.toast');
	if (existing) existing.remove();
	const t = document.createElement('div');
	t.className = `toast ${type}`;
	t.textContent = msg;
	document.body.appendChild(t);
	setTimeout(() => t.remove(), 3500);
}
