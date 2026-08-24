import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { generateSignerToken } from "@/lib/signer-auth";
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
      didDocument: true,
      didPublicKey: true,
      didMlkemKey: true,
      didPairedAt: true,
      cpf: true,
      email: true,
      language: true,
      pdfRetentionDays: true,
    },
  });

  let issuerIdentifier = null;
  if (user?.did) {
    const { getSsiPqCore } = await import("@/lib/ssi-pq");
    const core = await getSsiPqCore();

    const storedDidDocument = user.didDocument;
    const didDocument =
      storedDidDocument && typeof storedDidDocument === "object"
        ? storedDidDocument
        : {
            "@context": ["https://www.w3.org/ns/did/v1"],
            id: user.did,
            verificationMethod: [
              {
                id: `${user.did}#key-1`,
                type: "Ed25519VerificationKey2020",
                controller: user.did,
                publicKeyMultibase: user.didPublicKey,
              },
            ],
            authentication: [`${user.did}#key-1`],
          };

    issuerIdentifier = core.issuerIdentifierBase64(didDocument);
  }

  let bearerToken = null;
  if (user?.did) {
    bearerToken = generateSignerToken(user.did);
  }

  const formattedUser = {
    id: user?.id || "",
    email: user?.email || "",
    cpf: user?.cpf || null,
    did: user?.did || null,
    didPublicKey: user?.didPublicKey || null,
    didMlkemKey: user?.didMlkemKey || null,
    didPairedAt: user?.didPairedAt ? user.didPairedAt.toISOString() : null,
    didDocument: user?.didDocument || null,
    issuerIdentifier,
    pdfRetentionDays: user?.pdfRetentionDays || 7,
    bearerToken,
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