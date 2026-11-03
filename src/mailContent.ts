const prefix='journal-mail:v1\n';
export interface MailContent {html:string;text:string;subject:string;sender:string;notes?:string}
export function encodeMailContent(value:MailContent):string{return prefix+JSON.stringify({...value,html:value.html.slice(0,180000),text:value.text.slice(0,100000)});}
export function decodeMailContent(value:string|undefined):MailContent|null{if(!value?.startsWith(prefix))return null;try{const data=JSON.parse(value.slice(prefix.length));return typeof data.html==='string' && typeof data.text==='string' && typeof data.subject==='string' && typeof data.sender==='string'?data:null;}catch{return null;}}
