"use client";
import {useEffect,useState} from "react";
import {authClient} from "@/lib/auth-client";

type Invitation={email:string;role:string;company:string;expiresAt:string};
export function EntityInvitePanel({token}:{token:string}){
  const [invite,setInvite]=useState<Invitation|null>(null);
  const [mode,setMode]=useState<"signIn"|"signUp">("signUp");
  const [name,setName]=useState("");
  const [password,setPassword]=useState("");
  const [error,setError]=useState("");
  const [status,setStatus]=useState<"loading"|"ready"|"working"|"accepted">("loading");
  const [signedIn,setSignedIn]=useState(false);
  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      if(!/^[0-9a-f]{64}$/.test(token))throw new Error("Invalid invitation link");
      const res=await fetch("/api/oa/invitations?token="+encodeURIComponent(token),{cache:"no-store"});
      const data=await res.json();
      if(!res.ok)throw new Error(data.error||"Invitation has expired");
      const session=await authClient.getSession();
      if(!cancelled){setInvite(data.data);setSignedIn(Boolean(session.data?.user));setStatus("ready")}
    })().catch(e=>{if(!cancelled){setError(e instanceof Error?e.message:"Invitation unavailable");setStatus("ready")}});
    return()=>{cancelled=true};
  },[token]);
  async function redeem(){
    const res=await fetch("/api/oa/invitations",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"accept",token})});
    const data=await res.json();
    if(!res.ok)throw new Error(data.error||"Invitation acceptance failed");
    setStatus("accepted");
  }
  async function submit(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();if(!invite)return;
    setError("");setStatus("working");
    try{
      const response=mode==="signUp"
        ? await authClient.signUp.email({name:name.trim()||invite.email.split("@")[0],email:invite.email,password})
        : await authClient.signIn.email({email:invite.email,password});
      if(response.error)throw new Error(response.error.message||"Authentication failed");
      await redeem();
    }catch(e){setError(e instanceof Error?e.message:"Sign-in failed");setStatus("ready")}
  }
  async function acceptExisting(){
    setError("");setStatus("working");
    try{await redeem()}catch(e){setError(e instanceof Error?e.message:"Unable to accept invitation");setStatus("ready")}
  }
  return <main className="mx-auto flex min-h-screen max-w-md items-center px-5 py-10">
    <div className="w-full space-y-5 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold">Join Company OA</h1>
      {status==="loading"&&<p>Checking your invitation…</p>}
      {error&&<p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {status==="accepted"&&<div className="space-y-3"><p className="text-green-700">Invitation accepted. Your company membership is active.</p><a className="underline" href="/oa">Open OA</a></div>}
      {invite&&status!=="accepted"&&<div className="space-y-4">
        <p className="text-sm">You have been invited to <strong>{invite.company}</strong> as <strong>{invite.role}</strong>.</p>
        <p className="text-sm">Invitation email: <strong>{invite.email}</strong></p>
        {signedIn?<div className="space-y-2">
          <p className="text-sm text-neutral-600">Already signed in? Accept using the account matching the invited email. To use another account, sign out first.</p>
          <button onClick={()=>void acceptExisting()} disabled={status==="working"} className="rounded bg-neutral-900 px-4 py-2 text-white">Accept invitation</button>
          <a href="/sign-in" className="ml-3 text-sm underline">Switch account</a>
        </div>:<div className="space-y-3">
          <div className="flex gap-3 text-sm"><button className={mode==="signUp"?"font-bold underline":""} onClick={()=>setMode("signUp")}>Create an account</button><button className={mode==="signIn"?"font-bold underline":""} onClick={()=>setMode("signIn")}>Existing account</button></div>
          <form onSubmit={e=>void submit(e)} className="grid gap-3">
            {mode==="signUp"&&<label className="grid gap-1 text-sm">Name<input className="rounded border p-2" value={name} onChange={e=>setName(e.target.value)} required/></label>}
            <label className="grid gap-1 text-sm">Email<input className="rounded border bg-neutral-100 p-2" value={invite.email} readOnly/></label>
            <label className="grid gap-1 text-sm">Password<input className="rounded border p-2" type="password" minLength={8} value={password} onChange={e=>setPassword(e.target.value)} required/></label>
            <button className="rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50" disabled={status==="working"}>{mode==="signUp"?"Register and join OA":"Sign in and join OA"}</button>
          </form>
        </div>}
      </div>}
    </div>
  </main>;
}
