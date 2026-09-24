import { PDFDocument, PDFPage, rgb, StandardFonts } from "pdf-lib";
import type { PDFFont } from "pdf-lib";
import type { BracketMatchView } from "@/lib/draws/assembleDraw";
import type { KataDrawTableView } from "@/lib/draws/kataTableView";

export type CategoryDrawPdfData = {
  tournamentName: string;
  categoryName: string;
  eventDate?: string | null;
  venue?: string | null;
  tournamentSize: number;
  byeCount: number;
  matches: BracketMatchView[];
  /** When set, the sheet renders group tables instead of the bracket tree. */
  kataDraw?: KataDrawTableView | null;
};

type Palette = {
  emerald: ReturnType<typeof rgb>;
  darkInk: ReturnType<typeof rgb>;
  mutedInk: ReturnType<typeof rgb>;
  lineGray: ReturnType<typeof rgb>;
  cardBg: ReturnType<typeof rgb>;
  redAka: ReturnType<typeof rgb>;
  blueAo: ReturnType<typeof rgb>;
};

type Fonts = { helvetica: PDFFont; helveticaBold: PDFFont };

const PAGE_W = 842; // Landscape A4
const PAGE_H = 595;

/** 21 -> "21", 21.5 -> "21.5", null -> "" (blank cell for handwriting). */
function fmtCell(value: number | null): string {
  if (value == null) return "";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export async function generateCategoryDrawPdfBytes(
  data: CategoryDrawPdfData
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();

  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fonts: Fonts = { helvetica, helveticaBold };

  const palette: Palette = {
    emerald: rgb(14 / 255, 156 / 255, 124 / 255), // #0E9C7C
    darkInk: rgb(27 / 255, 24 / 255, 21 / 255), // #1B1815
    mutedInk: rgb(104 / 255, 100 / 255, 90 / 255), // #68645A
    lineGray: rgb(225 / 255, 221 / 255, 207 / 255), // #E1DDCF
    cardBg: rgb(250 / 255, 249 / 255, 245 / 255), // #FAF9F5
    redAka: rgb(228 / 255, 72 / 255, 60 / 255), // #E4483C
    blueAo: rgb(29 / 255, 78 / 255, 216 / 255), // #1D4ED8
  };

  /** Fresh sheet page with the tournament header; returns the content top Y. */
  const addSheetPage = (): { page: PDFPage; contentTop: number } => {
    const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    const { width, height } = page.getSize();

    page.drawRectangle({
      x: 20,
      y: height - 65,
      width: width - 40,
      height: 48,
      color: palette.cardBg,
      borderColor: palette.lineGray,
      borderWidth: 1,
    });

    page.drawText(data.tournamentName.toUpperCase(), {
      x: 35,
      y: height - 35,
      size: 14,
      font: helveticaBold,
      color: palette.emerald,
    });

    page.drawText(`CATEGORY: ${data.categoryName.toUpperCase()}`, {
      x: 35,
      y: height - 52,
      size: 11,
      font: helveticaBold,
      color: palette.darkInk,
    });

    const metaRight = data.kataDraw
      ? `${data.kataDraw.format === "GROUPS_THEN_ELIMINATION" ? "Groups + elimination" : "Round robin"}  |  ${data.kataDraw.groups.length} group${data.kataDraw.groups.length === 1 ? "" : "s"}  |  Official Draw Sheet`
      : `Bracket Size: ${data.tournamentSize}  |  Byes: ${data.byeCount}  |  Official Draw Sheet`;
    page.drawText(metaRight, {
      x: width - 350,
      y: height - 42,
      size: 9,
      font: helvetica,
      color: palette.mutedInk,
    });

    return { page, contentTop: height - 90 };
  };

  const drawFooter = (page: PDFPage) => {
    const { width } = page.getSize();
    const footerY = 22;
    page.drawText("RingFlow Digital Tournament Management Platform", {
      x: 35,
      y: footerY,
      size: 7,
      font: helvetica,
      color: palette.mutedInk,
    });
    page.drawText("Chief Referee: ____________________", {
      x: width / 2 - 70,
      y: footerY,
      size: 7.5,
      font: helvetica,
      color: palette.darkInk,
    });
    page.drawText("Tatami Manager: ____________________", {
      x: width - 210,
      y: footerY,
      size: 7.5,
      font: helvetica,
      color: palette.darkInk,
    });
  };

  if (data.kataDraw) {
    renderKataGroupsSheet(pdfDoc, data, data.kataDraw, fonts, palette, addSheetPage, drawFooter);
  } else {
    const { page, contentTop } = addSheetPage();
    renderBracketSheet(page, data, fonts, palette, contentTop);
    drawFooter(page);
  }

  return await pdfDoc.save();
}

/**
 * Kata group formats: one scoring table per group (every participant named),
 * then the finals as a bout table. Unscored cells stay blank so the sheet
 * doubles as a hand-written scoring sheet at the tatami.
 */
function renderKataGroupsSheet(
  pdfDoc: PDFDocument,
  data: CategoryDrawPdfData,
  kataDraw: KataDrawTableView,
  fonts: Fonts,
  palette: Palette,
  addSheetPage: () => { page: PDFPage; contentTop: number },
  drawFooter: (page: PDFPage) => void
) {
  const { helvetica, helveticaBold } = fonts;
  const leftMargin = 30;
  const contentWidth = PAGE_W - 60;
  const bottomY = 44;

  let current = addSheetPage();
  let y = current.contentTop;
  const pages: PDFPage[] = [current.page];

  /** Start a fresh page when `needed` points of vertical space are missing. */
  const ensureSpace = (needed: number) => {
    if (y - needed >= bottomY) return;
    drawFooter(current.page);
    current = addSheetPage();
    pages.push(current.page);
    y = current.contentTop;
  };

  const drawGroupTitle = (page: PDFPage, title: string, subtitle: string) => {
    page.drawText(title.toUpperCase(), {
      x: leftMargin + 4,
      y,
      size: 10,
      font: helveticaBold,
      color: palette.emerald,
    });
    page.drawText(subtitle, {
      x: leftMargin + 4,
      y: y - 13,
      size: 7.5,
      font: helvetica,
      color: palette.mutedInk,
    });
    page.drawLine({
      start: { x: leftMargin, y: y - 17 },
      end: { x: leftMargin + contentWidth, y: y - 17 },
      thickness: 1.5,
      color: palette.emerald,
    });
    y -= 24;
  };

  for (const group of kataDraw.groups) {
    // Bout columns in bout-number order across the group.
    const boutNos: number[] = [];
    for (const m of group.members) {
      for (const b of m.bouts) {
        if (!boutNos.includes(b.matchNo)) boutNos.push(b.matchNo);
      }
    }
    boutNos.sort((a, b) => a - b);

    const colW = {
      idx: 26,
      name: 168,
      bout: 44,
      pts: 36,
      total: 44,
      rank: 36,
    };
    const tableWidth =
      colW.idx + colW.name + boutNos.length * colW.bout + colW.pts + colW.total + colW.rank;
    const rowH = 17;
    const headerH = 15;
    const tableH = headerH + group.members.length * rowH + 34;

    ensureSpace(tableH);
    const page = current.page;
    drawGroupTitle(
      page,
      group.name,
      kataDraw.format === "GROUPS_THEN_ELIMINATION"
        ? `Top ${kataDraw.advancePerGroup} qualify for the finals`
        : "Round robin — every athlete meets every other athlete"
    );

    const tableX = leftMargin + Math.max(0, (contentWidth - tableWidth) / 2);
    let cy = y;

    const columns: { label: string; width: number }[] = [
      { label: "#", width: colW.idx },
      { label: "PARTICIPANT", width: colW.name },
      ...boutNos.map((n) => ({ label: `B${n}`, width: colW.bout })),
      { label: "PTS", width: colW.pts },
      { label: "TOTAL", width: colW.total },
      { label: "RANK", width: colW.rank },
    ];

    // Header row
    let cx = tableX;
    for (const col of columns) {
      page.drawRectangle({ x: cx, y: cy - headerH, width: col.width, height: headerH, color: palette.cardBg, borderColor: palette.lineGray, borderWidth: 0.5 });
      page.drawText(col.label, {
        x: cx + 4,
        y: cy - headerH + 5,
        size: 7,
        font: helveticaBold,
        color: palette.mutedInk,
      });
      cx += col.width;
    }
    cy -= headerH;

    // Body rows
    group.members.forEach((m, i) => {
      cx = tableX;
      const cells: string[] = [
        String(i + 1),
        m.name,
        ...boutNos.map((n) => {
          const bout = m.bouts.find((b) => b.matchNo === n);
          return bout ? fmtCell(bout.score) : "";
        }),
        String(m.points),
        fmtCell(m.totalScore),
        m.qualified ? `${m.rank} Q` : String(m.rank),
      ];
      columns.forEach((col, ci) => {
        const isName = ci === 1;
        const isBoutCol = ci >= 2 && ci < 2 + boutNos.length;
        page.drawRectangle({
          x: cx,
          y: cy - rowH,
          width: col.width,
          height: rowH,
          color: rgb(1, 1, 1),
          borderColor: palette.lineGray,
          borderWidth: 0.5,
        });
        const text = cells[ci] ?? "";
        const maxChars = Math.floor(col.width / (isName ? 4.6 : 5.2));
        page.drawText(text.slice(0, maxChars), {
          x: cx + 4,
          y: cy - rowH + 6,
          size: 7.5,
          font: isName || (!isBoutCol && ci > 1) ? helveticaBold : helvetica,
          color:
            isBoutCol && m.bouts.find((b) => b.matchNo === boutNos[ci - 2])?.won
              ? palette.emerald
              : palette.darkInk,
        });
        cx += col.width;
      });
      cy -= rowH;
    });

    y = cy - 16;
  }

  // Finals table for groups-then-elimination.
  if (kataDraw.format === "GROUPS_THEN_ELIMINATION") {
    const finals = data.matches
      .filter((m) => m.bracketType !== "POOL")
      .sort((a, b) => a.matchNo - b.matchNo);
    if (finals.length > 0) {
      const rowH = 26;
      const headerH = 15;
      ensureSpace(headerH + finals.length * rowH + 34);
      const page = current.page;
      drawGroupTitle(page, "Finals", "Qualifiers fill in as the group stage completes");

      const colW = { bout: 44, round: 120, fa: 200, fb: 200, status: 70 };
      const tableWidth = colW.bout + colW.round + colW.fa + colW.fb + colW.status;
      const tableX = leftMargin + Math.max(0, (contentWidth - tableWidth) / 2);
      let cy = y;

      const columns: { label: string; width: number }[] = [
        { label: "BOUT", width: colW.bout },
        { label: "ROUND", width: colW.round },
        { label: "FIGHTER A", width: colW.fa },
        { label: "FIGHTER B", width: colW.fb },
        { label: "STATUS", width: colW.status },
      ];

      let cx = tableX;
      for (const col of columns) {
        page.drawRectangle({ x: cx, y: cy - headerH, width: col.width, height: headerH, color: palette.cardBg, borderColor: palette.lineGray, borderWidth: 0.5 });
        page.drawText(col.label, { x: cx + 4, y: cy - headerH + 5, size: 7, font: helveticaBold, color: palette.mutedInk });
        cx += col.width;
      }
      cy -= headerH;

      for (const m of finals) {
        const decided = m.status === "CONFIRMED" || m.winnerId != null;
        const scores = kataDraw.scoresByMatch[m.matchId];
        const akaWon = Boolean(m.winnerId && m.aka.id && m.winnerId === m.aka.id);
        const aoWon = Boolean(m.winnerId && m.ao.id && m.winnerId === m.ao.id);
        const rows: { text: string; sub?: string; bold?: boolean; won?: boolean }[] = [
          { text: `#${m.matchNo}` },
          { text: m.roundName },
          {
            text: m.aka.displayName.slice(0, 24),
            sub: m.aka.school?.slice(0, 28),
            bold: akaWon,
            won: akaWon,
          },
          {
            text: m.ao.displayName.slice(0, 24),
            sub: m.ao.school?.slice(0, 28),
            bold: aoWon,
            won: aoWon,
          },
          { text: decided ? "DONE" : m.status },
        ];
        cx = tableX;
        columns.forEach((col, ci) => {
          page.drawRectangle({
            x: cx,
            y: cy - rowH,
            width: col.width,
            height: rowH,
            color: rgb(1, 1, 1),
            borderColor: palette.lineGray,
            borderWidth: 0.5,
          });
          const cell = rows[ci];
          if (cell) {
            page.drawText(cell.text, {
              x: cx + 4,
              y: cy - rowH + 14,
              size: 7.5,
              font: cell.bold ? helveticaBold : helvetica,
              color: cell.won ? palette.emerald : palette.darkInk,
            });
            if (ci === 2 || ci === 3) {
              const score = scores?.[ci === 2 ? "aka" : "ao"];
              if (score != null) {
                const s = fmtCell(score);
                page.drawText(s, {
                  x: cx + col.width - 8 - s.length * 4.5,
                  y: cy - rowH + 14,
                  size: 7.5,
                  font: helveticaBold,
                  color: palette.darkInk,
                });
              }
            }
            if (cell.sub) {
              page.drawText(cell.sub, {
                x: cx + 4,
                y: cy - rowH + 5,
                size: 6,
                font: helvetica,
                color: palette.mutedInk,
              });
            }
          }
          cx += col.width;
        });
        cy -= rowH;
      }
      y = cy - 16;
    }
  }

  for (const p of pages) drawFooter(p);
  void pdfDoc;
}

/**
 * The classic single-elimination bracket sheet, unchanged.
 */
function renderBracketSheet(
  page: PDFPage,
  data: CategoryDrawPdfData,
  fonts: Fonts,
  palette: Palette,
  contentTop: number
) {
  const { helvetica, helveticaBold } = fonts;
  const { emerald, darkInk, mutedInk, lineGray, cardBg, redAka, blueAo } = palette;
  const { width, height } = page.getSize();
  void height;

  // 2. Compute Rounds Layout
  const mainMatches = data.matches.filter((m) => m.bracketType === "MAIN");
  const roundsMap = new Map<number, BracketMatchView[]>();
  for (const m of mainMatches) {
    const list = roundsMap.get(m.roundNo) ?? [];
    list.push(m);
    roundsMap.set(m.roundNo, list);
  }

  const sortedRounds = Array.from(roundsMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([rNo, list]) => ({
      roundNo: rNo,
      roundName: list[0]?.roundName || `Round ${rNo}`,
      matches: list.sort((a, b) => a.matchNo - b.matchNo),
    }));

  const numRounds = Math.max(1, sortedRounds.length);
  const leftMargin = 30;
  const contentWidth = width - 60;
  const colWidth = Math.min(170, (contentWidth - (numRounds - 1) * 20) / numRounds);
  const colGap = (contentWidth - colWidth * numRounds) / Math.max(1, numRounds - 1);

  const topY = contentTop;
  const bottomY = 40;
  const availableHeight = topY - bottomY;

  // Render Round Columns
  sortedRounds.forEach((col, cIdx) => {
    const colX = leftMargin + cIdx * (colWidth + colGap);

    // Column Header
    page.drawText(col.roundName.toUpperCase(), {
      x: colX + 4,
      y: topY - 12,
      size: 9,
      font: helveticaBold,
      color: emerald,
    });

    page.drawLine({
      start: { x: colX, y: topY - 18 },
      end: { x: colX + colWidth, y: topY - 18 },
      thickness: 1.5,
      color: emerald,
    });

    const matchCount = col.matches.length;
    const matchSlotHeight = (availableHeight - 30) / matchCount;

    col.matches.forEach((match, mIdx) => {
      const matchCenterY = topY - 30 - (mIdx + 0.5) * matchSlotHeight;
      const boxHeight = Math.min(46, matchSlotHeight - 10);
      const boxY = matchCenterY - boxHeight / 2;

    const isDecided = match.status === "CONFIRMED" || match.winnerId != null;
    const isLive = match.status === "LIVE";
    const akaWon = Boolean(match.winnerId && match.aka.id && match.winnerId === match.aka.id);
    const aoWon = Boolean(match.winnerId && match.ao.id && match.winnerId === match.ao.id);
    const showScore = isDecided || isLive;

    // Match Box Container
    page.drawRectangle({
      x: colX,
      y: boxY,
      width: colWidth,
      height: boxHeight,
      color: rgb(1, 1, 1),
      borderColor: isDecided ? emerald : lineGray,
      borderWidth: isDecided ? 1.2 : 1,
    });

    // Match Header / No / Status
    page.drawRectangle({
      x: colX,
      y: boxY + boxHeight - 12,
      width: colWidth,
      height: 12,
      color: isLive ? rgb(254 / 255, 243 / 255, 199 / 255) : cardBg,
    });

    const statusText = isLive ? "LIVE" : isDecided ? "DONE" : "";
    page.drawText(`Match #${match.matchNo}${statusText ? ` · ${statusText}` : ""}`, {
      x: colX + 6,
      y: boxY + boxHeight - 9,
      size: 7,
      font: helveticaBold,
      color: isLive ? rgb(180 / 255, 83 / 255, 9 / 255) : mutedInk,
    });

    // AKA color bar
    page.drawRectangle({
      x: colX + 2,
      y: boxY + boxHeight / 2,
      width: 3,
      height: boxHeight / 2 - 12,
      color: redAka,
    });

    // AKA name
    const akaName = match.aka.displayName.slice(0, 18);
    page.drawText(akaName, {
      x: colX + 8,
      y: boxY + boxHeight - 22,
      size: 7.5,
      font: akaWon ? helveticaBold : helvetica,
      color: akaWon ? emerald : darkInk,
    });

    if (akaWon) {
      page.drawText("WIN", {
        x: colX + colWidth - 55,
        y: boxY + boxHeight - 22,
        size: 6.5,
        font: helveticaBold,
        color: emerald,
      });
    }

    if (match.aka.school) {
      page.drawText(match.aka.school.slice(0, 20), {
        x: colX + 8,
        y: boxY + boxHeight - 29,
        size: 6,
        font: helvetica,
        color: mutedInk,
      });
    }

    // Divider line
    page.drawLine({
      start: { x: colX, y: boxY + boxHeight / 2 - 2 },
      end: { x: colX + colWidth, y: boxY + boxHeight / 2 - 2 },
      thickness: 0.5,
      color: lineGray,
    });

    // AO color bar
    page.drawRectangle({
      x: colX + 2,
      y: boxY + 2,
      width: 3,
      height: boxHeight / 2 - 4,
      color: blueAo,
    });

    // AO name
    const aoName = match.ao.displayName.slice(0, 18);
    page.drawText(aoName, {
      x: colX + 8,
      y: boxY + boxHeight / 2 - 12,
      size: 7.5,
      font: aoWon ? helveticaBold : helvetica,
      color: aoWon ? emerald : darkInk,
    });

    if (aoWon) {
      page.drawText("WIN", {
        x: colX + colWidth - 55,
        y: boxY + boxHeight / 2 - 12,
        size: 6.5,
        font: helveticaBold,
        color: emerald,
      });
    }

    if (match.ao.school) {
      page.drawText(match.ao.school.slice(0, 20), {
        x: colX + 8,
        y: boxY + 4,
        size: 6,
        font: helvetica,
        color: mutedInk,
      });
    }

    // Score / Result Box on the right (shows points & Senshu)
    const scoreBoxWidth = 26;
    const scoreBoxX = colX + colWidth - scoreBoxWidth - 2;
    page.drawRectangle({
      x: scoreBoxX,
      y: boxY + 3,
      width: scoreBoxWidth,
      height: boxHeight - 16,
      color: cardBg,
      borderColor: lineGray,
      borderWidth: 0.5,
    });

    if (showScore) {
      // AKA score
      const akaScoreStr = `${match.senshu === "AKA" ? "S " : ""}${match.akaScore ?? 0}`;
      page.drawText(akaScoreStr, {
        x: scoreBoxX + 4,
        y: boxY + boxHeight - 22,
        size: 7.5,
        font: helveticaBold,
        color: akaWon ? emerald : darkInk,
      });

      // AO score
      const aoScoreStr = `${match.senshu === "AO" ? "S " : ""}${match.aoScore ?? 0}`;
      page.drawText(aoScoreStr, {
        x: scoreBoxX + 4,
        y: boxY + boxHeight / 2 - 12,
        size: 7.5,
        font: helveticaBold,
        color: aoWon ? emerald : darkInk,
      });
    }
    });
  });
}
