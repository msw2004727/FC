/* ================================================
   SportHub - Event: Create/Edit UI Contract
   ================================================ */

(function () {
  const REQUIRED_DOM_IDS = [
    'create-event-modal',
    'ce-modal-title',
    'ce-title',
    'ce-type',
    'ce-location',
    'ce-date',
    'ce-time-start',
    'ce-time-end',
    'ce-reg-open-enabled',
    'ce-fee-enabled',
    'ce-fee',
    'ce-team-only',
    'ce-team-select',
    'ce-gender-restriction-enabled',
    'ce-allowed-gender',
    'ce-private-event',
    'ce-team-split-enabled',
    'ce-social-links-enabled',
    'ce-early-bird-enabled',
    'ce-gps-enabled',
    'ce-max',
    'ce-waitlist',
    'ce-min-age',
    'ce-notes',
    'ce-sport-tag',
    'ce-delegate-search',
    'ce-upload-preview',
    'ce-submit-btn',
  ];

  const PAYLOAD_KEYS = [
    'title',
    'type',
    'location',
    'date',
    'startTimestamp',
    'endTimestamp',
    'max',
    'minAge',
    'notes',
    'sportTag',
    'regOpenTime',
    'feeEnabled',
    'fee',
    'genderRestrictionEnabled',
    'allowedGender',
    'privateEvent',
    'teamOnly',
    'isPublic',
    'creatorTeamId',
    'creatorTeamName',
    'creatorTeamIds',
    'creatorTeamNames',
    'delegates',
    'delegateUids',
    'teamSplit',
    'socialLinksEnabled',
    'socialLinks',
    'earlyBirdEnabled',
    'earlyBirdCost',
    'earlyBirdPolicyVersion',
    'regionEnabled',
    'region',
    'cities',
    'gpsEnabled',
    'lat',
    'lng',
    'mapAddress',
    'mapPlaceId',
    'mapProvider',
    'mapLocationConfirmed',
    'mapLocationUpdatedAt',
    'image',
    'imageVariants',
  ];

  function htmlEscape(value) {
    if (typeof escapeHTML === 'function') return escapeHTML(value);
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toText(value) {
    return String(value == null ? '' : value).trim();
  }

  function sanitizeRenderableUrl(value) {
    const raw = toText(value);
    if (!raw) return '';
    if (/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(raw)) return raw;
    if (/^blob:/i.test(raw)) return raw;
    if (/^https?:\/\//i.test(raw)) return raw;
    if (/^(?:\.{0,2}\/)?[A-Za-z0-9_./%#?=&:+-]+$/i.test(raw) && !/javascript:/i.test(raw)) return raw;
    return '';
  }

  Object.assign(App, {
    _CREATE_EVENT_REQUIRED_DOM_IDS: REQUIRED_DOM_IDS,
    _CREATE_EVENT_PAYLOAD_KEYS: PAYLOAD_KEYS,

    _isActivityCreateUiV2Enabled() {
      if (typeof isActivityCreateUiV2Enabled === 'function') return !!isActivityCreateUiV2Enabled();
      return true;
    },

    _getCreateEventDomContract(root = document) {
      const missing = REQUIRED_DOM_IDS.filter(id => !root?.getElementById?.(id));
      return { ok: missing.length === 0, missing, ids: [...REQUIRED_DOM_IDS] };
    },

    _getCreateEventPayloadContractKeys() {
      return [...PAYLOAD_KEYS];
    },

    _sanitizeRenderableUrl(value) {
      return sanitizeRenderableUrl(value);
    },

    _renderSafeImageTag(src, options = {}) {
      const safeSrc = sanitizeRenderableUrl(src);
      if (!safeSrc) return '';
      const className = toText(options.className);
      const alt = htmlEscape(options.alt || '');
      const style = toText(options.style);
      const attrs = [];
      if (className) attrs.push(`class="${htmlEscape(className)}"`);
      if (style) attrs.push(`style="${htmlEscape(style)}"`);
      if (options.loading !== false) attrs.push('loading="lazy"');
      if (options.decoding !== false) attrs.push('decoding="async"');
      if (options.referrerPolicy) attrs.push(`referrerpolicy="${htmlEscape(options.referrerPolicy)}"`);
      return `<img src="${htmlEscape(safeSrc)}" alt="${alt}" ${attrs.join(' ')}>`;
    },

    _pickCreateEventPayload(source = {}, allowedKeys = PAYLOAD_KEYS) {
      const payload = {};
      allowedKeys.forEach(key => {
        if (Object.prototype.hasOwnProperty.call(source, key)) payload[key] = source[key];
      });
      return payload;
    },
  });
})();
