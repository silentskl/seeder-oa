#!/usr/bin/env python3
"""Read-only HTTP regression against an isolated OA preview/test deployment.
Cookie files, if provided, contain only the Cookie header value, not a curl command.
Never print cookies, response bodies, or session identities.
"""
import argparse
import concurrent.futures as cf
import http.client
import json
import socket
import ssl
import time
import urllib.parse
from pathlib import Path

def main():
    p=argparse.ArgumentParser()
    p.add_argument("base_url")
    p.add_argument("--requests",type=int,default=1000)
    p.add_argument("--concurrency",type=int,default=20)
    p.add_argument("--timeout",type=float,default=20)
    p.add_argument("--cookie-a",type=Path)
    p.add_argument("--cookie-b",type=Path)
    p.add_argument("--allow-production",action="store_true",help="Explicit opt-in; run only in an approved maintenance/test window")
    args=p.parse_args()
    u=urllib.parse.urlsplit(args.base_url)
    if u.scheme not in ("http","https") or not u.hostname or u.username or u.password or u.path not in ("","/") or u.query or u.fragment:
        p.error("Provide an http(s) origin only")
    if u.hostname.lower()=="oa.smartenx.com" and not args.allow_production:
        p.error("Use an isolated preview; production requires explicit approval and --allow-production")
    if not (1<=args.requests<=10000 and 1<=args.concurrency<=64 and args.timeout>0):
        p.error("Invalid request count, concurrency or timeout")
    if bool(args.cookie_a)!=bool(args.cookie_b):
        p.error("Provide both cookie files or neither")
    cookies=[None]
    for f in (args.cookie_a,args.cookie_b):
        if f:
            value=f.read_text().strip()
            if not value or "\n" in value or "\r" in value: p.error("Invalid Cookie header file")
            cookies.append(value)
    def connection():
        cls=http.client.HTTPSConnection if u.scheme=="https" else http.client.HTTPConnection
        return cls(u.hostname,u.port,timeout=args.timeout)
    def request(route,cookie=None):
        c=connection()
        try:
            headers={"Cache-Control":"no-cache","Accept":"application/json" if route.startswith("/api/") else "text/html"}
            if cookie: headers["Cookie"]=cookie
            c.request("GET",route,headers=headers)
            r=c.getresponse()
            body=r.read()
            if r.status>=500 or b"This promise was created by a request that has since ended" in body:
                raise RuntimeError("Server error on "+route+": "+str(r.status))
            return r.status,body
        finally: c.close()
    def session(cookie):
        status,body=request("/api/auth/get-session",cookie)
        if status!=200: raise RuntimeError("Unexpected session status "+str(status))
        obj=json.loads(body)
        if obj is None: return None
        return obj["user"]["id"]
    identities=[session(c) for c in cookies]
    if identities[0] is not None: raise RuntimeError("Anonymous session leaked identity")
    if len(cookies)==3 and (not identities[1] or not identities[2] or identities[1]==identities[2]):
        raise RuntimeError("Two distinct authenticated test users required")
    def abort():
        c=connection()
        try:
            c.request("GET","/",headers={"Cache-Control":"no-cache"})
            # Close before reading the response. The server may still complete
            # normally; a cancellation is not guaranteed by client disconnect.
        finally: c.close()
    def check(i):
        slot=i%len(cookies)
        status,_=request("/",cookies[slot])
        if status not in (200,301,302,303,307,308):
            raise RuntimeError("Unexpected home status "+str(status))
        if session(cookies[slot])!=identities[slot]:
            raise RuntimeError("Session identity changed or crossed requests")
    start=time.monotonic()
    # Disconnect initial requests, then immediately overlap normal requests.
    with cf.ThreadPoolExecutor(max_workers=args.concurrency) as ex:
        list(ex.map(lambda _:abort(),range(min(args.concurrency,8))))
        for _ in ex.map(check,range(args.requests)): pass
    print(f"PASS {args.requests} home/session pairs; concurrency={args.concurrency}; disconnect recovery; {time.monotonic()-start:.1f}s")
    if len(cookies)==3:
        print("PASS two distinct authenticated sessions and anonymous session isolation")
    else:
        print("LIMITATION: anonymous only; authenticated isolation NOT tested")
    print("Review Worker logs for dropped Promise errors; a client disconnect does not prove server cancellation.")

if __name__=="__main__": main()
