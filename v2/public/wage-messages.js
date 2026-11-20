// Existing saved wage rows keep their original reasons and audit text.
const messages = new Map([
 ['Correct hours or mark absent.','Die klok wys geen werk of verlof nie. Die week se loon is onvolledig. Kies Verander hierdie dag of teken verlof aan.'],
 ['Confirm attendance or mark absent.','Daar is geen rooster of klokure nie. Bevestig die ure of afwesigheid vir hierdie dag.'],
 ['The clock entry is under one minute. Correct the hours.','Die skof is korter as ’n minuut. Die loon kan te laag wees. Maak die inklok- of uitkloktyd reg.'],
 ['Reported sick. Confirm paid sick leave or unpaid sick leave.','Die werknemer was siek. Die dag se betaling is nog oop. Kies Teken verlof aan.'],
 ['Check the workplace or previous hours correction.','Die werkplek of pouse is onseker. Die betaalbare ure kan verander. Maak die dag oop en bevestig die werkplek en ure.'],
 ['Clock sessions overlap. Correct the attendance record.','Twee skofte oorvleuel. Die ure kan dubbel tel. Maak die klokinskrywings vir dié dag reg.'],
 ['Work and leave on the same day','Die dag bevat verlof én gewerkte ure. Vergelyk die kloktye met die verlof voordat jy betaal.'],
 ['Open shift','Die skof is nog oop. Die loon kort die laaste ure. Vul die werklike uitkloktyd in.'],
 ['Spans midnight','Die skof loop oor middernag. Kontroleer die twee datums en die uitkloktyd.'],
 ['Long shift','Die skof is langer as 16 uur. ’n Verkeerde tyd kan te veel loon bytel. Gaan die kloktye na.'],
 ['Missing attendance record','Klokure ontbreek. Vul die werklike ure in of teken die afwesigheid aan.'],
 ['Schedule not verified','Die rooster ontbreek. Vul die gewone werkdae en ure by die werknemer in.'],
 ['Enter the agreed pay rate.','Die werknemer se loonkoers ontbreek. Kies Loonkoers en vul die ooreengekome bedrag in.'],
 ['Enter the agreed hourly rate.','Die uurtarief ontbreek. Kies Loonkoers en vul die bedrag per uur in.'],
 ['Excluded from this week.','Dié werknemer is uit hierdie week se betaalstaat gelaat. Gaan die vorige loonbesluit onder Geskiedenis na.'],
 ['Confirm whether earlier November pay leaves room for both UIF shares this week.','Ons kort die UIF van vroeër in November om die finale bedrag te bereken. Kies Vul vorige UIF in en gebruik die vorige loonstaat.'],
 ['Earlier November earnings may reach the ceiling. Enter the current UIF shares.','Die maand se UIF kan reeds die maksimum bereik het. Kies Vul vorige UIF in sodat die app die oorblywende bedrag kan bereken.'],
 ['Confirm the earlier unpaid week for this employee before finalising monthly UIF.','Hierdie werknemer se vorige week is nog oop. Kyk eers of daardie loon goedgekeur of betaal is. Dit bepaal hoeveel UIF hierdie week oorbly.'],
 ['Confirm whether this employee works at least 24 hours this month for Fen Meat.','Ons kort die werknemer se ure vir die maand om UIF te bepaal. Kies Aftrekkings en bevestig of die werknemer minstens 24 uur by Fen Meat in diens is.'],
 ['The monthly hours now reach 24. Correct the UIF treatment.','Die ure vir die maand is nou minstens 24. Kies Aftrekkings en verander die UIF-keuse.'],
 ['Confirm the applicable PAYE basis or this week’s directive amount.','Die belastingreëling is onseker. Kies Loonkoers vir die SARS-opdrag of vul die bevestigde belasting vir dié week in.'],
 ['Confirm the date of birth for the SARS weekly table.','Die geboortedatum kan die belastingbedrag verander. Vul die bevestigde datum onder Loonkoers in.'],
 ['Reconcile the sick day with the new attendance or leave entry.','Die siekdag en die nuwer klok- of verlofinskrywing verskil. Gaan dié dag na sodat dit net een keer betaal word.'],
 ['Check the fixed wage against agreed hours and the minimum wage.','Die vaste weekloon en rooster moet vergelyk word om die minimumloon te toets. Gaan die tarief en gewone ure na.'],
 ['Deductions exceed gross pay.','Die aftrekkings is meer as die bruto loon. Gaan die bedrae onder Aftrekkings na.'],
 ['Check the saved manual week against current hours and deductions.','’n Vorige handmatige berekening verskil. Vergelyk dit met die dagure en bevestig die korrekte syfers onder Aftrekkings.'],
 ['Payroll or Staff records changed. Reload Payroll before saving.','Iemand het die loon of personeelrekord intussen verander. Maak toe, kies Herlaai en vergelyk die nuutste bedrag.'],
 ['Clock records changed. Reload and refresh the draft before saving.','Klokure het verander terwyl die vorm oop was. Maak toe en kies Herlaai om die nuutste ure te sien.'],
 ['Another Staff action was saved first. Reload the saved records and review your change.','’n Ander verandering is eerste gestoor. Maak toe en kies Herlaai voordat jy weer probeer.'],
 ['Reopen the unpaid approval first. Paid payslips are frozen.','Die loon is reeds goedgekeur. Heropen dit as dit nog onbetaal is. Vir ’n betaalde loon, teken ’n regstelling op ’n volgende betaalstaat aan.'],
 ['Only an unpaid approval can be reopened.','Slegs ’n goedgekeurde loon wat nog nie betaal is nie kan heropen word.'],
 ['Record only approved, unpaid wages.','Die betaalstatus het verander. Herlaai en kyk of die betaling reeds aangeteken is.'],
 ['Use a scheduled day with no attendance or approved leave.','Die dag het reeds klokure of verlof. Gebruik Teken verlof aan om die bestaande inskrywing te verander.'],
 ['Verify the opening leave balance first.','Die verlofsaldo ontbreek. Vul die bevestigde saldo onder Verlof in.'],
 ['Insufficient verified leave balance for this date.','Die verlofsaldo is te min. Kyk na die saldo of teken goedgekeurde ekstra betaalde afwesigheid aan.'],
 ['The corrected shift overlaps another shift.','Die nuwe tye oorvleuel met ’n ander skof. Gaan albei skofte se tye na.'],
 ['Clock entries must be in chronological order.','Die kloktye is uit volgorde. Kontroleer die datum en tyd van elke inskrywing.'],
 ['A correction cannot use a future clock time.','Die kloktyd lê in die toekoms. Kyk na die datum en vul die werklike tyd in.'],
 ['This clock action does not match the current status.','Die klokinskrywings is uit volgorde. Begin met inklok, plaas die pouses tussenin en eindig met uitklok.'],
 ['The clock records changed.','Die klokure het verander. Maak die skof weer oop.'],
 ['Check gross and PAYE first.','Kontroleer die bruto loon en vul ’n geldige belastingbedrag in.'],
 ['Enter total paid minutes for this day.','Vul die dag se totale betaalbare ure en minute in.'],
 ['Check the pay date and employer details.','Kyk of die betaaldatum aangebreek het en of Fen Meat se werkgewerbesonderhede ingevul is.'],
 ['Approved Fen runs by Friday pay date, plus verified opening amounts. Drafts excluded.','Goedgekeurde Vrydaglone en bevestigde beginsaldo’s.'],
 ['Historical payroll is held by the auditors. See Employee history and Imported records.','Die ouditeure het die vorige lone. Die ou inligting is onder Werknemergeskiedenis en Ou rekords.'],
 ['Incomplete November report. App payroll from 16 November only. Earlier payments are held by the auditors and excluded. This is not a full statutory report.','November is onvolledig. Hierdie verslag begin op 16 November. Die ouditeure het die betalings van vroeër in die maand.'],
 ['Partial month. Only approved app payroll is included.','Die maand is onvolledig. Slegs goedgekeurde lone is ingesluit.'],
 ['All scheduled Fridays are included. Approved app payroll by Friday pay date.','Al die geskeduleerde Vrydae se goedgekeurde lone is ingesluit.'],
 ['Production','Produksie'],['Mon','Maandag'],['Tue','Dinsdag'],['Wed','Woensdag'],['Thu','Donderdag'],['Fri','Vrydag'],['Sat','Saterdag'],['Sun','Sondag'],
 ['Too little information','Kort inligting'],
 ['Annual','Jaarverlof'],['Sick','Siekverlof'],['Unpaid','Onbetaalde verlof'],['Other paid','Ander betaalde afwesigheid'],['Family responsibility','Gesinsverantwoordelikheidsverlof'],
 ['Approved','Goedgekeur'],['Paid','Betaal'],['Pending','Wag vir goedkeuring'],['Cancelled','Gekanselleer'],['Declined','Afgekeur'],['Draft','Konsep'],['Voided','Teruggetrek'],['Reference','Geskiedenis'],
 ['Cash','Kontant'],['Bank','Bank'],['Hourly','Uurliks'],['Fixed weekly','Vaste weekloon'],['Factory','Fabriek'],['Route','Roete'],['Unconfirmed','Onbevestig'],['Team to confirm','Span nog onbekend'],
 ['in','Inklok'],['out','Uitklok'],['break_start','Begin pouse'],['break_end','Einde van pouse'],['Recorded breaks','Geklokte pouses'],['60 minutes if no break recorded','60 minute as geen pouse geklok is nie'],
 ['Liable','UIF is betaalbaar'],['Exempt','Vrygestel van UIF'],['Review each week','Bepaal uit die ure'],['Use ordinary schedule','Gebruik die gewone rooster'],['Standard weekly','Gewone weeklikse belasting'],['Directive','SARS-opdrag'],['Other','Ander'],['Use break rule','Gebruik die gewone pouse'],['Rotating road crew','Werkers wat op die roete beurte maak'],['No rotation','Geen beurtstelsel'],['Regular','Vaste werknemer'],['Casual','Los werker'],['Active','Aktief'],['Inactive','Onaktief']
]);
export const label=value=>messages.get(value)??value;
export function wageMessage(value) {
 const raw=String(value??'');
 const match=raw.match(/^(\d{4}-\d\d-\d\d) · (.*)$/);
 if(match)return match[1]+' · '+wageMessage(match[2]);
 if(messages.has(raw))return messages.get(raw);
 if(raw.startsWith('Worked with the team'))return 'Die werknemer het saam met die span gewerk. Die presiese betaalbare ure ontbreek. Vul dit by Verander hierdie dag in.';
 if(raw.includes('weekly table')||raw.includes('SARS table'))return 'Die SARS-tabel dek nie hierdie loon of tydperk nie. Vul die bevestigde belastingbedrag vir hierdie week in.';
 if(/holiday|Sunday|weekend|Saturday/.test(raw))return 'Dié dag se naweek- of vakansiedagloon kort ’n werkrooster of vorige weekure. Gaan die betrokke dag en sy tarief na.';
 if(raw.startsWith('Enter ')&&raw.includes('reason'))return 'Vul kortliks in hoekom jy die verandering maak.';
 if(raw.includes('UIF share'))return 'Die UIF-bedrag is hoër as wat oorbly vir die maand. Vergelyk dit met die vorige loonstaat en vul die regte bedrag in.';
 if(raw.includes('is not ready'))return 'Die bedrag is nog voorlopig. Maak die werknemer oop en voltooi die ontbrekende inligting.';
 if(raw.includes('Rate changes inside'))return 'Die loonkoers het binne die week verander. Gaan die tariewe en onderskeie datums na voordat jy betaal.';
 return raw;
}
