import { redirect } from "next/navigation";
import { auth } from "@/auth";

export default async function RootPage() {
  const session = await auth();

  // Já logado com CPF -> Dashboard
  if (session?.user?.cpf) redirect("/dashboard");

  // Já logado sem CPF -> Completar cadastro
  if (session?.user) redirect("/complete-registration");

  // Não logado -> Login
  redirect("/login");
}