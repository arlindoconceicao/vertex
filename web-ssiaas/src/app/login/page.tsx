import { auth } from "@/auth";
import { signIn } from "@/auth";
import { redirect } from "next/navigation";
import LoginClientView from "./LoginClientView";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user?.cpf) redirect("/dashboard");

  async function handleSignIn() {
    "use server";
    await signIn("google", { redirectTo: "/dashboard" });
  }

  return <LoginClientView signInAction={handleSignIn} />;
}