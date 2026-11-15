let token = localStorage.getItem("summit_token") || "";
let currentUser = null;
let currentPage = "dashboard";
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money = n => "KSh " + Number(n || 0).toLocaleString("en-KE",{minimumFractionDigits:2,maximumFractionDigits:2});
const today = () => new Date().toISOString().slice(0,10);

async function api(url, options={}) {
  const headers = {"Content-Type":"application/json", ...(options.headers||{})};
  if (token) headers.Authorization = "Bearer " + token;
  const response = await fetch("/api"+url,{...options,headers});
  const data = await response.json().catch(()=>({}));
  if (response.status===401 && url!=="/login") { logout(); throw new Error("Session expired. Please sign in again."); }
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}
function notify(message,bad=false){const n=$("#notice");n.textContent=message;n.classList.remove("hidden","bad");if(bad)n.classList.add("bad");setTimeout(()=>n.classList.add("hidden"),4500)}
function showLogin(){ $("#loginView").classList.remove("hidden");$("#appView").classList.add("hidden"); }
function showApp(){ $("#loginView").classList.add("hidden");$("#appView").classList.remove("hidden");$("#userName").textContent=currentUser.full_name;$("#userRole").textContent=currentUser.role.toUpperCase();$("#userInitial").textContent=currentUser.full_name[0].toUpperCase();document.querySelectorAll(".nav-item").forEach(b=>{b.classList.toggle("hidden",!b.classList.contains(currentUser.role)&&!["dashboard","announcements","messages"].includes(b.dataset.page));}); }
function logout(){token="";currentUser=null;localStorage.removeItem("summit_token");showLogin();}
$("#loginForm").addEventListener("submit",async e=>{e.preventDefault();$("#loginError").textContent="";const f=new FormData(e.currentTarget);try{const r=await api("/login",{method:"POST",body:JSON.stringify({email:f.get("email"),password:f.get("password")})});token=r.token;localStorage.setItem("summit_token",token);currentUser=r.user;showApp();await navigate("dashboard");}catch(err){$("#loginError").textContent=err.message;}});
$("#logoutBtn").addEventListener("click",logout);
$("#navigation").addEventListener("click",e=>{const b=e.target.closest("[data-page]");if(b)navigate(b.dataset.page);});

async function navigate(page){
  currentPage=page;document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
  const titles={dashboard:"Overview",students:"Student records",classes:"Classes",staff:"Staff & accounts",attendance:"Attendance",results:"Academic results",fees:"Fees & finance",announcements:"Announcements",messages:"Messages"};
  $("#pageTitle").textContent=titles[page]||"Portal";
  const host=$("#pageContent");host.innerHTML='<div class="panel">Loading records…</div>';
  try{
    if(page==="dashboard") await dashboard(host);
    if(page==="students") await students(host);
    if(page==="classes") await classes(host);
    if(page==="staff") await staff(host);
    if(page==="attendance") await attendance(host);
    if(page==="results") await results(host);
    if(page==="fees") await fees(host);
    if(page==="announcements") await announcements(host);
    if(page==="messages") await messages(host);
  }catch(err){host.innerHTML=`<div class="panel error">${esc(err.message)}</div>`;}
}
function table(headers,rows){return `<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.length?rows.join(""):`<tr><td colspan="${headers.length}" class="empty">No records found.</td></tr>`}</tbody></table></div>`;}
async function dashboard(host){
  const d=await api("/dashboard");
  if(d.role==="parent"){
    host.innerHTML=`<div class="panel"><h2>My learners</h2><p class="muted-line">Only learners linked to your parent account are shown here.</p>${table(["Admission no.","Learner","Class"],d.children.map(s=>`<tr><td>${esc(s.admission_no)}</td><td>${esc(s.first_name+" "+s.last_name)}</td><td>${esc(s.class_name||"Not assigned")}</td></tr>`))}</div><div class="cards-2"><div class="panel"><h2>Academic records</h2><p class="helper">Open Academics to view published assessment records for your linked learners.</p></div><div class="panel"><h2>Fee statements</h2><p class="helper">Open Fees to review invoices, recorded payments and balances.</p></div></div>`;return;
  }
  host.innerHTML=`<div class="grid">
    <div class="stat"><small>Active learners</small><strong>${d.students}</strong><em>Registered students</em></div>
    <div class="stat"><small>Classes</small><strong>${d.classes}</strong><em>Learning groups</em></div>
    <div class="stat"><small>Teachers</small><strong>${d.teachers}</strong><em>Active staff accounts</em></div>
    <div class="stat"><small>Present today</small><strong>${d.presentToday}</strong><em>Attendance records</em></div>
  </div><div class="cards-2"><div class="panel"><h2>Fee collection</h2><p class="muted-line">Recorded payments against all invoices</p><strong>${money(d.feesCollected)}</strong></div><div class="panel"><h2>Fees invoiced</h2><p class="muted-line">Total invoices created</p><strong>${money(d.feesInvoiced)}</strong></div></div><div class="panel"><h2>Welcome to your school workspace</h2><p class="helper">Use the navigation to manage school records. Only enter real learner information after the school has approved its privacy, access and data-retention procedures.</p></div>`;
}
async function students(host){
 const [rows,cls]=await Promise.all([api("/students"),api("/classes")]);
 host.innerHTML=`<div class="panel"><div class="panel-head"><h2>Student register</h2>${currentUser.role==="admin"?'<button class="primary" id="addStudent">+ Register learner</button>':""}</div><div class="toolbar"><input id="studentSearch" placeholder="Search name or admission number"></div><div id="studentTable">${studentTable(rows)}</div></div>`;
 const draw=list=>$("#studentTable").innerHTML=studentTable(list);
 $("#studentSearch").addEventListener("input",e=>draw(rows.filter(s=>(s.first_name+" "+s.last_name+" "+s.admission_no).toLowerCase().includes(e.target.value.toLowerCase()))));
 if($("#addStudent"))$("#addStudent").onclick=()=>modal("Register learner",`<form id="studentForm" class="form-grid">
 <label>Admission number<input name="admission_no" required></label><label>First name<input name="first_name" required></label><label>Last name<input name="last_name" required></label>
 <label>Gender<select name="gender"><option value="">Select</option><option>Female</option><option>Male</option><option>Other</option></select></label><label>Date of birth<input type="date" name="date_of_birth"></label>
 <label>Class<select name="class_id"><option value="">Unassigned</option>${cls.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></label>
 <label>Parent/guardian name<input name="parent_name"></label><label>Parent phone<input name="parent_phone"></label><label class="wide">Parent email<input type="email" name="parent_email"></label>
 <button class="primary wide">Save learner</button></form>`);
}
function studentTable(rows){return table(["Admission no.","Learner","Class","Parent/guardian","Status"],rows.map(s=>`<tr><td>${esc(s.admission_no)}</td><td>${esc(s.first_name+" "+s.last_name)}</td><td>${esc(s.class_name||"—")}</td><td>${esc(s.parent_name||s.parent_email||"—")}</td><td><span class="tag">${esc(s.status)}</span></td></tr>`));}
async function classes(host){
 const rows=await api("/classes");
 host.innerHTML=`<div class="panel"><div class="panel-head"><h2>Class list</h2>${currentUser.role==="admin"?'<button id="addClass" class="primary">+ Add class</button>':""}</div>${table(["Class","Class teacher"],rows.map(c=>`<tr><td>${esc(c.name)}</td><td>${esc(c.teacher_name||"Not assigned")}</td></tr>`))}</div>`;
 if($("#addClass"))$("#addClass").onclick=()=>modal("Create class",`<form id="classForm"><label>Class name<input name="name" placeholder="Grade 1 East" required></label><button class="primary" style="margin-top:14px">Create class</button></form>`);
}
async function staff(host){
 const rows=await api("/staff");
 host.innerHTML=`<div class="panel"><div class="panel-head"><h2>Staff and accounts</h2><button id="addStaff" class="primary">+ Create account</button></div>${table(["Name","Email","Phone","Role","Status"],rows.map(u=>`<tr><td>${esc(u.full_name)}</td><td>${esc(u.email)}</td><td>${esc(u.phone||"—")}</td><td><span class="tag">${esc(u.role)}</span></td><td>${u.active?"Active":"Disabled"}</td></tr>`))}<p class="helper">Create separate teacher and parent accounts. Link parent accounts to learners using the protected API documented in README.</p></div>`;
 $("#addStaff").onclick=()=>modal("Create user account",`<form id="staffForm" class="form-grid"><label>Full name<input name="full_name" required></label><label>Email<input name="email" type="email" required></label><label>Phone<input name="phone"></label><label>Role<select name="role"><option value="teacher">Teacher</option><option value="parent">Parent</option><option value="admin">Administrator</option></select></label><label class="wide">Temporary password<input name="password" type="password" minlength="10" required></label><button class="primary wide">Create account</button></form>`);
}
async function attendance(host){
 const [studentsRows,records]=await Promise.all([api("/students"),api("/attendance?date="+today())]);
 host.innerHTML=`<div class="panel"><div class="panel-head"><h2>Daily attendance</h2><span class="tag">${today()}</span></div><form id="attendanceForm" class="form-grid">
 <label>Learner<select name="student_id" required>${studentsRows.map(s=>`<option value="${s.id}">${esc(s.admission_no+" — "+s.first_name+" "+s.last_name)}</option>`).join("")}</select></label>
 <label>Status<select name="status"><option>Present</option><option>Absent</option><option>Late</option><option>Excused</option></select></label>
 <label>Date<input type="date" name="attendance_date" value="${today()}" required></label><label>Notes<input name="notes"></label><button class="primary wide">Save attendance</button></form></div><div class="panel"><h2>Saved attendance</h2>${table(["Learner","Date","Status","Notes"],records.map(a=>`<tr><td>${esc(a.first_name+" "+a.last_name)}</td><td>${esc(a.attendance_date).slice(0,10)}</td><td><span class="tag">${esc(a.status)}</span></td><td>${esc(a.notes||"—")}</td></tr>`))}</div>`;
}
async function results(host){
 const [records,studentsRows]=await Promise.all([api("/results"),currentUser.role==="parent"?Promise.resolve([]):api("/students")]);
 host.innerHTML=`${currentUser.role!=="parent"?`<div class="panel"><h2>Enter assessment result</h2><form id="resultForm" class="form-grid">
 <label>Learner<select name="student_id" required>${studentsRows.map(s=>`<option value="${s.id}">${esc(s.admission_no+" — "+s.first_name+" "+s.last_name)}</option>`).join("")}</select></label>
 <label>Subject<input name="subject" required placeholder="Mathematics"></label><label>Assessment<input name="assessment" required placeholder="End of term test"></label>
 <label>Score<input name="score" type="number" min="0" step="0.01" required></label><label>Maximum score<input name="out_of" type="number" min="1" step="0.01" value="100" required></label>
 <label>Term<input name="term" required placeholder="Term 1"></label><label>Academic year<input name="academic_year" type="number" value="${new Date().getFullYear()}"></label><button class="primary wide">Save result</button></form></div>`:""}
 <div class="panel"><h2>Academic records</h2>${table(["Learner","Subject","Assessment","Score","Term","Year"],records.map(r=>`<tr><td>${esc(r.first_name+" "+r.last_name)}</td><td>${esc(r.subject)}</td><td>${esc(r.assessment)}</td><td>${r.score}/${r.out_of}</td><td>${esc(r.term)}</td><td>${r.academic_year}</td></tr>`))}</div>`;
}
async function fees(host){
 const [records,studentsRows]=await Promise.all([api("/fees"),currentUser.role==="parent"?Promise.resolve([]):api("/students")]);
 host.innerHTML=`${currentUser.role==="admin"?`<div class="cards-2"><div class="panel"><h2>Create fee invoice</h2><form id="invoiceForm" class="form-grid"><label class="wide">Learner<select name="student_id">${studentsRows.map(s=>`<option value="${s.id}">${esc(s.admission_no+" — "+s.first_name+" "+s.last_name)}</option>`).join("")}</select></label><label>Description<input name="description" required placeholder="Term 1 tuition"></label><label>Amount (KSh)<input name="amount" type="number" min="0" step=".01" required></label><label>Term<input name="term" required value="Term 1"></label><label>Academic year<input name="academic_year" type="number" value="${new Date().getFullYear()}"></label><label class="wide">Due date<input name="due_date" type="date"></label><button class="primary wide">Create invoice</button></form></div><div class="panel"><h2>Record a payment</h2><form id="paymentForm" class="form-grid"><label class="wide">Invoice<select name="invoice_id">${records.filter(i=>i.balance>0).map(i=>`<option value="${i.id}">#${i.id} ${esc(i.first_name+" "+i.last_name)} — balance ${money(i.balance)}</option>`).join("")}</select></label><label>Amount (KSh)<input name="amount" type="number" min=".01" step=".01" required></label><label>Method<select name="method"><option>Cash</option><option>Bank</option><option>M-Pesa (recorded manually)</option><option>Other</option></select></label><label class="wide">Reference<input name="reference" placeholder="Receipt or transaction reference"></label><button class="primary wide">Record payment</button></form><p class="helper">This records a payment already received. It does not initiate or verify an M-Pesa transaction.</p></div></div>`:""}
 <div class="panel"><h2>Fee statements</h2>${table(["Learner","Invoice","Amount","Paid","Balance","Term"],records.map(i=>`<tr><td>${esc(i.first_name+" "+i.last_name)}</td><td>${esc(i.description)}</td><td>${money(i.amount)}</td><td>${money(i.paid)}</td><td><b>${money(i.balance)}</b></td><td>${esc(i.term)}</td></tr>`))}</div>`;
}
async function announcements(host){
 const rows=await api("/announcements");
 host.innerHTML=`${currentUser.role==="admin"?`<div class="panel"><h2>Publish school announcement</h2><form id="announcementForm" class="form-grid"><label>Title<input name="title" required></label><label>Audience<select name="audience"><option>All</option><option value="parent">Parents</option><option value="teacher">Teachers</option></select></label><label class="wide">Message<textarea name="body" required></textarea></label><button class="primary wide">Publish announcement</button></form></div>`:""}
 <div class="panel"><h2>School notices</h2>${rows.length?rows.map(a=>`<article class="announcement"><b>${esc(a.title)}</b><p>${esc(a.body)}</p><small class="muted-line">${esc(a.author||"School administration")} · ${new Date(a.created_at).toLocaleString()}</small></article>`).join(""):'<div class="empty">No announcements yet.</div>'}</div>`;
}
async function messages(host){
 const rows=await api("/messages");
 host.innerHTML=`<div class="cards-2"><div class="panel"><h2>Send a message to the school</h2><form id="messageForm"><label>Subject<input name="subject" required></label><label style="margin-top:12px">Message<textarea name="body" required></textarea></label><button class="primary" style="margin-top:14px">Send message</button></form></div><div class="panel"><h2>Inbox</h2>${rows.length?rows.map(m=>`<article class="announcement"><b>${esc(m.subject)}</b><p>${esc(m.body)}</p><small class="muted-line">From ${esc(m.sender_name)} · ${new Date(m.created_at).toLocaleString()}</small></article>`).join(""):'<div class="empty">No messages yet.</div>'}</div></div>`;
}
function modal(title,html){
 const old=$("#modal");if(old)old.remove();
 const wrap=document.createElement("div");wrap.id="modal";wrap.style.cssText="position:fixed;inset:0;background:#10243b99;display:grid;place-items:center;padding:18px;z-index:20";
 wrap.innerHTML=`<section class="login-card" style="width:min(100%,650px);max-height:90vh;overflow:auto"><div class="panel-head"><h2>${esc(title)}</h2><button class="secondary" id="closeModal" type="button">Close</button></div>${html}</section>`;
 document.body.appendChild(wrap);$("#closeModal").onclick=()=>wrap.remove();
 const form=wrap.querySelector("form");if(form)form.addEventListener("submit",async e=>{
   e.preventDefault();const data=Object.fromEntries(new FormData(form).entries());
   try{
    let endpoint="",method="POST";
    if(form.id==="studentForm")endpoint="/students";
    if(form.id==="classForm")endpoint="/classes";
    if(form.id==="staffForm")endpoint="/staff";
    await api(endpoint,{method,body:JSON.stringify(data)});wrap.remove();notify("Record saved successfully.");await navigate(currentPage);
   }catch(err){notify(err.message,true);}
 });
}
document.addEventListener("submit",async e=>{
 const f=e.target;if(!["attendanceForm","resultForm","invoiceForm","paymentForm","announcementForm","messageForm"].includes(f.id))return;
 e.preventDefault();const data=Object.fromEntries(new FormData(f).entries());
 const routes={attendanceForm:"/attendance",resultForm:"/results",invoiceForm:"/fees/invoices",paymentForm:"/fees/payments",announcementForm:"/announcements",messageForm:"/messages"};
 try{await api(routes[f.id],{method:"POST",body:JSON.stringify(data)});notify("Saved successfully.");await navigate(currentPage);}catch(err){notify(err.message,true);}
});
(async()=>{if(!token)return showLogin();try{currentUser=await api("/me");showApp();await navigate("dashboard");}catch{logout();}})();
