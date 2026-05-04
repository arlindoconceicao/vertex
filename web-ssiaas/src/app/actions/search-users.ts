// src/app/actions/search-users.ts
"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export type UserSearchResult = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
};

type SearchUsersResult =
  | { success: true; users: UserSearchResult[] }
  | { success: false; error: string };

export async function searchUsers(
  query: string
): Promise<SearchUsersResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Sessão inválida." };
  }

  // Ignora buscas muito curtas para evitar queries desnecessárias
  if (!query || query.trim().length < 2) {
    return { success: true, users: [] };
  }

  const users = await prisma.user.findMany({
    where: {
      AND: [
        // Nunca retorna o próprio usuário logado
        { id: { not: session.user.id } },
        {
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { email: { contains: query, mode: "insensitive" } },
          ],
        },
      ],
    },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
    },
    take: 8, // Limite de resultados
  });

  return { success: true, users };
}