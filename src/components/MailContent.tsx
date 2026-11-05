import { useMemo, useState } from 'react';
import type { MailContent as Content } from '../mailContent';
import { useLanguage } from '../i18n';
import { Icon } from './Icon';
export function MailContent({mail}:{mail:Content}) {
 const en=useLanguage()==='en';const [images,setImages]=useState(false);
 const document=useMemo(()=>{
  const nonce=window.document.querySelector<HTMLElement>('style[nonce],script[nonce]')?.nonce || '';
  const parsed=new DOMParser().parseFromString(mail.html,'text/html');
  const sheets=[...parsed.querySelectorAll<HTMLLinkElement>('link[rel=stylesheet][href]')].map(link=>link.getAttribute('href') || '').filter(href=>/^https:\/\//i.test(href));
  parsed.querySelectorAll('script,iframe,frame,object,embed,base,meta,link,form').forEach(e=>e.remove());
  parsed.querySelectorAll('*').forEach(e=>{for(const attribute of [...e.attributes]){if(attribute.name.startsWith('on') || ['href','srcdoc','action','formaction'].includes(attribute.name))e.removeAttribute(attribute.name);}});
  parsed.querySelectorAll('style').forEach(style=>{if(nonce)style.setAttribute('nonce',nonce);});
  if(images)for(const href of sheets){const link=parsed.createElement('link');link.rel='stylesheet';link.href=href;if(nonce)link.setAttribute('nonce',nonce);parsed.head.append(link);}
  const policy=`default-src 'none'; style-src 'unsafe-inline' ${images?'https:':''} ${nonce ? `'nonce-${nonce}'` : ''}; style-src-attr 'unsafe-inline'; img-src data: ${images?'https:':''}; font-src data: ${images?'https:':''}; base-uri 'none'; form-action 'none'`;
  const opening=parsed.documentElement.cloneNode(false) as HTMLElement;
  return `<!doctype html>${opening.outerHTML.slice(0,-7)}<head><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer"><style nonce="${nonce}">body{margin:12px;background:white;color:#222;font:14px/1.5 Arial,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}</style>${parsed.head.innerHTML}</head>${parsed.body.outerHTML}</html>`;
 },[mail.html,images]);
 // The head is a grid: subject and sender on the left, the remote-content switch fixed at the top right whatever their
 // length. Notes read from attachments (PDF) get a box of their own above the mail, folded to a few lines.
 return <section className="mail-content"><header className="mail-content-head">
   <strong className="mail-content-subject">{mail.subject}</strong><small className="mail-content-sender">{mail.sender}</small>
   {mail.html && <button type="button" className={`mail-content-remote${images?' is-on':''}`} aria-pressed={images} onClick={()=>setImages(v=>!v)}><Icon name={images?'cancel':'layout'}/><span>{images?(en?'Hide remote content':'Externe Inhalte ausblenden'):(en?'Load images and styles':'Externe Bilder und Styles laden')}</span></button>}
  </header>
  {mail.html && mail.notes && <details className="mail-content-notes" open><summary><Icon name="note"/>{en?'From the attachments':'Aus den Anhängen'}</summary><pre>{mail.notes}</pre></details>}
  {mail.html ? <iframe title={en?'Email content':'E-Mail-Inhalt'} sandbox="" referrerPolicy="no-referrer" srcDoc={document}/> : <pre className="mail-content-text">{mail.text}</pre>}</section>;
}
