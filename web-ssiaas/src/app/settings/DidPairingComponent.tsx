"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { useTranslation } from "@/locales/LanguageContext";

type Props = {
  userId: string;
  userEmail: string;
  initialDid: string | null;
  initialPublicKey: string | null;
  initialMlkemKey: string | null;
  initialPairedAt: string | null;
};

interface ChallengeData {
  id: string;
  pairingId: string;
  nonce: string;
  expiresAt: string;
}

export default function DidPairingComponent({
  userId,
  userEmail,
  initialDid,
  initialPublicKey,
  initialMlkemKey,
  initialPairedAt,
}: Props) {
  const router = useRouter();
  const { t, locale } = useTranslation();
  const [isPending, startTransition] = useTransition();

  const [challenge, setChallenge] = useState<ChallengeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedPayload, setCopiedPayload] = useState(false);
  const [copiedEndpoint, setCopiedEndpoint] = useState(false);
  const [origin, setOrigin] = useState<string>("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setOrigin(window.location.origin);
    }
  }, []);

  const isPaired = !!initialDid;

  // Polling to auto-refresh page state when mobile app completes pairing
  useEffect(() => {
    if (!challenge || isPaired) return;

    const interval = setInterval(() => {
      startTransition(() => {
        router.refresh();
      });
    }, 3000);

    return () => clearInterval(interval);
  }, [challenge, isPaired, router]);

  async function handleStartPairing() {
    setError(null);
    try {
      const res = await fetch("/api/v1/did-pairings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await res.json();

      if (!res.ok) {
        // Translate error message key if available or use fallback
        const errKey = data.error === "User registration not complete"
          ? "errors.cpfRequired"
          : data.error === "DID already paired"
          ? "errors.didAlreadyPaired"
          : "errors.pairingFailed";

        setError(data.details || t(errKey) || t("errors.pairingFailed"));
        return;
      }

      setChallenge(data);
    } catch (err) {
      console.error("Error requesting pairing challenge:", err);
      setError(t("errors.connectionError"));
    }
  }

  const endpointUrl = challenge
    ? `${origin || "http://localhost:3000"}/api/v1/did-pairings/${challenge.pairingId}/complete`
    : "";

  const pairingPayload = challenge
    ? JSON.stringify({
        pairingId: challenge.pairingId,
        nonce: challenge.nonce,
        expiresAt: challenge.expiresAt,
        userId,
        email: userEmail,
        endpoint: endpointUrl,
      })
    : "";

  function handleCopyPayload() {
    if (!pairingPayload) return;
    navigator.clipboard.writeText(pairingPayload);
    setCopiedPayload(true);
    setTimeout(() => setCopiedPayload(false), 2000);
  }

  function handleCopyEndpoint() {
    if (!endpointUrl) return;
    navigator.clipboard.writeText(endpointUrl);
    setCopiedEndpoint(true);
    setTimeout(() => setCopiedEndpoint(false), 2000);
  }

  if (isPaired) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 bg-emerald-950/60 border border-emerald-800/80 rounded-xl px-4 py-3 text-emerald-400">
          <svg
            className="w-5 h-5 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span className="text-sm font-medium">
            {t("didPairing.pairedTitle")}
          </span>
        </div>

        <div className="bg-gray-800/60 rounded-xl px-4 py-3 space-y-1">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">
            {t("didPairing.didLabel")}
          </p>
          <p className="text-sm text-indigo-400 font-mono break-all select-all">
            {initialDid}
          </p>
        </div>

        {initialPublicKey && (
          <div className="bg-gray-800/60 rounded-xl px-4 py-3 space-y-1">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">
              {t("didPairing.dsaKeyLabel")}
            </p>
            <p className="text-sm text-gray-300 font-mono break-all select-all">
              {initialPublicKey}
            </p>
          </div>
        )}

        {initialMlkemKey && (
          <div className="bg-gray-800/60 rounded-xl px-4 py-3 space-y-1">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">
              {t("didPairing.mlkemKeyLabel")}
            </p>
            <p className="text-sm text-amber-300/90 font-mono break-all select-all">
              {initialMlkemKey}
            </p>
          </div>
        )}

        {initialPairedAt && (
          <div className="bg-gray-800/60 rounded-xl px-4 py-3 flex justify-between items-center text-xs">
            <span className="text-gray-400">{t("didPairing.pairedAt")}</span>
            <span className="text-gray-300 font-mono">
              {new Date(initialPairedAt).toLocaleString(
                locale === "pt" ? "pt-BR" : "en-US",
                {
                  dateStyle: "medium",
                  timeStyle: "short",
                }
              )}
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-950/80 border border-red-800 text-red-300 text-sm rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {!challenge ? (
        <div className="space-y-4">
          <p className="text-sm text-gray-400 leading-relaxed">
            {t("didPairing.unpairedIntro")}
          </p>

          <button
            type="button"
            onClick={handleStartPairing}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-3 px-4 rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-2"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
              />
            </svg>
            {t("didPairing.startButton")}
          </button>
        </div>
      ) : (
        <div className="bg-gray-800/40 border border-gray-700/60 rounded-2xl p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
              <span className="text-sm font-semibold text-amber-400">
                {t("didPairing.awaitingTitle")}
              </span>
            </div>
            <span className="text-xs text-gray-500 font-mono">
              {t("didPairing.expiresIn")}
            </span>
          </div>

          <p className="text-xs text-gray-400 leading-relaxed">
            {t("didPairing.instructions", { email: userEmail })}
          </p>

          {/* QR Code and Payload container */}
          <div className="flex flex-col sm:flex-row items-center gap-6 bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="bg-white p-3 rounded-xl shadow-lg flex-shrink-0">
              <QRCodeSVG
                value={pairingPayload}
                size={160}
                level="M"
                includeMargin={false}
              />
            </div>

            <div className="flex-1 w-full space-y-3 min-w-0">
              <div>
                <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">
                  {t("didPairing.endpointUrlLabel")}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <p className="text-xs text-indigo-400 font-mono truncate bg-gray-950 px-3 py-2 rounded-lg border border-gray-800 flex-1 select-all">
                    {endpointUrl}
                  </p>
                  <button
                    type="button"
                    onClick={handleCopyEndpoint}
                    className="bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs px-3 py-2 rounded-lg border border-gray-700 transition-colors flex-shrink-0 cursor-pointer"
                  >
                    {copiedEndpoint ? t("common.copied") : t("didPairing.copyUrlButton")}
                  </button>
                </div>
              </div>

              <div>
                <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">
                  {t("didPairing.pairingIdLabel")}
                </p>
                <p className="text-xs text-gray-300 font-mono break-all mt-0.5 select-all">
                  {challenge.pairingId}
                </p>
              </div>

              <div>
                <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">
                  {t("didPairing.nonceLabel")}
                </p>
                <p className="text-xs text-gray-400 font-mono break-all mt-0.5 select-all">
                  {challenge.nonce}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleCopyPayload}
              className="flex-1 bg-indigo-600/90 hover:bg-indigo-600 text-white text-xs font-medium py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-md"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              {copiedPayload ? t("didPairing.payloadCopiedButton") : t("didPairing.copyPayloadButton")}
            </button>

            <button
              type="button"
              onClick={handleStartPairing}
              className="bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white text-xs font-medium py-3 px-4 rounded-xl border border-gray-700 transition-colors cursor-pointer"
              title={t("didPairing.restartButton")}
            >
              {t("didPairing.restartButton")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
