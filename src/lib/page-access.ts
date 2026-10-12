import { redirect } from "next/navigation";
import { currentUser } from "./access";
export async function signedInPage(path = "/") {
  const user = await currentUser();
  if (!user)
    redirect("/api/auth/signin?callbackUrl=" + encodeURIComponent(path));
  return user;
}
