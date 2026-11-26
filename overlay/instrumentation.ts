import type {Instrumentation} from "next";
import {logOaFailure} from "./lib/oa/runtime-diagnostics";

// Next captures server render errors here even when production hides the message.
export const onRequestError:Instrumentation.onRequestError=(error,request,context)=>{
 const raw=request.headers["cf-ray"];
 const ray=typeof raw==="string"&&/^[a-zA-Z0-9-]{1,80}$/.test(raw)?raw:undefined;
 logOaFailure("next.request",error,{route:context.routePath,routeType:context.routeType,method:request.method,ray});
};
