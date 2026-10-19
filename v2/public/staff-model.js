// Display only. All clock, leave and permission decisions happen on the server.
export const ZONE='Africa/Johannesburg';
export function localDay(at){return new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));}
export function clockTime(at){return new Intl.DateTimeFormat('en-GB',{timeZone:ZONE,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(at));}
export function hoursLabel(seconds){const mins=Math.floor(seconds/60);return `${Math.floor(mins/60)}h ${String(mins%60).padStart(2,'0')}m`;}
