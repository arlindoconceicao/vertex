import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import SettingsHeader from "./SettingsHeader";
import SettingsTabsContainer from "./SettingsTabsContainer";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.cpf) redirect("/complete-registration");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      did: true,
      didPublicKey: true,
      didMlkemKey: true,
      didPairedAt: true,
      cpf: true,
      email: true,
      language: true,
    },
  });

  const formattedUser = {
    id: user?.id || "",
    email: user?.email || "",
    cpf: user?.cpf || null,
    did: user?.did || null,
    didPublicKey: user?.didPublicKey || null,
    didMlkemKey: user?.didMlkemKey || null,
    didPairedAt: user?.didPairedAt ? user.didPairedAt.toISOString() : null,
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col justify-between">
      <div>
        <Navbar userName={session.user.name} userImage={session.user.image} />

        <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
          <SettingsHeader />
          <SettingsTabsContainer user={formattedUser} />
        </main>
      </div>

      <Footer />
    </div>
  );
}