import { EntityInvitePanel } from "@/components/oa/entity-invite";

export const dynamic="force-dynamic";
export default async function EntityInvitationPage({searchParams}:{searchParams:Promise<{token?:string}>}){
  const params=await searchParams;
  return <EntityInvitePanel token={typeof params.token==="string"?params.token:""}/>;
}
