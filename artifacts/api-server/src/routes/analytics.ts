import { Router, type IRouter } from "express";
import { db, analyticsEventsTable } from "@workspace/db";

const router: IRouter = Router();

const ALLOWED_EVENTS = new Set(["page_view", "login_start", "form_start", "form_submit"]);
const ipRateLimits = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 30;
const DAILY_CAP = 50000;
let dailyCount = 0;
let dailyResetTime = Date.now() + 24 * 60 * 60 * 1000;

const BOT_USER_AGENTS = [
  "bot", "crawler", "spider", "scraper", "slurp", "googlebot", "bingbot",
  "yandex", "baiduspider", "duckduckbot", "facebookexternalhit", "twitterbot",
  "whatsapp", "telegram", "linkedinbot", "slack", "discord",
];

function isBot(userAgent: string | undefined): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return BOT_USER_AGENTS.some((bot) => ua.includes(bot));
}

function checkDNT(req: any): boolean {
  return req.header("DNT") === "1" || req.header("Sec-GPC") === "1";
}

function sanitizeUtmValue(value: string | undefined): string | null {
  if (!value) return null;
  const truncated = value.slice(0, 100);
  const sanitized = truncated.replace(/[^A-Za-z0-9-_.]/g, "");
  return sanitized || null;
}

function maskPath(path: string): string {
  if (!path.startsWith("/")) return "/";
  
  const withoutQuery = path.split(/[?#]/)[0] || "/";
  const truncated = withoutQuery.slice(0, 200);
  
  if (truncated.startsWith("/admin")) {
    return "";
  }
  
  const pollIdPattern = /^\/p\/[^/]+(?:\/edit)?$/;
  const pollIdAnyPattern = /^\/p\/.+/;
  
  if (pollIdPattern.test(truncated)) {
    if (truncated.endsWith("/edit")) {
      return "/p/[id]/edit";
    }
    return "/p/[id]";
  }
  
  if (pollIdAnyPattern.test(truncated)) {
    return "/p/[id]/…";
  }
  
  return truncated;
}

function checkOrigin(req: any): boolean {
  const origin = req.header("Origin");
  const referer = req.header("Referer");
  if (!origin && !referer) return false;
  
  const host = req.header("Host");
  if (!host) return false;
  
  if (origin) {
    try {
      const originUrl = new URL(origin);
      if (originUrl.host !== host) return false;
    } catch {
      return false;
    }
  }
  
  if (referer && !origin) {
    try {
      const refererUrl = new URL(referer);
      if (refererUrl.host !== host) return false;
    } catch {
      return false;
    }
  }
  
  return true;
}

router.post("/track", async (req, res): Promise<void> => {
  try {
    res.status(204).end();
    
    if (checkDNT(req)) return;
    if (isBot(req.header("User-Agent"))) return;
    if (!checkOrigin(req)) return;
    
    const now = Date.now();
    if (now >= dailyResetTime) {
      dailyCount = 0;
      dailyResetTime = now + 24 * 60 * 60 * 1000;
    }
    
    if (dailyCount >= DAILY_CAP) {
      if (dailyCount === DAILY_CAP) {
        req.log.warn("Analytics daily cap reached, dropping events");
        dailyCount++;
      }
      return;
    }
    
    const ip = req.ip ?? "unknown";
    const recentRequests = ipRateLimits.get(ip) ?? [];
    const validRequests = recentRequests.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW_MS);
    
    if (validRequests.length >= RATE_LIMIT_MAX) {
      return;
    }
    
    ipRateLimits.set(ip, [...validRequests, now]);
    
    if (ipRateLimits.size > 10000) {
      const oldestAllowed = now - RATE_LIMIT_WINDOW_MS;
      for (const [key, timestamps] of ipRateLimits.entries()) {
        if (timestamps.every(t => t < oldestAllowed)) {
          ipRateLimits.delete(key);
        }
      }
    }
    
    const body = req.body;
    if (!body || typeof body !== "object") return;
    
    const { event, path } = body;
    
    if (!ALLOWED_EVENTS.has(event)) return;
    if (typeof path !== "string") return;
    
    const maskedPath = maskPath(path);
    if (!maskedPath) return;
    
    const utmSource = sanitizeUtmValue(body.utm_source);
    const utmCampaign = sanitizeUtmValue(body.utm_campaign);
    const utmContent = sanitizeUtmValue(body.utm_content);
    
    await db.insert(analyticsEventsTable).values({
      event,
      path: maskedPath,
      utmSource,
      utmCampaign,
      utmContent,
    });
    
    dailyCount++;
  } catch (error) {
    // Silent fail
  }
});

export default router;
