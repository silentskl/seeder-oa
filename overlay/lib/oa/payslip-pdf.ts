import { formatMoney } from "./money";

type CustomItem = { name:string; type:"contribution"|"deduction"|"legacy"; amountMinor?:number; value?:string };

export type PayslipPdfData = {
  companyName:string;
  status:string;
  employeeName:string;
  employeeEmail:string;
  employeeNo:string;
  joinDate:string;
  jobTitle:string;
  department:string;
  salaryPeriod:string;
  periodStart:string;
  periodEnd:string;
  payDate:string;
  currency:string;
  baseSalaryMinor:number;
  allowancesMinor:number;
  bonusMinor:number;
  commissionMinor:number;
  employeeContributionMinor:number;
  employerContributionMinor:number;
  taxMinor:number;
  otherDeductionsMinor:number;
  grossMinor:number;
  netMinor:number;
  reportingCurrency:string;
  netReportingMinor:number;
  fxRate:number;
  fxRateDate:string;
  fxSource:string;
  note:string;
  customItems:CustomItem[];
};

function ascii(value:unknown):string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u00a0/g, " ")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "?");
}
function esc(value:unknown):string { return ascii(value).replace(/\\/g,"\\\\").replace(/\(/g,"\\(").replace(/\)/g,"\\)"); }
function n(value:unknown):number { const x=Number(value); return Number.isFinite(x)?x:0; }
function money(minor:unknown,currency:string):string {
  try { return ascii(formatMoney(n(minor),currency)); }
  catch { return `${ascii(currency)} ${n(minor)}`; }
}
function wrap(text:string,max=88):string[] {
  const source=ascii(text).replace(/\s+/g," ").trim();
  if(!source) return [];
  const words=source.split(" "); const out:string[]=[]; let line="";
  for(const word of words){
    if(!line){ line=word; continue; }
    if((line+" "+word).length<=max){ line += " "+word; continue; }
    out.push(line); line=word;
  }
  if(line) out.push(line);
  return out;
}
function parseCustom(raw:CustomItem[]):CustomItem[]{
  return Array.isArray(raw)?raw.slice(0,20):[];
}

class PdfDoc {
  pages:string[][]=[[]];
  y=790;
  get page(){ return this.pages[this.pages.length-1]; }
  cmd(s:string){ this.page.push(s); }
  newPage(){ this.pages.push([]); this.y=790; this.text("PAYSLIP - continued",42,this.y,11,true); this.y-=22; }
  ensure(lines=1){ if(this.y-lines*15<55) this.newPage(); }
  text(value:unknown,x:number,y:number,size=10,bold=false){ this.cmd(`BT /${bold?"F2":"F1"} ${size} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td (${esc(value)}) Tj ET`); }
  line(y:number){ this.cmd(`0.75 w 42 ${y.toFixed(1)} m 553 ${y.toFixed(1)} l S`); }
  heading(value:string){ this.ensure(2); this.y-=4; this.text(value.toUpperCase(),42,this.y,10,true); this.y-=8; this.line(this.y); this.y-=16; }
  kv(label:string,value:unknown){ this.ensure(); this.text(label,42,this.y,9,false); this.text(value,190,this.y,9,true); this.y-=15; }
  moneyRow(label:string,amount:number,currency:string,sign=""){ this.ensure(); this.text(label,54,this.y,9,false); this.text(`${sign}${money(amount,currency)}`,400,this.y,9,false); this.y-=15; }
  note(value:string){ const lines=wrap(value,92); for(const line of lines){ this.ensure(); this.text(line,54,this.y,9,false); this.y-=14; } }
  build():Uint8Array {
    const pageCount=this.pages.length;
    const firstPageId=3;
    const firstContentId=firstPageId+pageCount;
    const fontRegularId=firstContentId+pageCount;
    const fontBoldId=fontRegularId+1;
    const objects:string[]=[];
    objects[1]=`<< /Type /Catalog /Pages 2 0 R >>`;
    const kids=Array.from({length:pageCount},(_,i)=>`${firstPageId+i} 0 R`).join(" ");
    objects[2]=`<< /Type /Pages /Kids [ ${kids} ] /Count ${pageCount} >>`;
    for(let i=0;i<pageCount;i++){
      const pageId=firstPageId+i, contentId=firstContentId+i;
      objects[pageId]=`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${contentId} 0 R >>`;
      const stream=this.pages[i].join("\n")+"\n";
      objects[contentId]=`<< /Length ${stream.length} >>\nstream\n${stream}endstream`;
    }
    objects[fontRegularId]=`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;
    objects[fontBoldId]=`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>`;
    let pdf="%PDF-1.4\n%OA-Payslip\n";
    const offsets:number[]=[0];
    for(let i=1;i<objects.length;i++){
      offsets[i]=pdf.length;
      pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const xref=pdf.length;
    pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    for(let i=1;i<objects.length;i++) pdf += `${String(offsets[i]).padStart(10,"0")} 00000 n \n`;
    pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return new TextEncoder().encode(pdf);
  }
}

export function buildPayslipPdf(data:PayslipPdfData):Uint8Array {
  const d=new PdfDoc();
  d.text(data.companyName||"Company",42,d.y,17,true); d.y-=24;
  d.text("PAYSLIP",42,d.y,13,true); d.text(`Status: ${ascii(data.status).toUpperCase()}`,420,d.y,9,true); d.y-=16;
  d.line(d.y); d.y-=20;

  d.heading("Employee details");
  d.kv("Employee name",data.employeeName||data.employeeEmail);
  d.kv("Employee ID",data.employeeNo||"-");
  d.kv("Email",data.employeeEmail||"-");
  d.kv("Join date",data.joinDate||"-");
  if(data.jobTitle) d.kv("Job title",data.jobTitle);
  if(data.department) d.kv("Department",data.department);
  d.kv("Salary basis",data.salaryPeriod||"monthly");

  d.heading("Payroll period");
  d.kv("Period",`${data.periodStart} to ${data.periodEnd}`);
  d.kv("Pay date",data.payDate);
  d.kv("Currency",data.currency);

  const custom=parseCustom(data.customItems);
  const customContrib=custom.filter(x=>x.type==="contribution");
  const customDeduct=custom.filter(x=>x.type==="deduction");
  const legacy=custom.filter(x=>x.type==="legacy");

  d.heading("Earnings");
  d.moneyRow("Base salary",data.baseSalaryMinor,data.currency);
  if(data.allowancesMinor) d.moneyRow("Allowances",data.allowancesMinor,data.currency);
  if(data.bonusMinor) d.moneyRow("Bonus",data.bonusMinor,data.currency);
  if(data.commissionMinor) d.moneyRow("Commission",data.commissionMinor,data.currency);
  for(const item of customContrib) d.moneyRow(item.name,item.amountMinor||0,data.currency,"+");
  d.line(d.y+5); d.y-=7;
  d.moneyRow("Gross pay",data.grossMinor,data.currency);

  d.heading("Deductions");
  if(data.employeeContributionMinor) d.moneyRow("Employee contribution",data.employeeContributionMinor,data.currency,"-");
  if(data.taxMinor) d.moneyRow("Tax",data.taxMinor,data.currency,"-");
  if(data.otherDeductionsMinor) d.moneyRow("Other deductions",data.otherDeductionsMinor,data.currency,"-");
  for(const item of customDeduct) d.moneyRow(item.name,item.amountMinor||0,data.currency,"-");
  d.line(d.y+5); d.y-=7;
  d.moneyRow("Net pay",data.netMinor,data.currency);

  if(data.employerContributionMinor){
    d.heading("Employer contribution");
    d.moneyRow("Employer contribution (not deducted from net)",data.employerContributionMinor,data.currency);
  }
  if(data.reportingCurrency && data.reportingCurrency!==data.currency){
    d.heading("Reporting equivalent");
    d.moneyRow(`Net pay in ${data.reportingCurrency}`,data.netReportingMinor,data.reportingCurrency);
    d.kv("FX snapshot",`${n(data.fxRate).toFixed(6)} | ${data.fxSource||"-"} | ${data.fxRateDate||"-"}`);
  }
  if(legacy.length){
    d.heading("Legacy custom fields");
    for(const item of legacy) d.kv(item.name,item.value||"-");
  }
  if(data.note){ d.heading("Note"); d.note(data.note); }

  d.ensure(2); d.y-=8; d.line(d.y); d.y-=17;
  d.text("Generated by Seeder OA. This document is a payroll record generated from a stored payslip snapshot.",42,d.y,7,false);
  return d.build();
}
