// src/app/actions/search-users.ts
"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export type UserSearchResult = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  cpf: string | null;
};

type SearchUsersResult =
  | { success: true; users: UserSearchResult[] }
  | { success: false; error: string };

export async function searchUsers(
  cpf: string
): Promise<SearchUsersResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Unauthorized." };
  }

  const cleaned = cpf.replace(/\D/g, "");

  // Exige exatamente 11 dígitos para disparar a busca
  if (cleaned.length !== 11) {
    return { success: true, users: [] };
  }

  const user = await prisma.user.findFirst({
    where: {
      cpf: cleaned,
      id: { not: session.user.id },
    },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      cpf: true,
    },
  });

  return { success: true, users: user ? [user] : [] };
}