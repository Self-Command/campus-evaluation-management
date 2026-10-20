import "server-only";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/server/auth";

export async function pageSession(allowPasswordChange = false) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  if (session.user.mustChangePassword && !allowPasswordChange) redirect("/change-password");
  return session.user;
}
