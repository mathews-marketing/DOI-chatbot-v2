/* Done In One chatbot launcher. Keep this URL in the website once. */
(function () {
  'use strict';
  if (window.__archieLauncherInstalled) return;
  window.__archieLauncherInstalled = true;

  const ownScript = document.currentScript;
  if (!ownScript || !ownScript.src) return;
  const pageBase = new URL('./', ownScript.src);
  const frameOrigin = pageBase.origin;
  const keys = ['doiChatVisitorId', 'chatSessionId', 'implantBotName'];
// Runs on the host page. It reads existing tags/cookies; it installs no tracking tags.
function createAttributionCollector() {
    const parameterNames = [
        'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
        'gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'ttclid'
    ];
    const sessionKey = 'doiChatAttributionV1';
    const sessionTtl = 30 * 60 * 1000;
    let memoryAttribution = null;
    let recentGa4 = {};

    function readSession() {
        let value = memoryAttribution;
        try {
            value = JSON.parse(window.sessionStorage.getItem(sessionKey) || 'null') || value;
        } catch (_) { /* Use the in-page fallback when storage is blocked. */ }
        return value && Date.now() - Number(value.lastSeenAt) < sessionTtl ? value : null;
    }

    function readCookie(name) {
        try {
            const entry = document.cookie.split(';').map(value => value.trim())
                .find(value => value.startsWith(name + '='));
            if (!entry) return null;
            const value = entry.slice(name.length + 1);
            try { return decodeURIComponent(value); } catch (_) { return value; }
        } catch (_) { return null; }
    }

    function measurementId() {
        if (typeof window.__archieGA4MeasurementId === 'string') return window.__archieGA4MeasurementId;
        const ids = {
            'getdoneinone.com': 'G-Y8D0SC75XT',
            'www.getdoneinone.com': 'G-Y8D0SC75XT',
            'go.getdoneinone.com': 'G-VC7X2696N3'
        };
        return ids[window.location.hostname] || null;
    }

    function snapshot() {
        const params = new URL(window.location.href).searchParams;
        const incoming = Object.fromEntries(parameterNames.map(key => [key, params.get(key) || null]));
        const fingerprint = JSON.stringify(incoming);
        let cached = readSession();
        if (Object.values(incoming).some(value => value !== null) && cached?.fingerprint !== fingerprint) {
            cached = {
                parameters: incoming, fingerprint,
                landingPageUrl: window.location.href,
                referrerUrl: document.referrer || null,
                capturedAt: new Date().toISOString()
            };
        }
        if (cached) {
            cached.lastSeenAt = Date.now();
            memoryAttribution = cached;
            try { window.sessionStorage.setItem(sessionKey, JSON.stringify(cached)); } catch (_) {}
        }
        return {
            ...Object.fromEntries(parameterNames.map(key => [key, cached?.parameters?.[key] || null])),
            pageUrl: window.location.href,
            pageTitle: document.title || '',
            referrer: document.referrer || null,
            attribution_page_url: cached?.landingPageUrl || window.location.href,
            attribution_referrer_url: cached?.referrerUrl || document.referrer || null,
            attribution_captured_at: cached?.capturedAt || null,
            hubspotutk: readCookie('hubspotutk'),
            ga4_measurement_id: measurementId(),
            ga4_client_id: recentGa4.ga4_client_id || null,
            ga4_session_id: recentGa4.ga4_session_id || null,
            ga4_session_number: recentGa4.ga4_session_number || null
        };
    }

    function getGa4Value(field) {
        return new Promise(resolve => {
            const id = measurementId();
            const tag = typeof window.gtag === 'function' ? window.gtag :
                (Array.isArray(window.dataLayer) ? function () { window.dataLayer.push(arguments); } : null);
            if (!id || !tag) { resolve(null); return; }
            let done = false;
            const finish = value => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                resolve(value === undefined || value === null || value === '' ? null : String(value));
            };
            const timer = setTimeout(() => finish(null), 1600);
            try { tag('get', id, field, finish); } catch (_) { finish(null); }
        });
    }

    async function collect() {
        // Capture the landing URL before waiting for an analytics callback.
        snapshot();
        const fields = ['client_id', 'session_id', 'session_number'];
        const values = await Promise.all(fields.map(getGa4Value));
        // Do not fabricate IDs or retain stale IDs if analytics is unavailable.
        recentGa4 = Object.fromEntries(fields.map((field, index) => ['ga4_' + field, values[index]]));
        return snapshot();
    }

    return { snapshot, collect };
}

  const attributionCollector = createAttributionCollector();
  attributionCollector.snapshot();

  function storageSnapshot() {
    const result = {};
    for (const key of keys) {
      try {
        const value = window.localStorage.getItem(key);
        if (value !== null) result[key] = value;
      } catch (_) { /* Storage may be unavailable. The widget has a fallback. */ }
    }
    return result;
  }

  function mount() {
    if (document.getElementById('archie-chat-frame')) return;
    const frame = document.createElement('iframe');
    frame.id = 'archie-chat-frame';
    frame.title = 'Chat with Done In One';
    frame.setAttribute('aria-label', 'Done In One chat assistant');
    frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin');
    frame.setAttribute('allow', 'autoplay');
    frame.setAttribute('scrolling', 'no');

    const styles = {
      position: 'fixed', left: '0', bottom: '0', top: 'auto', right: 'auto',
      width: 'min(290px, 100vw)', height: 'min(110px, 100dvh)',
      border: '0', margin: '0', padding: '0', display: 'block',
      background: 'transparent', overflow: 'hidden', zIndex: '2147483647'
    };
    for (const [property, value] of Object.entries(styles)) {
      frame.style.setProperty(property.replace(/[A-Z]/g, c => '-' + c.toLowerCase()), value, 'important');
    }

    function sendContext(requestId, tracking = attributionCollector.snapshot()) {
      frame.contentWindow?.postMessage({
        type: 'archie-host-context', requestId,
        hostOrigin: window.location.origin,
        pageUrl: window.location.href,
        pageTitle: document.title || '',
        referrer: document.referrer || '',
        tracking, storage: storageSnapshot()
      }, frameOrigin);
    }
    async function sendFreshContext(requestId) {
      const tracking = await attributionCollector.collect();
      sendContext(requestId, tracking);
    }

    window.addEventListener('message', function (event) {
      if (event.source !== frame.contentWindow || event.origin !== frameOrigin) return;
      const data = event.data;
      if (data?.type === 'archie-widget-ready') {
        sendContext();
        sendFreshContext();
      }
      if (data?.type === 'archie-attribution-request') sendFreshContext(data.requestId);
      if (data?.type === 'archie-widget-size') {
        const resize = () => {
          frame.style.setProperty('width', data.open ? 'min(374px, 100vw)' : 'min(290px, 100vw)', 'important');
          frame.style.setProperty('height', data.open ? 'min(680px, 100dvh)' : 'min(110px, 100dvh)', 'important');
        };
        if (data.open) resize(); else setTimeout(resize, 280);
      }
      if (data?.type === 'archie-storage-set' && keys.includes(data.key) && typeof data.value === 'string') {
        try { window.localStorage.setItem(data.key, data.value); } catch (_) {}
      }
    });

    frame.addEventListener('load', () => { sendContext(); sendFreshContext(); });
    document.body.appendChild(frame);
    const iframeUrl = new URL('index.html', pageBase);
    iframeUrl.searchParams.set('v', String(Date.now()));
    frame.src = iframeUrl.href;
  }

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount, { once: true });
})();
