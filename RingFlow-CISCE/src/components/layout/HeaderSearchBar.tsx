"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { matchesCategorySearch } from "@/lib/searchUtils";
import { PdfViewerModal } from "@/components/ui/PdfViewerModal";
import "@/components/public/public-spectator.css";

interface SearchAthlete {
  id: string;
  name: string;
  chest_number: string | null;
  category_id: string | null;
  categories?: {
    id?: string;
    name?: string;
    doc_url?: string;
  } | null;
}

interface HeaderSearchBarProps {
  tournamentId: string;
  role: "admin" | "organiser" | "stager";
  className?: string;
  autoFocus?: boolean;
}

const statusMeta: Record<string, { label: string; cls: string }> = {
  run: { label: "LIVE", cls: "spectator-status-run" },
  pause: { label: "PAUSED", cls: "spectator-status-pause" },
  queued: { label: "QUEUED", cls: "spectator-status-queued" },
  completed: { label: "COMPLETED", cls: "spectator-status-completed" },
  idle: { label: "IDLE", cls: "spectator-status-idle" },
  unscheduled: { label: "UNSCHEDULED", cls: "spectator-status-unscheduled" },
};

export default function HeaderSearchBar({
  tournamentId,
  role,
  className = "",
  autoFocus = false,
}: HeaderSearchBarProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchAthlete[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [cachedCategories, setCachedCategories] = useState<any[]>([]);
  const [cachedAssignments, setCachedAssignments] = useState<any[]>([]);
  const [cachedRings, setCachedRings] = useState<any[]>([]);
  const [viewingPdf, setViewingPdf] = useState<{ url: string; title: string } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus input when requested (e.g. stager popdown open)
  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus();
      const raf = requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [autoFocus]);

  // Load tournament categories, rings and assignments once for fast matching & ring status
  useEffect(() => {
    if (!tournamentId) return;
    const supabase = createClient();

    const loadMeta = async () => {
      try {
        const [catsRes, ringsRes, assignRes] = await Promise.all([
          supabase.from("categories").select("*").eq("tournament_id", tournamentId),
          supabase.from("rings").select("*").eq("tournament_id", tournamentId),
          supabase
            .from("category_assignments")
            .select("category_id, ring_id, status")
            .order("queue_order", { ascending: true }),
        ]);

        if (catsRes.data) setCachedCategories(catsRes.data);
        if (ringsRes.data) setCachedRings(ringsRes.data);
        if (assignRes.data) setCachedAssignments(assignRes.data);
      } catch (err) {
        console.error("HeaderSearchBar meta load error:", err);
      }
    };

    loadMeta();
  }, [tournamentId]);

  // Handle outside click to close dropdown
  useEffect(() => {
    const handleDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("click", handleDocClick);
    return () => document.removeEventListener("click", handleDocClick);
  }, []);

  // Compute ring assignment for athlete (same as public side)
  const getAthleteRingStatus = (categoryId?: string | null) => {
    if (!categoryId) {
      return { status: "unscheduled", matLabel: "Not yet allocated" };
    }
    const assignment = cachedAssignments.find((a) => a.category_id === categoryId);
    if (!assignment) {
      return { status: "unscheduled", matLabel: "Not yet allocated" };
    }
    const ring = cachedRings.find((r) => r.id === assignment.ring_id);
    if (!ring) {
      return { status: "unscheduled", matLabel: "Not yet allocated" };
    }

    const ringOrderNum = String(ring.ring_order || 1).padStart(2, "0");
    const matLabel = ring.mat_name
      ? `Tatami ${ringOrderNum} · ${ring.mat_name}`
      : `Tatami ${ringOrderNum}`;

    if (assignment.status === "running") {
      return { status: "run", matLabel };
    }
    if (assignment.status === "paused") {
      return { status: "pause", matLabel };
    }
    if (assignment.status === "pending") {
      return { status: "queued", matLabel };
    }
    if (assignment.status === "completed") {
      return { status: "completed", matLabel };
    }
    return { status: "idle", matLabel };
  };

  // Live search query
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || !tournamentId) {
      setResults([]);
      setIsLoading(false);
      setIsOpen(false);
      return;
    }

    setIsLoading(true);
    setIsOpen(true);
    const cleanQ = trimmed.replace(/^#/, "").trim();

    const runSearch = async () => {
      try {
        const supabase = createClient();
        const isNumeric = /^\d+$/.test(cleanQ);
        const nameFilter = isNumeric
          ? `name.ilike.%${cleanQ}%,chest_number.eq.${cleanQ}`
          : `name.ilike.%${cleanQ}%,chest_number.ilike.%${cleanQ}%`;

        // 1. Direct name or exact chest number match
        const directPromise = supabase
          .from("athletes")
          .select("id, name, chest_number, category_id, categories(id, name, doc_url)")
          .eq("tournament_id", tournamentId)
          .or(nameFilter)
          .limit(25);

        // 2. Ensure categories are loaded for category-based matching
        let categoriesToSearch = cachedCategories;
        if (!categoriesToSearch || categoriesToSearch.length === 0) {
          const { data: fetchedCats } = await supabase
            .from("categories")
            .select("*")
            .eq("tournament_id", tournamentId);
          if (fetchedCats && fetchedCats.length > 0) {
            categoriesToSearch = fetchedCats;
            setCachedCategories(fetchedCats);
          }
        }

        // 3. Category matches (e.g. u14_30-35kg, 30, 45, etc.)
        const matchingCatIds = (categoriesToSearch || [])
          .filter((cat) => matchesCategorySearch(cat, trimmed))
          .map((cat) => cat.id);

        let catPromise = null;
        if (matchingCatIds.length > 0) {
          catPromise = supabase
            .from("athletes")
            .select("id, name, chest_number, category_id, categories(id, name, doc_url)")
            .eq("tournament_id", tournamentId)
            .in("category_id", matchingCatIds.slice(0, 50))
            .limit(40);
        }

        const [directRes, catRes] = await Promise.all([
          directPromise,
          catPromise ? catPromise : Promise.resolve({ data: null, error: null }),
        ]);

        const combined: SearchAthlete[] = [];
        const seen = new Set<string>();

        const appendAthlete = (raw: any) => {
          if (seen.has(raw.id)) return;
          seen.add(raw.id);
          combined.push(raw);
        };

        if (directRes?.data) {
          for (const item of directRes.data) appendAthlete(item);
        }
        if (catRes?.data) {
          for (const item of catRes.data) appendAthlete(item);
        }

        setResults(combined);
      } catch (err) {
        console.error("Search fetch error:", err);
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    };

    const debounce = setTimeout(runSearch, 180);
    return () => clearTimeout(debounce);
  }, [query, tournamentId, cachedCategories]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    if (results.length > 0) {
      handleSelectAthlete(results[0]);
      return;
    }
  };

  const handleSelectAthlete = (athlete: SearchAthlete) => {
    const docUrl =
      athlete.categories?.doc_url ||
      cachedCategories.find((c) => c.id === athlete.category_id)?.doc_url;
    const displayCategoryName =
      athlete.categories?.name ||
      cachedCategories.find((c) => c.id === athlete.category_id)?.name ||
      "Category";

    if (docUrl) {
      setIsOpen(false);
      setViewingPdf({
        url: docUrl,
        title: `${athlete.name} · ${displayCategoryName}`,
      });
      return;
    }

    setIsOpen(false);
    if (role === "stager") {
      if (athlete.category_id) {
        const assignment = cachedAssignments.find((a) => a.category_id === athlete.category_id);
        if (assignment?.ring_id) {
          const el = document.getElementById(`ring-card-${assignment.ring_id}`);
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
            el.classList.add("ring-4", "ring-emerald-500/80");
            setTimeout(() => el.classList.remove("ring-4", "ring-emerald-500/80"), 2500);
          }
        }
      }
      return;
    }
  };

  return (
    <div ref={containerRef} className={`relative flex-1 max-w-[440px] mx-auto ${isOpen ? "z-[100]" : ""} ${className}`}>
      {/* ─── Search Input Field ─── */}
      <form
        onSubmit={handleSubmit}
        className="w-full h-10 flex items-center gap-2.5 px-3.5 border border-[#E1DDCF] rounded-lg text-[13px] bg-white hover:border-[#8C877C] focus-within:border-[#0E9C7C] focus-within:ring-2 focus-within:ring-[#0E9C7C]/20 transition-all shadow-2xs"
      >
        <svg
          className="w-4 h-4 text-[#94A3B8] shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => {
            if (query.trim()) setIsOpen(true);
          }}
          placeholder="Search athletes or categories…"
          className="w-full bg-transparent border-none outline-none text-[13px] text-[#0F172A] placeholder-[#94A3B8] truncate"
        />
        {query.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setResults([]);
              setIsOpen(false);
              inputRef.current?.focus();
            }}
            className="w-4 h-4 rounded-full text-[#94A3B8] hover:text-[#0F172A] flex items-center justify-center shrink-0 cursor-pointer"
            aria-label="Clear search"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3.5 h-3.5">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </form>

      {/* ─── Live Search Results Dropdown (Exact Public Spectator UI) ─── */}
      {isOpen && (
        <div
          className="spectator-search-results open !block absolute !left-0 !right-0 !w-full top-[calc(100%+6px)] !z-[99999] text-left shadow-2xl !transform-none"
          style={{ left: 0, right: 0, width: "100%", transform: "none", zIndex: 99999 }}
          role="listbox"
        >
          {isLoading ? (
            <div className="spectator-no-results">Searching athletes...</div>
          ) : results.length === 0 ? (
            <div className="spectator-no-results">No athletes match that search.</div>
          ) : (
            results.map((athlete) => {
              const { status, matLabel } = getAthleteRingStatus(athlete.category_id);
              const meta = statusMeta[status] || statusMeta.unscheduled;
              const parts = matLabel.match(/(Tatami \d+)(.*)/);
              const docUrl =
                athlete.categories?.doc_url ||
                cachedCategories.find((c) => c.id === athlete.category_id)?.doc_url;
              const displayCategoryName =
                athlete.categories?.name ||
                cachedCategories.find((c) => c.id === athlete.category_id)?.name ||
                "Uncategorized";

              return (
                <div
                  key={athlete.id}
                  onClick={() => handleSelectAthlete(athlete)}
                  className="spectator-result-row"
                  role="option"
                >
                  {/* Top Row: Chest & Athlete Name on Left, Status Badge on Right */}
                  <div className="spectator-result-top">
                    <div className="spectator-result-name-group">
                      <span className="spectator-result-chest mono">
                        #{athlete.chest_number || "-"}
                      </span>
                      <span className="spectator-result-name">{athlete.name}</span>
                    </div>
                    <span className={`spectator-status ${meta.cls}`}>
                      <span className="dot"></span>
                      {meta.label}
                    </span>
                  </div>

                  {/* Bottom Row: Category & View Draws on Left, Tatami Mat Info on Right */}
                  <div className="spectator-result-bottom">
                    <div className="spectator-result-category-wrap">
                      <span className="spectator-result-division">
                        {displayCategoryName}
                      </span>
                      {docUrl && (
                        <button
                          type="button"
                          className="spectator-pdf-chip"
                          onClick={(e) => {
                            e.stopPropagation();
                            setIsOpen(false);
                            setViewingPdf({
                              url: docUrl,
                              title: `${athlete.name} · ${displayCategoryName}`,
                            });
                          }}
                          title="View category draws PDF"
                        >
                          <svg className="spectator-pdf-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                            <rect x="0.5" y="0.5" width="15" height="15" rx="3" fill="#68645A" stroke="#524F47" strokeWidth="0.5" />
                            <text x="8" y="11" fill="#FFFFFF" fontSize="6.5" fontWeight="800" textAnchor="middle" fontFamily="system-ui, -apple-system, sans-serif" letterSpacing="0.2">PDF</text>
                          </svg>
                          <span className="spectator-draws-link">View Draws</span>
                        </button>
                      )}
                    </div>

                    <div className="spectator-result-mat">
                      {parts ? (
                        <>
                          <strong>{parts[1]}</strong>
                          {parts[2]}
                        </>
                      ) : (
                        matLabel
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Category Draws PDF Viewer Modal */}
      {viewingPdf && (
        <PdfViewerModal
          url={viewingPdf.url}
          title={viewingPdf.title}
          onClose={() => setViewingPdf(null)}
        />
      )}
    </div>
  );
}
