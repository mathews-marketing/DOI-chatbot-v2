(function() {

    // ------------------------------------------

    // GLOBALS (Attached to window so HTML buttons can find them securely)

    // ------------------------------------------

    window.implantBotState = {

        consult: { interest: '', location: '', best_time: '' },

        candidate: { current_state: '', timeframe: '' }

    };

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

    // The parent page owns attribution, cookies and GA4 for the iframe.
    let hostContext = window.__archieHostContext || {
        pageUrl: window.parent === window ? window.location.href : (document.referrer || ''),
        pageTitle: window.parent === window ? document.title || '' : '',
        referrer: window.parent === window ? document.referrer || '' : '',
        storage: {}, tracking: {}
    };
    const allowedStorageKeys = ['doiChatVisitorId', 'chatSessionId', 'implantBotName'];
    const memoryStorage = { ...(hostContext.storage || {}) };
    const pendingAttribution = new Map();
    let expectedHostOrigin = '';
    try { expectedHostOrigin = new URL(hostContext.hostOrigin || document.referrer).origin; } catch (_) {}
    const storage = {
        getItem(key) {
            if (Object.prototype.hasOwnProperty.call(memoryStorage, key)) return memoryStorage[key];
            try { return localStorage.getItem(key); } catch (_) { return null; }
        },
        setItem(key, value) {
            memoryStorage[key] = String(value);
            try { localStorage.setItem(key, String(value)); } catch (_) {}
            if (window.parent !== window && allowedStorageKeys.includes(key)) {
                window.parent.postMessage({ type: 'archie-storage-set', key, value: String(value) }, expectedHostOrigin || '*');
            }
        }
    };
    function applyHostContext(data) {
        hostContext = {
            ...hostContext,
            pageUrl: typeof data.pageUrl === 'string' ? data.pageUrl : hostContext.pageUrl,
            pageTitle: typeof data.pageTitle === 'string' ? data.pageTitle : hostContext.pageTitle,
            referrer: typeof data.referrer === 'string' ? data.referrer : hostContext.referrer,
            tracking: data.tracking && typeof data.tracking === 'object' ? data.tracking : (hostContext.tracking || {})
        };
        for (const key of allowedStorageKeys) {
            if (typeof data.storage?.[key] === 'string') memoryStorage[key] = data.storage[key];
        }
    }
    window.addEventListener('message', (event) => {
        if (event.source !== window.parent || event.data?.type !== 'archie-host-context') return;
        if (expectedHostOrigin && event.origin !== expectedHostOrigin) return;
        if (!expectedHostOrigin && event.origin && event.origin !== 'null') expectedHostOrigin = event.origin;
        applyHostContext(event.data);
        const request = pendingAttribution.get(event.data.requestId);
        if (request) request();
    });
    const localAttribution = window.parent === window ? createAttributionCollector() : null;
    async function collectSubmissionAttribution() {
        if (localAttribution) {
            hostContext.tracking = await localAttribution.collect();
            hostContext.pageUrl = window.location.href;
            hostContext.pageTitle = document.title || '';
            hostContext.referrer = document.referrer || '';
        } else {
            const requestId = createTrackingId('attribution');
            await new Promise(resolve => {
                let done = false;
                const finish = () => {
                    if (done) return;
                    done = true; clearTimeout(timer);
                    pendingAttribution.delete(requestId); resolve();
                };
                const timer = setTimeout(finish, 2300);
                pendingAttribution.set(requestId, finish);
                window.parent.postMessage({ type: 'archie-attribution-request', requestId }, expectedHostOrigin || '*');
            });
        }
        const tracking = hostContext.tracking || {};
        const keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
            'gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'ttclid', 'hubspotutk',
            'ga4_client_id', 'ga4_session_id', 'ga4_session_number', 'ga4_measurement_id',
            'attribution_page_url', 'attribution_referrer_url', 'attribution_captured_at'];
        return {
            ...Object.fromEntries(keys.map(key => [key, tracking[key] ?? null])),
            pageUrl: hostContext.pageUrl || tracking.pageUrl || null,
            pageTitle: hostContext.pageTitle || tracking.pageTitle || '',
            referrer: hostContext.referrer || tracking.referrer || null,
            fullCaptureUrl: hostContext.pageUrl || tracking.pageUrl || null,
            pageName: hostContext.pageTitle || tracking.pageTitle || '',
            referrerUrl: hostContext.referrer || tracking.referrer || null
        };
    }
    function mapPreferredOffice(value) {
        return { 'Boca Raton': 'In-Person: Boca Raton', 'Tampa': 'In-Person: Tampa',
            'Jacksonville': 'In-Person: Jacksonville', 'Virtual': 'Virtual' }[value] || null;
    }

    // Constants

    const WEBHOOK_URL = 'https://api.mikemathewscmo.com/webhook/schedule-consultation'; 

    const N8N_WEBHOOK_URL = 'https://api.mikemathewscmo.com/webhook/ask-archie-question';

    const NOTIFICATION_SOUND_URL = 'https://assets.cdn.filesafe.space/pavIFdgrv0CTos4BgVKm/media/6a01a85abc1f77cc3588852a.mp3';

    const MESSAGE_SOUND_URL = 'https://assets.cdn.filesafe.space/pavIFdgrv0CTos4BgVKm/media/6a3ec3a6d50c4ff184ddb813.mp3';

    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // State Variables

    let isWidgetOpen = false;

    let hasInteracted = false;

    let hasPlayedSound = false;

    let badgeVisible = false;

    let audioUnlocked = false;

    // Audio Objects

    let dingAudio = new Audio(NOTIFICATION_SOUND_URL);

    let msgAudio = new Audio(MESSAGE_SOUND_URL);

    // Tracking Helpers

    function createTrackingId(prefix) { return prefix + '-' + ((typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).substr(2, 9)); }

    function getChatVisitorId() { let id = storage.getItem('doiChatVisitorId'); if (!id) { id = createTrackingId('visitor'); storage.setItem('doiChatVisitorId', id); } return id; }

    function getChatSessionId() { let id = storage.getItem('chatSessionId'); if (!id) { id = createTrackingId('sid'); storage.setItem('chatSessionId', id); } return id; }

    function getSavedFirstName() { const n = storage.getItem('implantBotName'); return n ? n.split(' ')[0].charAt(0).toUpperCase() + n.split(' ')[0].slice(1) : null; }

    // Initialization Function (Waits for DOM)

    function initArchieWidget() {

        // Safe Lucide initialization

        if (typeof lucide !== 'undefined' && lucide.createIcons) { lucide.createIcons(); }

        dingAudio.load(); msgAudio.load();

        // DOM Elements

        const panel = document.getElementById('widget-panel');

        const triggerBtn = document.getElementById('trigger-btn');

        const triggerBubble = document.getElementById('trigger-bubble');

        const bentoView = document.getElementById('bento-view');

        const chatView = document.getElementById('chat-view');

        const chatHistory = document.getElementById('chat-history');

        const triggerText = document.getElementById('trigger-text');

        const iconDefault = document.getElementById('icon-default');

        const iconActive = document.getElementById('icon-active');

        const triggerDot = document.getElementById('trigger-dot');

        const notificationBadge = document.getElementById('notification-badge');

        const chatHeaderTitle = document.getElementById('chat-header-title');

        const stepIndicator = document.getElementById('step-indicator');

        const navBackBtn = document.getElementById('nav-back-btn');

        const savedName = getSavedFirstName();

        if (savedName) {

            if (triggerText) triggerText.textContent = `Hi, ${savedName}! Have a question?`;

            const wb = document.getElementById('welcome-bubble');

            if (wb) wb.textContent = `Hi, ${savedName}! I can answer your questions about Done In One. Tap Ask Archie a Question below.`;

        }

        // Sound Engine

        function playMessageSound() { let sound = msgAudio.cloneNode(); sound.volume = 0.4; sound.play().catch(e => {}); }

        function attemptDing() { if (hasPlayedSound) return; const p = dingAudio.play(); if (p !== undefined) p.then(() => hasPlayedSound = true).catch(e => {}); }

        function triggerNotification() {

            if (isWidgetOpen || badgeVisible) return;

            badgeVisible = true;

            if(notificationBadge) { notificationBadge.style.display = 'flex'; setTimeout(() => { notificationBadge.classList.remove('opacity-0', 'scale-0'); notificationBadge.classList.add('opacity-100', 'scale-100'); }, 10); }

            if(triggerBubble) { triggerBubble.style.display = 'block'; setTimeout(() => { triggerBubble.classList.remove('opacity-0', 'scale-95', 'translate-y-3', 'pointer-events-none'); triggerBubble.classList.add('animate-attention'); setTimeout(() => triggerBubble.classList.remove('animate-attention'), 1000); }, 10); }

            attemptDing(); 

        }

        setTimeout(triggerNotification, 3000);

        const unlockAudio = () => {

            if (audioUnlocked) return; audioUnlocked = true;

            if (!hasPlayedSound && badgeVisible) attemptDing();

            else { dingAudio.play().then(() => { dingAudio.pause(); dingAudio.currentTime = 0; }).catch(()=>{}); msgAudio.play().then(() => { msgAudio.pause(); msgAudio.currentTime = 0; }).catch(()=>{}); }

            ['click', 'keydown', 'touchstart', 'scroll', 'mousemove', 'wheel'].forEach(evt => document.removeEventListener(evt, unlockAudio));

        };

        ['click', 'keydown', 'touchstart', 'scroll', 'mousemove', 'wheel'].forEach(evt => document.addEventListener(evt, unlockAudio, { passive: true }));

        // Safe Toggle Widget (Exported to Window)

        window.toggleWidget = function() {

            isWidgetOpen = !isWidgetOpen; hasInteracted = true;
            // Resize the parent iframe so it only covers the area the chatbot uses.
            if (window.parent !== window) {
                window.parent.postMessage({ type: 'archie-widget-size', open: isWidgetOpen }, '*');
            }
 

            if (isWidgetOpen && !hasPlayedSound) attemptDing();

            if (isWidgetOpen) {

                panel.style.display = 'flex'; panel.classList.remove('animate-fade-out-down');

                setTimeout(() => { panel.classList.remove('widget-hidden'); panel.classList.add('widget-visible'); }, 10);

                triggerBubble.style.display = 'none'; iconDefault.style.display = 'none'; iconActive.style.display = 'flex'; triggerDot.style.display = 'none';

                notificationBadge.classList.add('opacity-0', 'scale-0'); notificationBadge.classList.remove('opacity-100', 'scale-100');

            } else {

                panel.classList.remove('widget-visible'); panel.classList.add('widget-hidden');

                setTimeout(() => {

                    panel.style.display = 'none';

                    chatView.classList.add('opacity-0', 'translate-x-full', 'pointer-events-none'); chatView.classList.remove('opacity-100', 'translate-x-0');

                    bentoView.classList.add('opacity-100', 'translate-x-0'); bentoView.classList.remove('opacity-0', '-translate-x-10', 'pointer-events-none');

                    document.getElementById('hipaa-footer').style.display = ''; document.getElementById('chat-input-area').style.setProperty('display', 'none', 'important');

                }, 250);

                triggerBubble.style.display = 'block'; triggerBubble.classList.remove('opacity-0', 'scale-95', 'translate-y-3', 'pointer-events-none');

                triggerText.textContent = savedName ? `Hi, ${savedName}! Have a question?` : "Have questions? We’re online and happy to help";

                iconActive.style.display = 'none'; iconDefault.style.display = 'block'; triggerDot.style.display = 'block';

            }

        };

        // Chat UI Helpers

        const getBotAvatarHTML = () => `<div class="w-7 h-7 rounded-full overflow-hidden shrink-0 mt-1 shadow-sm bg-white border border-slate-100" style="background-color: white !important;"><img src="https://assets.cdn.filesafe.space/QxqsOC7AbRmImFQOw9qw/media/6a359db572754a77aa69ff98.png" alt="Archie" class="w-full h-full object-cover"></div>`;

        function appendBotMessage(text) {

            if (isWidgetOpen) playMessageSound();

            chatHistory.insertAdjacentHTML('beforeend', `<div class="flex gap-2.5 w-[90%] animate-message shrink-0">${getBotAvatarHTML()}<div class="bg-white border border-slate-100 rounded-2xl rounded-tl-sm p-3.5 shadow-card text-[13.5px] text-slate-700 leading-relaxed font-medium">${text}</div></div>`);

            setTimeout(() => { chatHistory.scrollTo({top: chatHistory.scrollHeight, behavior: 'smooth'}); window.appBot.updateScrollArrow(); }, 150);

        }

        function appendUserMessage(text) {

            chatHistory.insertAdjacentHTML('beforeend', `<div class="flex gap-2 w-[85%] self-end justify-end animate-message shrink-0"><div class="bg-premium-900 text-white rounded-2xl rounded-tr-sm p-3.5 shadow-sm text-[13.5px] leading-relaxed font-medium">${text}</div></div>`);

            setTimeout(() => { chatHistory.scrollTo({top: chatHistory.scrollHeight, behavior: 'smooth'}); window.appBot.updateScrollArrow(); }, 150);

        }

        function showTypingIndicator() {

            const typingId = 'typing-' + Date.now();

            chatHistory.insertAdjacentHTML('beforeend', `<div id="${typingId}" class="flex gap-2.5 w-[90%] animate-message shrink-0">${getBotAvatarHTML()}<div class="bg-white border border-slate-100 rounded-2xl rounded-tl-sm p-3.5 shadow-card flex items-center h-[42px]"><div class="typing-dots"><span></span><span></span><span></span></div></div></div>`);

            setTimeout(() => { chatHistory.scrollTo({top: chatHistory.scrollHeight, behavior: 'smooth'}); window.appBot.updateScrollArrow(); }, 150);

            return typingId;

        }

        function removeTypingIndicator(id) { const el = document.getElementById(id); if (el) el.remove(); }

        async function appendBotMessageWithTyping(text, delayMs = 1200) { const typingId = showTypingIndicator(); return new Promise(resolve => { setTimeout(() => { removeTypingIndicator(typingId); appendBotMessage(text); resolve(); }, delayMs); }); }

        function appendOptions(id, htmlStr) {

            chatHistory.insertAdjacentHTML('beforeend', `<div id="${id}" class="flex flex-col w-full animate-message mt-1 shrink-0">${htmlStr}</div>`);

            if (typeof lucide !== 'undefined' && lucide.createIcons) { lucide.createIcons(); }

            setTimeout(() => { chatHistory.scrollTo({top: chatHistory.scrollHeight, behavior: 'smooth'}); window.appBot.updateScrollArrow(); }, 150);

        }

        function genGridChips(name, options, selectedValue) { return `<div class="flex gap-1.5 w-full mb-2.5 flex-wrap">` + options.map(opt => `<label class="cursor-pointer flex-1 min-w-[45%]"><input type="radio" name="${name}" value="${opt}" class="chip-input sr-only" ${selectedValue === opt ? 'checked' : ''}><div class="chip-label flex items-center justify-center border border-slate-200 rounded-[10px] py-2.5 px-2 text-[12px] font-semibold text-slate-600 transition-colors bg-white shadow-sm h-full leading-tight text-center hover:border-premium-900/30">${opt}</div></label>`).join('') + `</div>`; }

        if (chatHistory) {

            chatHistory.addEventListener('scroll', () => window.appBot.updateScrollArrow());

        }

        // APP BOT FLOW EXPORTED TO WINDOW

        window.appBot = {

            currentFlow: null,

            updateScrollArrow: function() {

                const btn = document.getElementById('scroll-down-btn'); const history = document.getElementById('chat-history'); if (!btn || !history) return;

                if (history.scrollHeight > history.clientHeight && Math.ceil(history.scrollHeight - history.scrollTop) > history.clientHeight + 15) { btn.style.setProperty('display', 'flex', 'important'); } else { btn.style.setProperty('display', 'none', 'important'); }

            },

            goBack: function() {

                document.getElementById('hipaa-footer').style.display = ''; document.getElementById('chat-input-area').style.setProperty('display', 'none', 'important');

                chatView.classList.remove('opacity-100', 'translate-x-0'); chatView.classList.add('opacity-0', 'translate-x-full', 'pointer-events-none');

                bentoView.classList.remove('opacity-0', '-translate-x-10', 'pointer-events-none'); bentoView.classList.add('opacity-100', 'translate-x-0');

            },

            startFlow: async function(flowType) {

                document.getElementById('chat-input-area').style.setProperty('display', 'none', 'important'); document.getElementById('hipaa-footer').style.display = ''; document.getElementById('scroll-down-btn').style.setProperty('display', 'none', 'important');

                bentoView.classList.remove('opacity-100', 'translate-x-0'); bentoView.classList.add('opacity-0', '-translate-x-10', 'pointer-events-none');

                chatView.classList.remove('opacity-0', 'translate-x-full', 'pointer-events-none'); chatView.classList.add('opacity-100', 'translate-x-0');

                chatHistory.innerHTML = ''; stepIndicator.classList.remove('opacity-0');

                navBackBtn.classList.remove('opacity-0', 'pointer-events-none'); navBackBtn.setAttribute('onclick', 'window.appBot.goBack()');

                this.currentFlow = flowType;

                if (flowType === 'consult') await this.showConsultStep1();

                else if (flowType === 'special') await this.showConsultStep1();

                else if (flowType === 'candidate') await this.showCandidateStep1();

                else if (flowType === 'cost') await this.showCostFlow();

                else if (flowType === 'process') await this.showProcessFlow();

                else if (flowType === 'question') await this.showQuestionForm('General Question');

                else if (flowType === 'reviews') await this.showReviewsFlow();

            },

            showConsultStep1: async function() {

                chatHeaderTitle.innerText = "Hi, I'm Archie"; stepIndicator.innerText = "Step 1 of 4"; navBackBtn.setAttribute('onclick', 'window.appBot.goBack()');

                const intro = "Taking the first step towards a new smile is exciting! To help prepare for your free consultation, what are you hoping to restore?";

                await appendBotMessageWithTyping(intro, 1200); await wait(800); await appendBotMessageWithTyping("Preferred Location?", 800); await wait(400);

                const opts = ['Boca Raton', 'Tampa', 'Jacksonville', 'Virtual'];

                appendOptions('consult-opts-container-1', `<div class="flex gap-2 w-[90%] flex-wrap mb-2 pl-[38px]">${opts.map(opt => `<button type="button" onclick="window.appBot.handleConsultStep('location', '${opt}')" class="w-auto bg-white border border-premium-900/30 rounded-full py-1.5 px-4 text-[13px] font-medium text-premium-900 hover:bg-premium-50 transition-colors shadow-sm active:scale-95 text-center cursor-pointer">${opt}</button>`).join('')}</div>`);

            },

            handleConsultStep: async function(field, value) {

                window.implantBotState.consult[field] = value;

                const cid = field === 'location' ? 'consult-opts-container-1' : field === 'interest' ? 'consult-opts-container-2' : 'consult-opts-container-3';

                if(document.getElementById(cid)) document.getElementById(cid).remove();

                appendUserMessage(value); await wait(400);

                if (field === 'location') await this.showConsultStep2();

                else if (field === 'interest') await this.showConsultStep3();

                else if (field === 'best_time') await this.showConsultStep4();

            },

            showConsultStep2: async function() {

                stepIndicator.innerText = "Step 2 of 4"; navBackBtn.setAttribute('onclick', 'window.appBot.goBack()');

                await appendBotMessageWithTyping("What Are You Interested In?", 1000); await wait(600);

                const opts = ['Single Arch', 'Full Mouth', 'Not Sure Yet'];

                appendOptions('consult-opts-container-2', `<div class="flex gap-2 w-[90%] flex-wrap mb-2 pl-[38px]">${opts.map(opt => `<button type="button" onclick="window.appBot.handleConsultStep('interest', '${opt}')" class="w-auto bg-white border border-premium-900/30 rounded-full py-1.5 px-4 text-[13px] font-medium text-premium-900 hover:bg-premium-50 transition-colors shadow-sm active:scale-95 text-center cursor-pointer">${opt}</button>`).join('')}</div>`);

            },

            showConsultStep3: async function() {

                stepIndicator.innerText = "Step 3 of 4"; navBackBtn.setAttribute('onclick', 'window.appBot.goBack()');

                await appendBotMessageWithTyping("When is the Best Time to Reach You?", 1000); await wait(600);

                const opts = ['Morning', 'Afternoon', 'Evening', 'Anytime'];

                appendOptions('consult-opts-container-3', `<div class="flex gap-2 w-[90%] flex-wrap mb-2 pl-[38px]">${opts.map(opt => `<button type="button" onclick="window.appBot.handleConsultStep('best_time', '${opt}')" class="w-auto bg-white border border-premium-900/30 rounded-full py-1.5 px-4 text-[13px] font-medium text-premium-900 hover:bg-premium-50 transition-colors shadow-sm active:scale-95 text-center cursor-pointer">${opt}</button>`).join('')}</div>`);

            },

            showConsultStep4: async function() {

                stepIndicator.innerText = "Step 4 of 4"; navBackBtn.setAttribute('onclick', 'window.appBot.goBack()');

                await appendBotMessageWithTyping("Perfect. Tell us how to reach you and our team will contact you to confirm your consultation time.", 1200); await wait(800);

                chatHistory.insertAdjacentHTML('beforeend', `<div class="flex flex-col items-center w-full animate-message mt-3 shrink-0" id="consult-form-4"><form onsubmit="event.preventDefault(); window.appBot.submitConsult(this);" class="w-full bg-white border border-slate-100 p-4 rounded-2xl shadow-card m-0"><input type="text" name="name" placeholder="Full Name" required class="chat-input-field" value="${savedName || ''}"/><input type="tel" name="phone" placeholder="Phone Number" required class="chat-input-field"/><input type="email" name="email" placeholder="Email Address" required class="chat-input-field !mb-2"/><div class="text-[10.5px] text-slate-500 text-center leading-tight mb-4 mt-2">By submitting this form, you consent to receive text messages and promotional offers. Msg & data rates may apply.</div><button type="submit" class="w-full bg-premium-900 text-white font-bold py-3.5 rounded-xl hover:bg-premium-800 transition-colors active:scale-95 border-none outline-none focus:outline-none cursor-pointer m-0" style="border: none !important;">Check My Eligibility</button></form></div>`);

                if (typeof lucide !== 'undefined' && lucide.createIcons) { lucide.createIcons(); }

                this.updateScrollArrow();

                setTimeout(() => { const hist = document.getElementById('chat-history'); if(hist) { hist.scrollTo({top: hist.scrollHeight, behavior: 'smooth'}); window.appBot.updateScrollArrow(); } }, 1500);

            },

            showCandidateStep1: async function() {

                chatHeaderTitle.innerText = "Am I a Candidate?"; stepIndicator.innerText = "Step 1 of 2"; navBackBtn.setAttribute('onclick', 'window.appBot.goBack()');

                await appendBotMessageWithTyping("Let's see if this one-week smile option is right for you. First, what are you currently dealing with?", 1200); await wait(800);

                const s = window.implantBotState.candidate;

                chatHistory.insertAdjacentHTML('beforeend', `<div class="flex flex-col items-center w-full animate-message mt-3 shrink-0" id="candidate-form-1"><form onsubmit="event.preventDefault(); window.appBot.validateCandidateStep1();" class="w-full bg-white border border-slate-100 p-4 rounded-2xl shadow-card m-0"><label class="block text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2 ml-1">Current Dental State</label>${genGridChips('current_state', ['Missing or Failing Teeth', 'I wear Dentures', 'Painful Natural Teeth'], s.current_state)}<label class="block text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2 ml-1 mt-2">When do you want to restore your smile?</label>${genGridChips('timeframe', ['ASAP', 'Within 3 Months', 'Just researching'], s.timeframe)}<div id="candidate-step1-error" style="display: none;" class="bg-red-50 text-red-600 p-3 rounded-lg text-[12px] font-semibold mb-3 border border-red-100">Please answer both questions to continue.</div><button type="submit" class="w-full bg-premium-900 text-white font-bold py-3.5 rounded-xl hover:bg-premium-800 transition-colors active:scale-95 border-none outline-none focus:outline-none cursor-pointer m-0" style="border: none !important;">Continue</button></form></div>`);

                if (typeof lucide !== 'undefined' && lucide.createIcons) { lucide.createIcons(); }

                this.updateScrollArrow();

                setTimeout(() => { const hist = document.getElementById('chat-history'); if(hist) { hist.scrollTo({top: hist.scrollHeight, behavior: 'smooth'}); window.appBot.updateScrollArrow(); } }, 1500);

            },

            validateCandidateStep1: async function() {

                const fd = new FormData(document.querySelector('#candidate-form-1 form')); const s = window.implantBotState.candidate;

                s.current_state = fd.get('current_state'); s.timeframe = fd.get('timeframe');

                if (!s.current_state || !s.timeframe) { document.getElementById('candidate-step1-error').style.display = 'block'; return; }

                document.getElementById('candidate-form-1').remove(); appendUserMessage(`${s.current_state}<br>${s.timeframe}`); await wait(400);

                stepIndicator.innerText = "Step 2 of 2"; navBackBtn.setAttribute('onclick', 'window.appBot.showCandidateStep1()');

                await appendBotMessageWithTyping("Thanks for sharing. Our team can review your answers and talk through whether Done In One may be right for you. How can we reach you?", 1500); await wait(800);

                chatHistory.insertAdjacentHTML('beforeend', `<div class="flex flex-col items-center w-full animate-message mt-3 shrink-0" id="candidate-form-2"><form onsubmit="event.preventDefault(); window.appBot.submitCandidate(this);" class="w-full bg-white border border-slate-100 p-4 rounded-2xl shadow-card m-0"><input type="text" name="name" placeholder="Full Name" required class="chat-input-field" value="${savedName || ''}"/><input type="tel" name="phone" placeholder="Phone Number" required class="chat-input-field"/><input type="email" name="email" placeholder="Email Address" required class="chat-input-field !mb-2"/><button type="submit" class="w-full bg-accent-500 text-premium-900 font-bold py-3.5 rounded-xl hover:bg-accent-400 transition-colors active:scale-95 mt-2 border-none outline-none focus:outline-none cursor-pointer m-0" style="border: none !important;">Request a Follow-Up</button></form></div>`);

                if (typeof lucide !== 'undefined' && lucide.createIcons) { lucide.createIcons(); }

                this.updateScrollArrow();

                setTimeout(() => { const hist = document.getElementById('chat-history'); if(hist) { hist.scrollTo({top: hist.scrollHeight, behavior: 'smooth'}); window.appBot.updateScrollArrow(); } }, 1500);

            },

            showCostFlow: async function() {

                chatHeaderTitle.innerText = "Pricing & Financing"; stepIndicator.classList.add('opacity-0');

                await appendBotMessageWithTyping("The cost of treatment depends on your needs. Our team can explain your options and provide a personalized estimate during a free consultation.", 1200);

                chatHistory.insertAdjacentHTML('beforeend', `<div class="bg-white border border-slate-100 shadow-card rounded-2xl p-4 text-[13.5px] text-slate-700 leading-relaxed font-medium animate-message w-[90%] flex flex-col gap-3 shrink-0 mt-2 m-0"><div><strong class="text-premium-900 block text-[15px] mb-1">Single Arch or Full Mouth</strong>Our team will explain the treatment options that fit your needs.</div><div class="border-t border-slate-100 pt-3"><strong class="text-premium-900 block text-[15px] mb-1">Pricing &amp; Financing</strong>You'll receive a personalized estimate and can ask about available financing options.</div></div>`);

                await wait(1500); await appendBotMessageWithTyping("Would you like to schedule a free consultation to discuss your options?", 1000); await wait(600);

                appendOptions('cost-opts', `<button type="button" onclick="window.appBot.startFlow('consult')" class="w-full bg-accent-500 text-premium-900 border border-accent-600/30 hover:bg-accent-600 px-4 py-3.5 rounded-[12px] text-[13.5px] font-bold transition-all shadow-md mb-2.5 active:scale-95 flex items-center justify-center gap-2 drop-shadow-sm outline-none focus:outline-none cursor-pointer m-0" style="border: none !important;">Schedule Free Consult</button>`);

            },

            showProcessFlow: async function() {

                chatHeaderTitle.innerText = "The 1-Week Process"; stepIndicator.classList.add('opacity-0');

                await appendBotMessageWithTyping("Most full-mouth journeys take months of waiting. Done In One® simplifies this so you get permanent zirconia teeth in about one week.", 1500);

                chatHistory.insertAdjacentHTML('beforeend', `<div class="bg-white border border-slate-100 shadow-card rounded-2xl p-4 text-[13px] text-slate-700 leading-relaxed font-medium animate-message mt-2 w-[90%] flex flex-col gap-3 shrink-0 m-0"><div><strong class="text-premium-900">1. Custom Smile Preview:</strong> See your new smile before final teeth are made.</div><div><strong class="text-premium-900">2. Implant Placement:</strong> Strong, stable foundation placed by specialists.</div><div><strong class="text-premium-900">3. Final Zirconia Teeth:</strong> Placed in about a week. Smile, eat, and speak with confidence!</div></div>`);

                await wait(1500); await appendBotMessageWithTyping("Would you like to schedule a free consult to see what your Custom Smile Preview would look like?", 1200); await wait(600);

                appendOptions('process-opts', `<button type="button" onclick="window.appBot.startFlow('consult')" class="w-full bg-accent-500 text-premium-900 border border-accent-600/30 hover:bg-accent-600 px-4 py-3.5 rounded-[12px] text-[13.5px] font-bold transition-all shadow-md mb-2.5 active:scale-95 flex items-center justify-center gap-2 drop-shadow-sm outline-none focus:outline-none cursor-pointer m-0" style="border: none !important;">Yes, schedule free consult</button>`);

            },

            showQuestionForm: async function(type) {

                chatHeaderTitle.innerText = "Live Chat"; stepIndicator.classList.add('opacity-0');

                document.getElementById('hipaa-footer').style.display = 'none'; document.getElementById('chat-input-area').style.setProperty('display', 'flex', 'important');

                await appendBotMessageWithTyping("Hi there! I'm Archie, the AI assistant for Done In One®. What questions can I answer for you today?", 1200);

                setTimeout(() => document.getElementById('live-chat-input').focus(), 100);

            },

            handleChatSend: async function() {

                const inputEl = document.getElementById('live-chat-input'); const submitBtn = document.getElementById('live-chat-submit');

                const message = inputEl.value.trim(); if (!message) return;

                inputEl.value = ''; submitBtn.disabled = true; inputEl.disabled = true; appendUserMessage(message); const typingId = showTypingIndicator();

                try {

                    const controller = new AbortController(); const timeoutId = setTimeout(() => controller.abort(), 15000); 

                    const attribution = await collectSubmissionAttribution();
                    const sentAt = new Date().toISOString();
                    const questionPayload = {
                        message, name: storage.getItem('implantBotName') || '', phone: '', email: '',
                        visitorId: getChatVisitorId(), sessionId: getChatSessionId(),
                        eventId: createTrackingId('question'), formId: 'doi-ask-question-v1',
                        source: 'Website Chatbot - Ask a Question', ...attribution,
                        userAgent: navigator.userAgent || '', timestamp: sentAt,
                        last_chatbot_contact: sentAt
                    };
                    const res = await fetch(N8N_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(questionPayload), signal: controller.signal });

                    clearTimeout(timeoutId); if (!res.ok) throw new Error('Network error');

                    const data = await res.json(); removeTypingIndicator(typingId);

                    if (data.reply) { appendBotMessage(data.reply.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-premium-900">$1</strong>')); } else { appendBotMessage("Sorry, I didn't get a valid response. Could you try again?"); }

                } catch (error) { removeTypingIndicator(typingId); console.error(error); appendBotMessage("Something went wrong, please try again.");

                } finally { submitBtn.disabled = false; inputEl.disabled = false; inputEl.focus(); if (typeof lucide !== 'undefined' && lucide.createIcons) { lucide.createIcons(); } }

            },

            showReviewsFlow: async function() {

                chatHeaderTitle.innerText = "Patient Reviews"; stepIndicator.classList.add('opacity-0');

                await appendBotMessageWithTyping("We are rated 'Excellent' with over 270+ patient reviews! Here is what people are saying:", 1200);

                const rData = [

                    { name: "Heather F.", loc: "Georgetown, KY", img: "https://assets.cdn.filesafe.space/QxqsOC7AbRmImFQOw9qw/media/6a0f674e3c3b60d82318c50e.png", title: "So Comforting!", text: "Ok, I’m not a fan of posting selfies... <mark class='bg-accent-500/40 text-premium-900 font-bold px-1 rounded'>I can’t say enough great things</mark> about the entire staff!" },

                    { name: "Scott C.", loc: "Trinity, FL", img: "https://assets.cdn.filesafe.space/QxqsOC7AbRmImFQOw9qw/media/6a0f674eca9579c76bbf5e6e.png", title: "Beyond Amazing", text: "The professionalism and compassion displayed... <mark class='bg-accent-500/40 text-premium-900 font-bold px-1 rounded'>I almost felt those guys had become extended family.</mark>" },

                    { name: "Pat C.", loc: "West Palm Beach, FL", img: "https://assets.cdn.filesafe.space/QxqsOC7AbRmImFQOw9qw/media/6a0f674e2bd282d082094b5e.png", title: "Exceeded My Expectations", text: "They go above and beyond... <mark class='bg-accent-500/40 text-premium-900 font-bold px-1 rounded'>DOI changed my life.</mark>" }

                ];

                let html = `<div class="relative w-[calc(100%+2.5rem)] -ml-5 px-5 mt-2 shrink-0 group m-0"><div id="reviews-scroll-wrapper" class="flex overflow-x-auto gap-3 pb-4 pt-1 snap-x snap-mandatory hide-scrollbar">`;

                rData.forEach(r => { html += `<div class="snap-center shrink-0 w-[240px] bg-white border border-slate-100 shadow-card rounded-2xl overflow-hidden flex flex-col shrink-0 m-0"><div class="h-[160px] w-full relative bg-slate-50 border-b border-slate-100"><img src="${r.img}" class="w-full h-full object-cover"><div class="absolute top-2 right-2 bg-white rounded-full p-1.5 shadow-sm flex items-center justify-center"><img src="https://assets.cdn.filesafe.space/JgT9MnHD2uRc3SVtON2k/media/6a04dafb06993a27a31cbf85.png" class="w-3.5 h-3.5 object-contain"></div></div><div class="p-4 flex flex-col gap-2 flex-1 m-0"><h4 class="font-extrabold text-premium-900 text-[14px] leading-tight m-0">"${r.title}"</h4><p class="text-[12px] text-slate-600 leading-relaxed italic flex-1 m-0">"${r.text}"</p><div class="mt-auto pt-2 border-t border-slate-50 m-0"><span class="block font-bold text-premium-900 text-[12px] m-0">${r.name}</span><span class="block text-slate-400 text-[10.5px] m-0">${r.loc}</span></div></div></div>`; });

                html += `</div></div>`;

                chatHistory.insertAdjacentHTML('beforeend', html); await wait(1500);

                appendOptions('review-opts', `<button type="button" onclick="window.appBot.startFlow('consult')" class="w-full bg-accent-500 text-premium-900 border border-accent-600/30 hover:bg-accent-600 px-4 py-3.5 rounded-[12px] text-[13.5px] font-bold transition-all shadow-md mb-2.5 active:scale-95 flex items-center justify-center gap-2 drop-shadow-sm outline-none focus:outline-none cursor-pointer m-0" style="border: none !important;">Schedule Free Consult</button>`);

            },

            getBasePayload: function(type) {

                return { request_type: type, source: 'Website Chatbot - Dental Implants', name: '', phone: '', email: '', interest: '', location: '', best_time: '', current_state: '', timeframe: '', message: '', visitorId: getChatVisitorId(), sessionId: getChatSessionId(), formId: (type.includes('Candidate') ? 'doi-candidate-quiz-v1' : 'doi-consult-request-v1'), submissionId: createTrackingId('submission'), pageUrl: hostContext.pageUrl, pageTitle: hostContext.pageTitle, referrer: hostContext.referrer, userAgent: navigator.userAgent || '', timestamp: new Date().toISOString() };

            },

            submitConsult: async function(form) {

                if (!form.reportValidity()) return;

                const fd = new FormData(form); const state = window.implantBotState.consult; const payload = this.getBasePayload('Consultation Request');

                payload.interest = state.interest; payload.location = state.location; payload.best_time = state.best_time; payload.name = fd.get('name') || ''; payload.phone = fd.get('phone') || ''; payload.email = String(fd.get('email') || '').trim();

                if (payload.name) storage.setItem('implantBotName', payload.name); form.parentElement.remove(); appendUserMessage(`${payload.name} • ${payload.phone}`); await this.processSubmission(payload, 'Consultation Request');

            },

            submitCandidate: async function(form) {

                if (!form.reportValidity()) return;

                const fd = new FormData(form); const state = window.implantBotState.candidate; const payload = this.getBasePayload('Candidate Quiz Lead');

                payload.current_state = state.current_state; payload.timeframe = state.timeframe; payload.name = fd.get('name') || ''; payload.phone = fd.get('phone') || ''; payload.email = String(fd.get('email') || '').trim();

                if (payload.name) storage.setItem('implantBotName', payload.name); document.getElementById('candidate-form-2').remove(); appendUserMessage(`${payload.name} • ${payload.phone}`); await this.processSubmission(payload, 'Candidate Quiz');

            },

            processSubmission: async function(payload, type) {

                stepIndicator.innerText = "Sending..."; navBackBtn.classList.add('opacity-0', 'pointer-events-none');

                try {

                    const attribution = await collectSubmissionAttribution();
                    const sentAt = new Date().toISOString();
                    Object.assign(payload, attribution, {
                        fullName: payload.name || '', phoneNumber: payload.phone || '', emailAddress: payload.email || '',
                        treatmentInterest: payload.interest || '', treatment_interest: payload.interest || '',
                        preferredOffice: payload.location || '', preferred_office: mapPreferredOffice(payload.location),
                        bestTimeToContact: payload.best_time || '', best_time_to_contact: payload.best_time || '',
                        timestamp: sentAt, last_chatbot_contact: sentAt
                    });
                    const response = await fetch(WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });

                    if (!response.ok) throw new Error('Network error'); stepIndicator.innerText = "Done"; this.showConfirmation(type);

                } catch (e) { console.error(e); stepIndicator.innerText = "Error"; appendBotMessage("Sorry, there was an error submitting your request. Please call our clinic directly."); }

            },

            showConfirmation: function(type) {

                setTimeout(() => {

                    let confirmText = "We received your request and just sent a text message to the phone number you provided. Please check your texts for the next steps!";

                    if (type === 'question') confirmText = "We received your message and sent a text to confirm. Our implant coordinator will review your question and follow up shortly.";

                    chatHistory.insertAdjacentHTML('beforeend', `<div class="flex gap-2.5 w-[95%] animate-message shrink-0 m-0">${getBotAvatarHTML()}<div class="bg-white border border-slate-100 rounded-2xl rounded-tl-sm p-5 shadow-card w-full m-0"><div class="flex items-center gap-3 mb-3 m-0"><div class="bg-accent-500/20 text-premium-900 p-2 rounded-full m-0"><i data-lucide="check" class="w-4 h-4"></i></div><h4 class="font-bold text-premium-900 text-[15px] m-0">Success!</h4></div><p class="text-[13px] text-slate-600 leading-relaxed font-medium mb-4 m-0">${confirmText}</p><button type="button" onclick="window.appBot.goBack()" class="w-full bg-slate-100 text-slate-700 font-bold py-3 rounded-xl hover:bg-slate-200 transition-colors text-[13px] border-none outline-none focus:outline-none cursor-pointer m-0" style="border: none !important;">Back to Main Menu</button></div></div>`);

                    window.implantBotState = { consult: { interest: '', location: '', best_time: '' }, candidate: { current_state: '', timeframe: '' } };

                    if (typeof lucide !== 'undefined' && lucide.createIcons) { lucide.createIcons(); }

                    setTimeout(() => {chatHistory.scrollTo({top: chatHistory.scrollHeight, behavior: 'smooth'}); window.appBot.updateScrollArrow();}, 50);

                }, 500);

            }

        };

    } // End Init function

    // Safe execution loop: Wait for Document to finish loading before starting

    if (document.readyState === 'loading') {

        document.addEventListener('DOMContentLoaded', initArchieWidget);

    } else {

        initArchieWidget();

    }

})();