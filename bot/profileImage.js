import { GlobalFonts, Image, loadImage, createCanvas } from '@napi-rs/canvas';
import { env } from '../src/config/env.js';
import { logger } from '../src/utils/logger.js';
import { badgeEmoji, COVERAGE_EMOJI } from './emojiRegistry.js';

const log = logger.child('profile-card');

/**
 * Profile card renderer — draws an 800×400 PNG summarizing the global
 * profile: avatar + identity header, emoji badge shelf, 2×4 stat grid,
 * coverage strip, and a footer. Falls back (returns null) gracefully so
 * /profile never breaks if canvas or fonts are unavailable.
 */

export const CARD_WIDTH = 800;
export const CARD_HEIGHT = 400;

const LEVEL_COLORS = {
  NEW: [88, 101, 242],
  ESTABLISHED: [87, 242, 135],
  TRUSTED: [254, 231, 92],
  EXEMPLARY: [241, 196, 15],
  FLAGGED: [237, 66, 69],
};

const STAT_DEFS = [
  ['💬', 'messages'],
  ['👍', 'reactions'],
  ['🎙️', 'voice'],
  ['⌨️', 'commands'],
  ['🗓️', 'active days'],
  ['🌐', 'communities'],
  ['✅', 'verified'],
  ['⭐', 'reputation'],
];

const FONT_CANDIDATES = [
  ['Segoe UI', 'C:\\Windows\\Fonts\\seguisb.ttf'],
  ['Segoe UI Emoji', 'C:\\Windows\\Fonts\\seguiemj.ttf'],
];

let fontRegistered = false;

function ensureFonts() {
  if (fontRegistered) return;
  let failures = 0;
  for (const [family, file] of FONT_CANDIDATES) {
    try {
      GlobalFonts.registerFromPath(file, family, { style: 'normal' });
    } catch {
      failures += 1;
    }
  }
  fontRegistered = true;
  if (failures > 0) {
    log.warn(`profile card: ${failures} system font(s) not found — text may fall back`);
  }
}

/** Stable per-user pastel color derived from the id hash. */
function colorFromUserId(userId) {
  let hash = 0;
  for (const ch of String(userId ?? 'azra')) {
    hash = (hash * 31 + ch.codePointAt(0)) % 10_000;
  }
  const hue = hash % 360;
  const s = 0.45, l = 0.55;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** Rounded-rectangle background using the library's 5-arg arcTo. */
function roundRect(ctx, x, y, w, h, radius) {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  // Top-right corner.
  ctx.arcTo(x + w - r, y, x + w, y + r, r);
  // Bottom-right corner.
  ctx.arcTo(x + w, y + h - r, x + w - r, y + h, r);
  // Bottom-left corner.
  ctx.arcTo(x + r, y + h, x, y + h - r, r);
  // Top-left corner.
  ctx.arcTo(x, y + r, x + r, y, r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

/** Colored circle + initial placeholder avatar as a PNG buffer. */
export async function createAvatarPlaceholder(userId, displayName) {
  try {
    ensureFonts();
    const size = 128;
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');
    const [r, g, b] = colorFromUserId(userId);
    ctx.antialias = 'gray';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fill();
    ctx.fillStyle = 'white';
    ctx.font = '52px Segoe UI';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const initial = (displayName ?? '?').trim().slice(0, 1).toUpperCase() || '?';
    ctx.fillText(initial, size / 2, size / 2);
    return canvas.encode('png');
  } catch (err) {
    log.warn('placeholder avatar failed', { error: err.message });
    return null;
  }
}

/**
 * Renders the profile card. Returns a PNG Buffer, or null on any failure.
 * summary: global profile summary shape; avatarBuffer: optional PNG buffer.
 */
export async function renderProfileCard({ summary, avatarBuffer = null } = {}) {
  try {
    ensureFonts();
    const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
    const ctx = canvas.getContext('2d');
    ctx.antialias = 'gray';

    const level = summary.reputation?.level ?? 'NEW';
    const [r, g, b] = LEVEL_COLORS[level] ?? LEVEL_COLORS.NEW;

    const grd = ctx.createLinearGradient(0, 0, 0, CARD_HEIGHT);
    grd.addColorStop(0, `rgba(${r + 20},${g + 20},${b + 20},0.96)`);
    grd.addColorStop(1, `rgba(${Math.max(0, r - 30)},${Math.max(0, g - 30)},${Math.max(0, b - 30)},0.96)`);
    ctx.fillStyle = grd;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 2;
    roundRect(ctx, 0, 0, CARD_WIDTH, CARD_HEIGHT, 24);

    const avatar = avatarBuffer ?? await createAvatarPlaceholder(summary.user.userId, summary.user.displayName ?? summary.user.username);
    if (avatar) {
      const img = await loadImage(avatar);
      ctx.save();
      ctx.beginPath();
      ctx.arc(80, 80, 56, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, 24, 24, 112, 112);
      ctx.restore();
      if (summary.verification?.highestLevel === 'CROSS_GUILD') {
        ctx.lineWidth = 5;
        ctx.strokeStyle = '#57f287';
        ctx.beginPath();
        ctx.arc(80, 80, 58, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else {
      ctx.beginPath();
      ctx.arc(80, 80, 58, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fill();
    }

    // Header.
    ctx.font = '600 30px Segoe UI';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(summary.user.displayName ?? summary.user.username ?? 'AZRA User').slice(0, 40), 170, 55);
    ctx.font = '20px Segoe UI';
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.fillText(`@${summary.user.username ?? '—'} · ${summary.user.userId}`, 170, 92);
    if (summary.user.isBot) {
      ctx.font = '20px Segoe UI Emoji';
      ctx.fillText('🤖', 170, 115);
    }

    // Badge shelf.
    const badges = summary.badges?.items ?? [];
    let bx = 170;
    ctx.font = '26px Segoe UI Emoji';
    for (const badge of badges.slice(0, 8)) {
      ctx.fillText(badgeEmoji(badge.key), bx, 112);
      bx += 44;
    }

    // Stats grid — 4 cols × 2 rows.
    const cellW = CARD_WIDTH / 4;
    for (let i = 0; i < STAT_DEFS.length; i += 1) {
      const [emoji, label] = STAT_DEFS[i];
      const col = i % 4;
      const row = Math.floor(i / 4);
      const x = 24 + col * cellW;
      const y = 150 + row * 105;

      ctx.font = '30px Segoe UI Emoji';
      ctx.fillText(emoji, x, y + 24);
      ctx.font = '600 26px Segoe UI';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(formatStat(label, statValue(summary, label)), x + 70, y + 24);
    }

    // Coverage strip.
    ctx.font = '18px Segoe UI';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(`🌐 ${summary.coverage?.note ?? ''}`.slice(0, 110), 24, 368);

    // Footer.
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('AZRA Global Profile', CARD_WIDTH - 24, CARD_HEIGHT - 16);
    ctx.fillText(`Generated ${(summary.generatedAt ?? new Date().toISOString()).slice(0, 10)}`, CARD_WIDTH - 24, CARD_HEIGHT - 38);

    return canvas.encode('png');
  } catch (err) {
    log.error('profile card render failed', { error: err.message });
    return null;
  }
}

function statValue(summary, label) {
  const a = summary.activity;
  switch (label) {
    case 'messages': return a?.totals?.messagesSeen ?? null;
    case 'reactions': return a?.totals?.reactionsAdded ?? null;
    case 'voice': return a?.totals?.voiceMinutes ?? null;
    case 'commands': return a?.totals?.commandsUsed ?? null;
    case 'active days': return a?.totals?.activeDays ?? null;
    case 'communities': return summary.activity?.contributingGuilds ?? summary.verification?.confirmingGuilds ?? null;
    case 'verified': return summary.verification ? String(summary.verification.status).toLowerCase() : 'no';
    case 'reputation': return summary.reputation?.level ?? '—';
    default: return null;
  }
}

function formatStat(label, value) {
  if (value == null) return '—';
  if (label === 'verified') return value === 'verified' ? 'yes' : String(value);
  if (typeof value === 'number') return value.toLocaleString('en-US');
  return String(value);
}