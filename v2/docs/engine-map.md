# FenMeat se programkaart

Begin in die ry vir die betrokke handeling. Alle paaie is relatief tot `v2/`. Die bestaande hoofkieslys en aanmelding bedien al tien afdelings. Elke afdeling gebruik die aangeduide kode en toetse. Die enkele Cloudflare Worker en die D1-databasis is gedeel.

| Afdeling | Skerm | Bedienerkode en navrae | Toetse en verdere dokumentasie |
|---|---|---|---|
| Sales & Invoices | `public/app.js`, `public/invoicing/` | `src/sales-queries.js`, `src/invoice-api.js`, `src/invoice-auth.js`. Die roetestoorhandeling bly in `src/worker.js` | `test/invoicing.test.js`, `test/integration.test.js`, `INVOICING.md` |
| Factory POS | `public/pos-app.js` | `src/pos-api.js`, `src/pos-domain.js`. Pryse word by die katalogus aangevra by verkoopsinvoer | `test/pos.test.js`, `test/pos-ui.test.js`, `POS.md` |
| Staff & Payroll | `public/staff-app.js`, `public/pay-wages-ui.js`, `public/staff-clock.js` | `src/staff-api.js`, `src/staff-domain.js`, `src/payroll-api.js`, `src/pay-wages.js`, `src/pa-staff-reads.js`, `src/pa-attendance.js`, `src/pa-leave.js` | `test/staff-integrity.test.js`, `test/payroll-runtime.test.js`, `test/pa-access-runtime.test.js`, `docs/payroll.md` |
| Production | `public/production-app.js` | `src/production-api.js`, `src/production.js`. Lees verkope, voorspelling, resepte en POS-voorraad | `test/production-runtime.test.js`, `test/trolleys.test.js`, `PRODUCTION_PRINT.md` |
| Stock & Purchasing | `public/recipes-app.js`, `public/stocktake-view.js` | `src/order-guy-api.js`, `src/order-guy.js`, `src/stocktake.js`. Gebruik produksieplanne en voorspellings | `test/order-forecast-runtime.test.js`, `test/stocktake-runtime.test.js`, `FULL_PACK_STOCKTAKE.md` |
| Finance | `public/financial-app.js`, `public/financial-budget.js` | `src/finance-api.js`, `src/finance-domain.js`, `src/budget-domain.js`. Zoho se finansiële spieël is in `src/zoho-ledger.js` | `test/finance.test.js`, `test/budget.test.js`, `test/zoho-ledger.test.js`, `FINANCIAL.md` |
| Tasks & PA | `public/tasks-app.js`, `public/task-workspace-cache.js` | `src/tasks-api.js`, `src/task-workspace.js`, `src/task-access.js`, `src/task-conversation.js`, `src/pa-due-work.js`. Die PA-koppelvlak is in `src/pa-mcp.js` | `test/task-workspace.test.js`, `test/private-pa-security.test.js`, `docs/pa-task-connector.md` |
| Reports | `public/pa-report-ui.js`, `public/tasks-report.js` | `src/pa-report-api.js`, `src/pa-email.js`. Gebruik bestaande taak-ID’s en rolgefiltreerde terugvoer | `test/pa-report-runtime.test.js`, `test/report-task-integration.test.js`, `docs/task-conversations.md` |
| Forecast | Morning Load in `public/app.js` | `src/forecast-queries.js`, `src/forecast-history.js`, `src/month-cycle.js`, `src/forecast-evidence.js`. Production en bestellings gebruik dieselfde berekening | `test/forecast-history.test.js`, `test/order-forecast-runtime.test.js`, `docs/forecast-policy.md` |
| Rabbi | Rabbi-aansig in `public/pa-report-ui.js` | `src/rabbi-reading.js` lees die gedeelde dagstuk. Alex se interaktiewe privaat weergawe gebruik ook die bestaande verslag en terugvoer | `test/pa-report-runtime.test.js`, `test/private-pa-security.test.js`, `docs/private-pa-security.md` |

## Gedeelde grense

`src/connected-worker.js` hanteer OAuth en geskeduleerde werk. `src/worker.js` pas roetetoegang toe en stuur die versoek na die betrokke afdeling. `src/schema.js` stel ontbrekende tabelle en indekse bykomend op. Die enjin se API-lêer bevat sy navrae en berekenings. Gebruik die bestaande funksies vir pryse, lone en bestellingseenhede. Verander 'n gedeelde reël by die bron en toets sy gebruikers.

`build-assets.mjs` bou aparte blaaierlêers vir elke betrokke skerm. Groot PDF-kode word op aanvraag gelaai. Invoices en Staff Clock behou hul eie vanlyn waglyste. Personeel-, taak- en besigheidsdata bly onder die bestaande toegangs- en kasreëls.

## Direkte PA-funksies

Gebruik `get_staff_data({query:{resource:"hours",q:"Werknemernaam",from,to}})` vir een naam se klokure en goedgekeurde verlof. 'n Dubbelsinnige naam vra identifikasie. Die nuwe `attendance` aanvaar ook 'n werknemer-ID. Gebruik `wages` vir 'n Maandag–Vrydag-betaalweek, of die bestaande `hours.payroll` met 'n werknemer-ID. Behou alle waarskuwings en bedrae wat nog bevestig moet word.

Verlof lees met `get_staff_data` en `resource:"leave"`. Registreer 'n hangende aansoek met `request_staff_leave` ná afsonderlike verloftoestemming. Klokwerk gebruik `save_staff_attendance` met sy bestaande aparte toestemming. Lees die gestoorde resultaat terug. Die aktiewe ChatGPT-verbinding se beskikbare funksies en regte bepaal wat PA kan uitvoer.

Gebruik `get_tasks` met 'n app-ID of TSK-nommer. Die soekaansig gebruik `resource:"search"` en `q`. Gebruik `save_task` met die huidige weergawe, die oorspronklike taak-ID en 'n herhaalbare versoek-ID. Voorraad gebruik `get_material_stock`, bestellings `get_order_requirements` (opsionele `view:"summary"` en `supplier`), verkope `get_sales`, finansies `get_app_edit_context` met `target:"financial"`. Vir een finansiële rekord gebruik `resource:"record"` en sy ID.

## Toets, publikasie en terugrol

Toets vanuit `v2/` met `npm ci`, `npm test` en `npm run check:deploy`. Meet die taaklys en detail met `scripts/qa-task-speed.mjs` onder dieselfde netwerkprofiel. Gebruik `scripts/qa-staff-integrity.mjs` vir vanlyn klokwerk en herwinning. Gebruik `node scripts/measure-engine-reads.mjs` vir sewe warm monsters per plaaslike API-meting. 'n Lewendige taakmeting kom van `get_app_edit_context` met `target:"daily_report"`, `resource:"summary"` en `id:"tasks-workspace-open"`.

Die permanente kode-terugrolpunt vir die projek is `backup/modular-0.57.1-20261128`, op bronweergawe `5c35ca3`. Publiseer 'n voorwaartse terugrol van die betrokke uitgawe op `build/sales-v2-cloudflare` of kies die vorige Worker en sy ooreenstemmende bates. Gaan `/api/health`, aanmelding, taakdetail en 'n gemagtigde PA-lees na. Behou D1-data en toestelwaglyste tydens terugrol. Die ekstra roete/datum-indeks is versoenbaar met albei weergawes. Geen besigheidsdata word deur die vrystelling omgeskakel nie.
