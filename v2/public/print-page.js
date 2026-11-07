import {openPrintPreview} from './print-preview.js';
import {printPageOptions} from './print-page-options.js';

try{
 const options=printPageOptions(location.search);
 document.getElementById('print-page-return').href=options.returnPath;
 document.getElementById('print-page-message').textContent='Return to your original FenMeat window to continue. Your entries remain there.';
 openPrintPreview({...options,browserPage:true});
}catch(e){document.getElementById('print-page-message').textContent=e.message;}
