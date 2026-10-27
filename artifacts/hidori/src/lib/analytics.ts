const ALLOWED_EVENTS = ["page_view", "login_start", "form_start", "form_submit"] as const;
type AnalyticsEvent = typeof ALLOWED_EVENTS[number];

interface UtmParams {
  source: string | null;
  campaign: string | null;
  content: string | null;
}

function isDNTEnabled(): boolean {
  const nav = navigator as any;
  return nav.doNotTrack === "1" || nav.globalPrivacyControl === true;
}

function getUtmParams(): UtmParams {
  const params = new URLSearchParams(window.location.search);
  return {
    source: params.get("utm_source"),
    campaign: params.get("utm_campaign"),
    content: params.get("utm_content"),
  };
}

function maskPath(path: string): string {
  const withoutQuery = path.split(/[?#]/)[0] || "/";
  
  if (withoutQuery.startsWith("/admin")) {
    return "";
  }
  
  const pollIdPattern = /^\/p\/[^/]+(?:\/edit)?$/;
  const pollIdAnyPattern = /^\/p\/.+/;
  
  if (pollIdPattern.test(withoutQuery)) {
    if (withoutQuery.endsWith("/edit")) {
      return "/p/[id]/edit";
    }
    return "/p/[id]";
  }
  
  if (pollIdAnyPattern.test(withoutQuery)) {
    return "/p/[id]/…";
  }
  
  return withoutQuery;
}

function storeUtmParams(params: UtmParams): void {
  const stored = sessionStorage.getItem("hidori_utm");
  if (stored) return;
  
  if (params.source || params.campaign || params.content) {
    sessionStorage.setItem("hidori_utm", JSON.stringify(params));
  }
}

function getStoredUtmParams(): UtmParams {
  const stored = sessionStorage.getItem("hidori_utm");
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      // ignore
    }
  }
  return { source: null, campaign: null, content: null };
}

function hasTrackedEvent(event: AnalyticsEvent): boolean {
  const key = `hidori_tracked_${event}`;
  return sessionStorage.getItem(key) === "1";
}

function markEventTracked(event: AnalyticsEvent): void {
  const key = `hidori_tracked_${event}`;
  sessionStorage.setItem(key, "1");
}

export function trackEvent(event: AnalyticsEvent): void {
  try {
    if (isDNTEnabled()) return;
    if (hasTrackedEvent(event)) return;
    
    const path = maskPath(window.location.pathname);
    if (!path) return;
    
    const utm = getStoredUtmParams();
    
    const payload = {
      event,
      path,
      utm_source: utm.source,
      utm_campaign: utm.campaign,
      utm_content: utm.content,
    };
    
    markEventTracked(event);
    
    if (navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
      navigator.sendBeacon("/api/track", blob);
    } else {
      fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {
        // silent fail
      });
    }
  } catch {
    // silent fail
  }
}

export function initAnalytics(): void {
  try {
    if (isDNTEnabled()) return;
    
    const utm = getUtmParams();
    storeUtmParams(utm);
    
    if (!hasTrackedEvent("page_view")) {
      trackEvent("page_view");
    }
  } catch {
    // silent fail
  }
}
