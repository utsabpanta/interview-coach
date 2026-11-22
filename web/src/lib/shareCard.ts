/** Draws the shareable progress card. It carries scores only: no answers, no job posting. */

export interface ShareCard {
  headline: string;
  subline: string;
}

export function shareHeadline(readiness: number, previous: number | null): string {
  return previous !== null && readiness > previous ? `${previous} to ${readiness} in one session` : `Interview readiness: ${readiness} / 100`;
}

export function drawShareCard(card: ShareCard): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.fillStyle = "#0F1115";
  ctx.fillRect(0, 0, 1200, 630);
  ctx.strokeStyle = "#2A2F3A";
  ctx.lineWidth = 2;
  ctx.strokeRect(40, 40, 1120, 550);

  // Logo: five voice bars.
  ctx.strokeStyle = "#B8F35A";
  ctx.lineWidth = 9;
  ctx.lineCap = "round";
  const bars = [22, 52, 78, 40, 16];
  bars.forEach((h, i) => {
    const x = 96 + i * 20;
    ctx.beginPath();
    ctx.moveTo(x, 140 - h / 2);
    ctx.lineTo(x, 140 + h / 2);
    ctx.stroke();
  });

  ctx.fillStyle = "#F2F3F5";
  ctx.font = '700 44px "Space Grotesk", system-ui, sans-serif';
  ctx.fillText("Callback", 210, 156);

  ctx.font = '700 84px "Space Grotesk", system-ui, sans-serif';
  let size = 84;
  while (ctx.measureText(card.headline).width > 1010 && size > 40) {
    size -= 4;
    ctx.font = `700 ${size}px "Space Grotesk", system-ui, sans-serif`;
  }
  ctx.fillStyle = "#B8F35A";
  ctx.fillText(card.headline, 96, 360);

  ctx.fillStyle = "#B4BAC6";
  ctx.font = '400 34px Inter, system-ui, sans-serif';
  ctx.fillText(card.subline.length > 58 ? `${card.subline.slice(0, 57)}…` : card.subline, 96, 430);

  ctx.fillStyle = "#A7ADBA";
  ctx.font = '400 26px Inter, system-ui, sans-serif';
  ctx.fillText("Spoken interview practice, open source", 96, 530);
  return canvas;
}

export function downloadCanvas(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}
