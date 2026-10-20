import { pageSession } from "@/server/page-session";
import { Account } from "./_components/account";
export default async function Page() {
  await pageSession();
  return <Account />;
}
