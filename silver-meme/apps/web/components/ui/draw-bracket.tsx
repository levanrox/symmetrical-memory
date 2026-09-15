'use client';

import { useEffect, useRef, useState, useMemo, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { StatusPill } from '@/components/ui/status-pill';
import { Download, ZoomIn, ZoomOut, RotateCcw, Trophy, CheckCircle2, Swords } from 'lucide-react';
import { toPng } from 'html-to-image';

export interface BracketSlot {
  position: number;
  registrationId: string | null;
  sourceMatchId: string | null;
}

export interface BracketMatch {
  matchId: string;
  matchNo: number;
  roundNo: number;
  roundName: string;
  bracketType: string;
  status: string;
  slots?: BracketSlot[];
  aka: { displayName: string };
  ao: { displayName: string };
  state?: {
    points?: { aka: number; ao: number };
    winner?: { side: string; method: string };
  } | null;
}

interface ConnectorLine {
  id: string;
  fromMatchId: string;
  toMatchId: string;
  path: string;
  isActive: boolean;
}

export function DrawBracket({
  matches,
  readyMatchIds = [],
  selectedMatchId = null,
  onMatchClick,
  title,
  categoryName = 'Category',
  version = 1,
  showDownload = true,
  className,
}: {
  matches: BracketMatch[];
  readyMatchIds?: readonly string[];
  selectedMatchId?: string | null;
  onMatchClick?: (matchId: string) => void;
  title?: string;
  categoryName?: string;
  version?: number;
  showDownload?: boolean;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const captureRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<ConnectorLine[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [zoom, setZoom] = useState(1);

  // Group matches by bracketType and sort rounds ascending
  const { mainRounds, otherMatches } = useMemo(() => {
    const main = matches.filter((m) => m.bracketType === 'MAIN');
    const others = matches.filter((m) => m.bracketType !== 'MAIN');

    const byRound = new Map<number, BracketMatch[]>();
    for (const match of main) {
      const list = byRound.get(match.roundNo) ?? [];
      list.push(match);
      byRound.set(match.roundNo, list);
    }

    // Sort rounds ascending and matches in each round by matchNo
    const sortedRounds = Array.from(byRound.entries())
      .sort(([a], [b]) => a - b)
      .map(([roundNo, list]) => [roundNo, list.sort((a, b) => a.matchNo - b.matchNo)] as const);

    return { mainRounds: sortedRounds, otherMatches: others };
  }, [matches]);

  // Compute SVG connector lines between matches using sourceMatchId
  const updateLines = () => {
    if (!captureRef.current) return;
    const captureEl = captureRef.current;
    const captureRect = captureEl.getBoundingClientRect();

    const newLines: ConnectorLine[] = [];

    for (const match of matches) {
      if (!match.slots) continue;
      for (const slot of match.slots) {
        if (!slot.sourceMatchId) continue;

        const sourceEl = captureEl.querySelector(`[data-match-id="${slot.sourceMatchId}"]`);
        const targetEl = captureEl.querySelector(`[data-match-id="${match.matchId}"]`);

        if (!sourceEl || !targetEl) continue;

        const sRect = sourceEl.getBoundingClientRect();
        const tRect = targetEl.getBoundingClientRect();

        // Coordinates relative to captureEl
        const x1 = (sRect.right - captureRect.left) / zoom;
        const y1 = (sRect.top + sRect.height / 2 - captureRect.top) / zoom;
        const x2 = (tRect.left - captureRect.left) / zoom;
        const y2 =
          (tRect.top +
            (slot.position === 1 ? tRect.height * 0.35 : tRect.height * 0.65) -
            captureRect.top) /
          zoom;

        const midX = (x1 + x2) / 2;
        // Smooth curved horizontal step
        const path = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;

        const isReady = readyMatchIds.includes(match.matchId);
        const isSelected = selectedMatchId === match.matchId;

        newLines.push({
          id: `${slot.sourceMatchId}->${match.matchId}:${slot.position}`,
          fromMatchId: slot.sourceMatchId,
          toMatchId: match.matchId,
          path,
          isActive: isSelected || isReady,
        });
      }
    }

    setLines(newLines);
  };

  useEffect(() => {
    // Recalculate on matches change, mount, or zoom change
    const timer = setTimeout(updateLines, 80);
    window.addEventListener('resize', updateLines);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updateLines);
    };
  }, [matches, readyMatchIds, selectedMatchId, zoom]);

  const handleDownload = async () => {
    if (!captureRef.current || downloading) return;
    setDownloading(true);
    try {
      // Temporarily ensure full scale for high-def image
      const originalZoom = zoom;
      setZoom(1);
      await new Promise((r) => setTimeout(r, 120));

      const dataUrl = await toPng(captureRef.current, {
        backgroundColor: '#0a0f1d',
        cacheBust: true,
        pixelRatio: 2,
      });

      setZoom(originalZoom);

      const link = document.createElement('a');
      const safeName = categoryName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      link.download = `${safeName}-draw-v${version}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Failed to export bracket image', err);
    } finally {
      setDownloading(false);
    }
  };

  if (matches.length === 0) {
    return (
      <div className="rounded-lg border border-ink-800 bg-ink-900/60 p-6 text-center text-sm text-ink-400">
        No draw matches generated yet.
      </div>
    );
  }

  return (
    <div className={cn('relative flex flex-col gap-3', className)}>
      {/* Top action toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-800 pb-2.5">
        <div className="flex items-center gap-2">
          <Trophy size={16} className="text-gold" />
          <span className="text-xs font-semibold uppercase tracking-wider text-ink-300">
            {title ?? 'Tournament Bracket Tree'}
          </span>
          <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[0.65rem] font-mono text-ink-400">
            {matches.length} matches
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.6, z - 0.1))}
            className="flex h-7 w-7 items-center justify-center rounded border border-ink-700 bg-ink-850 text-ink-300 transition-colors hover:border-ink-600 hover:text-ink-100"
            title="Zoom out"
          >
            <ZoomOut size={13} />
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            className="flex h-7 items-center justify-center rounded border border-ink-700 bg-ink-850 px-2 text-[0.7rem] font-mono text-ink-300 transition-colors hover:border-ink-600 hover:text-ink-100"
            title="Reset zoom"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(1.4, z + 0.1))}
            className="flex h-7 w-7 items-center justify-center rounded border border-ink-700 bg-ink-850 text-ink-300 transition-colors hover:border-ink-600 hover:text-ink-100"
            title="Zoom in"
          >
            <ZoomIn size={13} />
          </button>

          {showDownload && (
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading}
              className="ml-2 inline-flex h-7 items-center gap-1.5 rounded border border-gold/40 bg-gold-soft px-2.5 text-xs font-medium text-gold transition-all hover:border-gold hover:bg-gold-soft/80 disabled:opacity-50"
              title="Download bracket as PNG image"
            >
              <Download size={13} />
              <span>{downloading ? 'Exporting...' : 'Download Draw'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Horizontally scrollable tree container */}
      <div
        ref={containerRef}
        className="relative max-h-[700px] overflow-auto rounded-xl border border-ink-800 bg-ink-950 p-4 scrollbar-thin scrollbar-thumb-ink-700"
      >
        <div
          ref={captureRef}
          style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
          className="relative inline-flex flex-col gap-8 min-w-max p-4 transition-transform duration-100"
        >
          {/* SVG Connector Overlay */}
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            style={{ zIndex: 0 }}
          >
            <defs>
              <linearGradient id="activeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="var(--color-ink-600)" />
                <stop offset="100%" stopColor="var(--color-gold)" />
              </linearGradient>
            </defs>
            {lines.map((line) => (
              <path
                key={line.id}
                d={line.path}
                fill="none"
                stroke={line.isActive ? 'url(#activeGrad)' : 'rgba(100, 116, 139, 0.28)'}
                strokeWidth={line.isActive ? 2 : 1.5}
                strokeDasharray={line.isActive ? 'none' : '4 3'}
                className="transition-all duration-300"
              />
            ))}
          </svg>

          {/* Main Tournament Tree Columns */}
          <div className="relative z-10 flex gap-12 sm:gap-16">
            {mainRounds.map(([roundNo, roundMatches], roundIdx) => {
              const roundTitle = roundMatches[0]?.roundName ?? `Round ${roundNo}`;

              return (
                <div key={roundNo} className="flex min-w-[210px] sm:min-w-[230px] flex-col">
                  {/* Round Column Header */}
                  <div className="mb-4 text-center">
                    <div className="inline-block rounded-full border border-ink-700 bg-ink-900/90 px-3 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wider text-ink-300 shadow-sm">
                      {roundTitle}
                    </div>
                  </div>

                  {/* Matches vertically spaced to form a tree */}
                  <div className="flex flex-1 flex-col justify-around gap-6">
                    {roundMatches.map((match) => (
                      <MatchCard
                        key={match.matchId}
                        match={match}
                        isReady={readyMatchIds.includes(match.matchId)}
                        isSelected={selectedMatchId === match.matchId}
                        onSelect={() => onMatchClick?.(match.matchId)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Other brackets (Repechage / Bronze) */}
          {otherMatches.length > 0 && (
            <div className="relative z-10 mt-6 border-t border-ink-800 pt-6">
              <div className="mb-3 flex items-center gap-2">
                <Swords size={14} className="text-ink-400" />
                <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-300">
                  Repechage & Finals
                </h4>
              </div>
              <div className="flex flex-wrap gap-4">
                {otherMatches.map((match) => (
                  <MatchCard
                    key={match.matchId}
                    match={match}
                    isReady={readyMatchIds.includes(match.matchId)}
                    isSelected={selectedMatchId === match.matchId}
                    onSelect={() => onMatchClick?.(match.matchId)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MatchCard({
  match,
  isReady,
  isSelected,
  onSelect,
}: {
  match: BracketMatch;
  isReady: boolean;
  isSelected: boolean;
  onSelect?: () => void;
}) {
  const isFinished = match.status === 'FINISHED' || match.status === 'CONFIRMED';
  const isLive = match.status === 'LIVE' || match.status === 'STARTED';

  const akaScore = match.state?.points?.aka;
  const aoScore = match.state?.points?.ao;
  const winnerSide = match.state?.winner?.side;

  return (
    <div
      data-match-id={match.matchId}
      onClick={onSelect}
      className={cn(
        'group relative flex w-[210px] sm:w-[230px] cursor-pointer flex-col rounded-lg border transition-all duration-150 select-none shadow-md',
        isSelected
          ? 'border-gold bg-ink-850 ring-2 ring-gold/70 shadow-gold/10'
          : isReady
            ? 'border-gold/60 bg-ink-900 hover:border-gold hover:bg-ink-850'
            : isLive
              ? 'border-stop/70 bg-ink-900 shadow-stop/10 animate-pulse'
              : 'border-ink-800 bg-ink-900 hover:border-ink-600 hover:bg-ink-850',
      )}
    >
      {/* Top bar: match no & status */}
      <div className="flex items-center justify-between border-b border-ink-800/80 px-2.5 py-1 text-[0.65rem]">
        <span className="font-mono font-medium text-ink-400">
          M{match.matchNo}
          {match.bracketType !== 'MAIN' && ` · ${match.bracketType.replace('_', ' ').toLowerCase()}`}
        </span>
        <div className="flex items-center gap-1">
          {isReady && !isFinished && (
            <span className="h-1.5 w-1.5 rounded-full bg-gold animate-ping" />
          )}
          <StatusPill
            tone={
              isReady
                ? 'warn'
                : isLive
                  ? 'bad'
                  : isFinished
                    ? 'good'
                    : 'neutral'
            }
          >
            {isReady ? 'ready' : match.status.toLowerCase()}
          </StatusPill>
        </div>
      </div>

      {/* Participants */}
      <div className="flex flex-col p-1.5 gap-1 text-xs">
        {/* AKA (Red) */}
        <div
          className={cn(
            'flex items-center justify-between rounded px-2 py-1 transition-colors',
            winnerSide === 'AKA' ? 'bg-aka-soft/60 font-medium' : 'hover:bg-ink-800/50',
          )}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-full bg-aka" />
            <span className="text-[0.65rem] font-bold text-aka">AKA</span>
            <span className="truncate text-ink-100" title={match.aka.displayName}>
              {match.aka.displayName || '—'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {akaScore !== undefined && (
              <span className="font-mono text-xs font-bold text-ink-200">{akaScore}</span>
            )}
            {winnerSide === 'AKA' && <CheckCircle2 size={12} className="text-aka shrink-0" />}
          </div>
        </div>

        {/* AO (Blue) */}
        <div
          className={cn(
            'flex items-center justify-between rounded px-2 py-1 transition-colors',
            winnerSide === 'AO' ? 'bg-ao-soft/60 font-medium' : 'hover:bg-ink-800/50',
          )}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-full bg-ao" />
            <span className="text-[0.65rem] font-bold text-ao">AO</span>
            <span className="truncate text-ink-100" title={match.ao.displayName}>
              {match.ao.displayName || '—'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {aoScore !== undefined && (
              <span className="font-mono text-xs font-bold text-ink-200">{aoScore}</span>
            )}
            {winnerSide === 'AO' && <CheckCircle2 size={12} className="text-ao shrink-0" />}
          </div>
        </div>
      </div>

      {isSelected && (
        <div className="absolute -bottom-2 right-2 rounded bg-gold px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-wider text-ink-950 shadow">
          Active
        </div>
      )}
    </div>
  );
}
