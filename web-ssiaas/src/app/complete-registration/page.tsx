import { auth } from "@/auth";
import { redirect } from "next/navigation";
import CompleteRegistrationClientView from "./CompleteRegistrationClientView";

export default async function CompletarCadastroPage() {
  const session = await auth();

  if (!session?.user) redirect("/login");
  if (session.user.cpf) redirect("/dashboard");

  return (
    <CompleteRegistrationClientView
      userName={session.user.name}
      userEmail={session.user.email}
      userImage={session.user.image}
    />
  );
}