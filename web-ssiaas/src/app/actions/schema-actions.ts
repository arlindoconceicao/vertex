"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export type SchemaField = {
  name: string;
  type: "string" | "number" | "boolean" | "date";
  required: boolean;
};

type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

// Criar Schema
export async function createSchema(
  name: string,
  description: string,
  fields: SchemaField[]
): Promise<ActionResult<{ id: string }>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Unauthorized." };
  }

  if (!name.trim() || !description.trim()) {
    return { success: false, error: "Name and description are required." };
  }

  if (fields.length === 0) {
    return { success: false, error: "Add at least one field to the schema." };
  }

  // Valida que todos os campos têm nome preenchido
  const invalidField = fields.find((f) => !f.name.trim());
  if (invalidField) {
    return { success: false, error: "All fields must have a name." };
  }

  try {
    const schema = await prisma.credentialSchema.create({
      data: {
        name: name.trim(),
        description: description.trim(),
        jsonSchema: { fields },
        creatorId: session.user.id,
      },
      select: { id: true },
    });

    revalidatePath("/schemas");
    return { success: true, data: { id: schema.id } };
  } catch (error) {
    console.error("[createSchema] Error:", error);
    return { success: false, error: "Failed to create schema." };
  }
}

// Publicar no IPFS
export async function publishSchema(
  schemaId: string
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Unauthorized." };
  }

  const schema = await prisma.credentialSchema.findUnique({
    where: { id: schemaId },
    select: { creatorId: true, publishedAt: true },
  });

  if (!schema) return { success: false, error: "Schema not found." };
  if (schema.creatorId !== session.user.id) return { success: false, error: "Forbidden." };
  if (schema.publishedAt) return { success: false, error: "Already published." };

  // Mock IPFS CID — mesmo gerador da rota de API
  const base58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let cid = "Qm";
  for (let i = 0; i < 44; i++) {
    cid += base58[Math.floor(Math.random() * base58.length)];
  }

  try {
    await prisma.credentialSchema.update({
      where: { id: schemaId },
      data: {
        ipfsCid: cid,
        storageLocation: "IPFS",
        publishedAt: new Date(),
      },
    });

    revalidatePath(`/schemas/${schemaId}`);
    revalidatePath("/schemas");
    return { success: true, data: undefined };
  } catch (error) {
    console.error("[publishSchema] Error:", error);
    return { success: false, error: "Failed to publish." };
  }
}

// Alternar visibilidade
export async function toggleVisibility(
  schemaId: string,
  newVisibility: "PUBLIC" | "PRIVATE"
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Unauthorized." };
  }

  const schema = await prisma.credentialSchema.findUnique({
    where: { id: schemaId },
    select: { creatorId: true },
  });

  if (!schema) return { success: false, error: "Schema not found." };
  if (schema.creatorId !== session.user.id) return { success: false, error: "Forbidden." };

  try {
    await prisma.credentialSchema.update({
      where: { id: schemaId },
      data: { visibility: newVisibility },
    });

    revalidatePath(`/schemas/${schemaId}`);
    revalidatePath("/schemas");
    return { success: true, data: undefined };
  } catch (error) {
    console.error("[toggleVisibility] Error:", error);
    return { success: false, error: "Failed to update visibility." };
  }
}