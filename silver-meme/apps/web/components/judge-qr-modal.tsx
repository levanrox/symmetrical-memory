'use client';

import { useEffect, useState, useCallback } from 'react';
import QRCode from 'qrcode';
import { X, QrCode, ExternalLink, Copy, Check, RotateCcw, Smartphone, Users } from 'lucide-react';
import { Button } from './ui/button';
import { api } from '../lib/api';

interface JudgeSlot {
  judgeNo: number;
  deviceId: string;
  lastSeen: number;
}

interface JudgeQrModalProps {
  isOpen: boolean;
  onClose: () => void;
  tatamiId: string;
  tatamiName: string;
}

export function JudgeQrModal({ isOpen, onClose, tatamiId, tatamiName }: JudgeQrModalProps) {
  const [qrUrl, setQrUrl] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [slots, setSlots] = useState<JudgeSlot[]>([]);
  const [resetting, setResetting] = useState<boolean>(false);

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const singleJudgeUrl = `${baseUrl}/judge/${tatamiId}`;

  const fetchSlots = useCallback(async () => {
    try {
      const data = await api.get<{ slots: JudgeSlot[] }>(`/tatamis/${tatamiId}/judges`);
      setSlots(data.slots ?? []);
    } catch {
      // Ignore network hiccup
    }
  }, [tatamiId]);

  useEffect(() => {
    if (!isOpen) return;

    QRCode.toDataURL(singleJudgeUrl, {
      width: 300,
      margin: 2,
      color: {
        dark: '#090d16',
        light: '#ffffff',
      },
    })
      .then((url) => setQrUrl(url))
      .catch((err) => console.error('Failed to generate QR code:', err));

    void fetchSlots();
    const interval = setInterval(fetchSlots, 3000);
    return () => clearInterval(interval);
  }, [isOpen, singleJudgeUrl, fetchSlots]);

  if (!isOpen) return null;

  function copyLink() {
    navigator.clipboard.writeText(singleJudgeUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleResetJudges() {
    setResetting(true);
    try {
      await api.post(`/tatamis/${tatamiId}/judges/reset`, {});
      await fetchSlots();
    } catch (err) {
      console.error('Failed to reset judges:', err);
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="relative w-full max-w-lg rounded-2xl border border-ink-700 bg-ink-900 p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-ink-800 pb-4">
          <div className="flex items-center gap-2.5">
            <QrCode className="text-gold" size={24} />
            <div>
              <h2 className="text-lg font-bold text-ink-50">Judge Scan & Join</h2>
              <p className="text-xs text-ink-400">{tatamiName} · Sequential dynamic enrollment</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-ink-400 hover:bg-ink-800 hover:text-ink-200 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* QR Display */}
        <div className="mt-5 flex flex-col items-center">
          <div className="rounded-2xl bg-white p-4 shadow-xl border border-ink-600">
            {qrUrl ? (
              <img
                src={qrUrl}
                alt={`Single QR code for Tatami ${tatamiName}`}
                className="w-56 h-56 object-contain"
              />
            ) : (
              <div className="w-56 h-56 flex items-center justify-center text-ink-500 text-xs">
                Generating QR code...
              </div>
            )}
          </div>

          <div className="mt-3 text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-gold/15 px-3.5 py-1 text-xs font-bold text-gold border border-gold/40">
              <Smartphone size={14} />
              1 Single QR Code for All Judges
            </span>
            <p className="text-xs text-ink-300 mt-2 max-w-sm">
              Judges scan this same code. First person to scan becomes <strong>Judge 1</strong>, second becomes <strong>Judge 2</strong>, third becomes <strong>Judge 3</strong>, and so on.
            </p>
          </div>
        </div>

        {/* Enrolled Judges Roster */}
        <div className="mt-5 rounded-xl border border-ink-800 bg-ink-950/70 p-3.5">
          <div className="flex items-center justify-between pb-2 border-b border-ink-800/80">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-400">
              <Users size={14} className="text-gold" />
              <span>Connected Judges ({slots.length}/5)</span>
            </div>
            {slots.length > 0 && (
              <button
                type="button"
                onClick={handleResetJudges}
                disabled={resetting}
                className="flex items-center gap-1 text-[11px] text-stop hover:underline"
              >
                <RotateCcw size={11} />
                <span>Reset Panel</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-5 gap-2 mt-2.5">
            {[1, 2, 3, 4, 5].map((num) => {
              const slot = slots.find((s) => s.judgeNo === num);
              const isClaimed = !!slot;
              return (
                <div
                  key={num}
                  className={`flex flex-col items-center rounded-lg border p-2 text-center transition-all ${
                    isClaimed
                      ? 'border-go/50 bg-go/10 text-go'
                      : 'border-ink-800 bg-ink-900/50 text-ink-500'
                  }`}
                >
                  <span className="text-[11px] font-mono font-bold">Judge {num}</span>
                  <span className="mt-1 flex items-center gap-1 text-[10px] font-semibold">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        isClaimed ? 'bg-go animate-pulse' : 'bg-ink-600'
                      }`}
                    />
                    {isClaimed ? 'Claimed' : 'Waiting'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-6 flex items-center justify-between gap-3 border-t border-ink-800 pt-4">
          <Button
            variant="secondary"
            size="sm"
            onClick={copyLink}
            className="flex items-center gap-1.5 text-xs"
          >
            {copied ? <Check size={14} className="text-go" /> : <Copy size={14} />}
            {copied ? 'Copied link' : 'Copy link'}
          </Button>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.open(singleJudgeUrl, '_blank')}
              className="flex items-center gap-1 text-xs text-gold hover:text-gold/80"
            >
              <ExternalLink size={14} />
              Open as Judge
            </Button>
            <Button variant="primary" size="sm" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
