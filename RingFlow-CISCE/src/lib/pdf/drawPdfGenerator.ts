import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { BracketMatchView } from "@/lib/draws/assembleDraw";

export type CategoryDrawPdfData = {
  tournamentName: string;
  categoryName: string;
  eventDate?: string | null;
  venue?: string | null;
  tournamentSize: number;
  byeCount: number;
  matches: BracketMatchView[];
};

export async function generateCategoryDrawPdfBytes(
  data: CategoryDrawPdfData
): Promise<Uint8Array> {
  // Create landscape A4 document
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([842, 595]); // Landscape A4: 842 x 595 pt

  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const { width, height } = page.getSize();

  // Colors matching RingFlow theme
  const emerald = rgb(14 / 255, 156 / 255, 124 / 255); // #0E9C7C
  const darkInk = rgb(27 / 255, 24 / 255, 21 / 255); // #1B1815
  const mutedInk = rgb(104 / 255, 100 / 255, 90 / 255); // #68645A
  const lineGray = rgb(225 / 255, 221 / 255, 207 / 255); // #E1DDCF
  const cardBg = rgb(250 / 255, 249 / 255, 245 / 255); // #FAF9F5
  const redAka = rgb(228 / 255, 72 / 255, 60 / 255); // #E4483C
  const blueAo = rgb(29 / 255, 78 / 255, 216 / 255); // #1D4ED8

  // 1. Header Banner
  page.drawRectangle({
    x: 20,
    y: height - 65,
    width: width - 40,
    height: 48,
    color: cardBg,
    borderColor: lineGray,
    borderWidth: 1,
  });

  page.drawText(data.tournamentName.toUpperCase(), {
    x: 35,
    y: height - 35,
    size: 14,
    font: helveticaBold,
    color: emerald,
  });

  page.drawText(`CATEGORY: ${data.categoryName.toUpperCase()}`, {
    x: 35,
    y: height - 52,
    size: 11,
    font: helveticaBold,
    color: darkInk,
  });

  const metaRight = `Bracket Size: ${data.tournamentSize}  |  Byes: ${data.byeCount}  |  Official Draw Sheet`;
  page.drawText(metaRight, {
    x: width - 350,
    y: height - 42,
    size: 9,
    font: helvetica,
    color: mutedInk,
  });

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

  const topY = height - 90;
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

  // 3. Footer Sign-offs
  const footerY = 22;
  page.drawText("RingFlow Digital Tournament Management Platform", {
    x: 35,
    y: footerY,
    size: 7,
    font: helvetica,
    color: mutedInk,
  });

  page.drawText("Chief Referee: ____________________", {
    x: width / 2 - 70,
    y: footerY,
    size: 7.5,
    font: helvetica,
    color: darkInk,
  });

  page.drawText("Tatami Manager: ____________________", {
    x: width - 210,
    y: footerY,
    size: 7.5,
    font: helvetica,
    color: darkInk,
  });

  return await pdfDoc.save();
}
