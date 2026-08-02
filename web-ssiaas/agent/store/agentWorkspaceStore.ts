import { create } from "zustand";
import { mockAgentClient } from "@/lib/agent/agentClient.mock";
import type {
  Message,
  SchemaDiff,
  SchemaStatus,
  ValidationError,
  WorkspaceMode,
} from "@/lib/agent/types";

const INITIAL_SCHEMA = {
  "@context": ["https://www.w3.org/2018/credentials/v1", "https://schema.org"],
  type: ["VerifiableCredential", "ProofOfExistenceCredential"],
  issuer: "did:web:vertex-ssiaas.dev",
  issuanceDate: null,
  credentialSubject: {
    id: null,
    documentHash: null,
    documentName: null,
  },
};

interface AgentWorkspaceState {
  sessionId: string;
  mode: WorkspaceMode;
  messages: Message[];
  isAgentTyping: boolean;

  schema: {
    committed: unknown;
    draft: unknown;
    status: SchemaStatus;
    lastDiff: SchemaDiff | null;
    validationErrors: ValidationError[] | null;
  };

  // Bloqueio de troca de modo quando há edição manual pendente
  pendingModeSwitchBlocked: boolean;

  setMode: (mode: WorkspaceMode) => void;
  forceSwitchToAuto: () => void;
  discardDraft: () => void;

  sendUserMessage: (content: string) => Promise<void>;
  updateManualDraft: (schema: unknown) => void;
  submitManualEditForValidation: () => Promise<void>;
}

export const useAgentWorkspaceStore = create<AgentWorkspaceState>(
  (set, get) => ({
    sessionId: crypto.randomUUID(),
    mode: "auto",
    isAgentTyping: false,
    messages: [
      {
        id: crypto.randomUUID(),
        role: "agent",
        content:
          "Olá! Descreva a credencial que você quer criar — por exemplo, " +
          '"crie uma prova de existência para o PDF que acabei de enviar".',
        createdAt: new Date().toISOString(),
      },
    ],
    schema: {
      committed: INITIAL_SCHEMA,
      draft: INITIAL_SCHEMA,
      status: "idle",
      lastDiff: null,
      validationErrors: null,
    },
    pendingModeSwitchBlocked: false,

    setMode: (mode) => {
      const { mode: currentMode, schema } = get();

      if (currentMode === "manual" && mode === "auto") {
        const hasPendingDraft =
          JSON.stringify(schema.draft) !== JSON.stringify(schema.committed);

        if (hasPendingDraft && schema.status !== "synced") {
          // Bloqueia a troca — a UI deve exibir um diálogo de confirmação
          set({ pendingModeSwitchBlocked: true });
          return;
        }
      }

      set({ mode, pendingModeSwitchBlocked: false });
    },

    forceSwitchToAuto: () => {
      const { schema } = get();
      set({
        mode: "auto",
        pendingModeSwitchBlocked: false,
        schema: { ...schema, draft: schema.committed, status: "synced" },
      });
    },

    discardDraft: () => {
      const { schema } = get();
      set({
        schema: {
          ...schema,
          draft: schema.committed,
          status: "synced",
          validationErrors: null,
        },
        pendingModeSwitchBlocked: false,
      });
    },

    sendUserMessage: async (content) => {
      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content,
        createdAt: new Date().toISOString(),
      };

      set((state) => ({
        messages: [...state.messages, userMessage],
        isAgentTyping: true,
        schema: { ...state.schema, status: "streaming" },
      }));

      const agentMessageId = crypto.randomUUID();
      let accumulatedText = "";

      set((state) => ({
        messages: [
          ...state.messages,
          {
            id: agentMessageId,
            role: "agent",
            content: "",
            createdAt: new Date().toISOString(),
          },
        ],
      }));

      for await (const event of mockAgentClient.sendMessage({
        sessionId: get().sessionId,
        content,
      })) {
        switch (event.type) {
          case "message.delta":
            accumulatedText += event.text;
            set((state) => ({
              messages: state.messages.map((m) =>
                m.id === agentMessageId ? { ...m, content: accumulatedText } : m
              ),
            }));
            break;

          case "message.done":
            set({ isAgentTyping: false });
            break;

          case "schema.updated": {
            const diffMessage: Message = {
              id: crypto.randomUUID(),
              role: "system",
              kind: "diff-announcement",
              content: "Schema atualizado pelo agente.",
              diffSummary: [
                ...(event.diff?.added ?? []).map((f) => `+ ${f}`),
                ...(event.diff?.changed ?? []).map((f) => `~ ${f}`),
                ...(event.diff?.removed ?? []).map((f) => `- ${f}`),
              ].join(" · "),
              createdAt: new Date().toISOString(),
            };

            set((state) => ({
              messages: [...state.messages, diffMessage],
              schema: {
                ...state.schema,
                committed: event.schema,
                draft: event.schema,
                status: "synced",
                lastDiff: event.diff ?? null,
              },
            }));
            break;
          }

          case "error":
            set((state) => ({
              isAgentTyping: false,
              schema: { ...state.schema, status: "conflict" },
            }));
            break;
        }
      }
    },

    updateManualDraft: (schema) => {
      set((state) => ({
        schema: { ...state.schema, draft: schema, status: "idle" },
      }));
    },

    submitManualEditForValidation: async () => {
      const { schema, sessionId } = get();
      set({ schema: { ...schema, status: "pending_validation" } });

      const result = await mockAgentClient.validateManualEdit({
        sessionId,
        schema: schema.draft,
      });

      if (result.valid) {
        const confirmMessage: Message = {
          id: crypto.randomUUID(),
          role: "agent",
          content: "Alterações manuais validadas e aplicadas ao schema.",
          createdAt: new Date().toISOString(),
        };
        set((state) => ({
          messages: [...state.messages, confirmMessage],
          schema: {
            ...state.schema,
            committed: state.schema.draft,
            status: "synced",
            validationErrors: null,
          },
        }));
      } else {
        set((state) => ({
          schema: {
            ...state.schema,
            status: "conflict",
            validationErrors: result.errors,
          },
        }));
      }
    },
  })
);
