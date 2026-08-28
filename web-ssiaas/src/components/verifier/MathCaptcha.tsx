"use client";

import { useState, useEffect } from "react";
import { useTranslation } from "@/locales/LanguageContext";

type MathCaptchaProps = {
  onSuccess: () => void;
  onReset: () => void;
  resetTrigger?: number; // Permite forçar o reset por fora
};

export default function MathCaptcha({ onSuccess, onReset, resetTrigger }: MathCaptchaProps) {
  const { t } = useTranslation();
  
  const [numA, setNumA] = useState(0);
  const [numB, setNumB] = useState(0);
  const [inputValue, setInputValue] = useState("");
  const [isSolved, setIsSolved] = useState(false);

  const generateChallenge = () => {
    setNumA(Math.floor(Math.random() * 10) + 1); // 1 a 10
    setNumB(Math.floor(Math.random() * 10) + 1); // 1 a 10
    setInputValue("");
    setIsSolved(false);
    onReset();
  };

  useEffect(() => {
    generateChallenge();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetTrigger]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);
    
    if (parseInt(val, 10) === numA + numB) {
      setIsSolved(true);
      onSuccess();
    } else if (isSolved) {
      setIsSolved(false);
      onReset();
    }
  };

  let questionText = t("captcha.question");
  questionText = questionText.replace("{{a}}", String(numA)).replace("{{b}}", String(numB));

  return (
    <div className={`p-4 rounded-xl border flex items-center justify-between gap-4 transition-colors ${isSolved ? 'bg-emerald-950/30 border-emerald-800' : 'bg-gray-800 border-gray-700'}`}>
      <div className="flex items-center gap-3">
        {isSolved ? (
          <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        ) : (
          <div className="w-8 h-8 rounded-full bg-indigo-500/20 text-primary-text flex items-center justify-center shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
          </div>
        )}
        <div>
          <p className={`text-sm font-medium ${isSolved ? 'text-emerald-400' : 'text-gray-300'}`}>
            {isSolved ? t("captcha.solved") : questionText}
          </p>
        </div>
      </div>
      
      {!isSolved && (
        <input
          type="number"
          value={inputValue}
          onChange={handleChange}
          placeholder={t("captcha.placeholder")}
          className="w-24 bg-surface border border-gray-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring transition-shadow"
        />
      )}
    </div>
  );
}
