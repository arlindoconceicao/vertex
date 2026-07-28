import { auth } from "@/auth";
import { redirect } from "next/navigation";
import NewSchemaClientView from "./NewSchemaClientView";

export default async function NewSchemaPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.cpf) redirect("/complete-registration");

  return <NewSchemaClientView />;
}