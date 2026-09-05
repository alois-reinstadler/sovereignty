import { FormDiscovery } from "../src/forms";
const result=document.getElementById("result");
for(const form of Array.from(document.forms))form.addEventListener("submit",event=>{event.preventDefault();if(result)result.textContent="Synthetic submission received. No network request made.";});
document.getElementById("replace")?.addEventListener("click",()=>{const form=document.getElementById("primary");if(form)form.replaceWith(form.cloneNode(true));});
document.getElementById("disable")?.addEventListener("click",()=>{document.querySelector('#primary input[type="password"]')?.setAttribute("readonly","");});
// Browser verification API exercises the actual module, never accepts real credentials.
const discovery=new FormDiscovery();
Object.assign(window,{sovereigntyFixture:{discover:()=>discovery.discover(document,location.origin),fill:(id:string)=>discovery.fill(id,location.origin,"synthetic-user","synthetic-password-only")}});
