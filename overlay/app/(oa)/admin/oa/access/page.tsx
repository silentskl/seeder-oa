import {requireViewer} from "@/lib/auth-server";
import {isOaSuperAdmin} from "@/lib/oa/admin-permissions";
import {AdministratorAccess} from "@/components/oa/administrator-access";
export const dynamic="force-dynamic";
export default async function AccessPage(){
 const viewer=await requireViewer();
 if(!await isOaSuperAdmin(viewer.id))return <div className="p-6" role="alert">Super administrator required.</div>;
 return <AdministratorAccess/>;
}
