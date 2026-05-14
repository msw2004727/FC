/* ================================================
   SportHub Team: Contact Link Helpers
   Reuses the activity social-link visual language for club contact buttons.
   ================================================ */

Object.assign(App, {

  _teamContactLinksMax: 5,
  _teamContactLinksDraft: [],

  _getTeamContactLinksNodes() {
    return {
      toggle: document.getElementById('ct-contact-links-enabled'),
      label: document.getElementById('ct-contact-links-label'),
      options: document.getElementById('ct-contact-links-options'),
      list: document.getElementById('ct-contact-links-list'),
      add: document.getElementById('ct-contact-links-add'),
    };
  },

  _normalizeTeamContactUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      const url = new URL(withProtocol);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
      url.hash = '';
      return url.href;
    } catch (_) {
      return '';
    }
  },

  _detectTeamContactPlatform(value) {
    const normalized = this._normalizeTeamContactUrl?.(value) || '';
    let host = '';
    try {
      host = normalized ? new URL(normalized).hostname.toLowerCase().replace(/^www\./, '') : '';
    } catch (_) {}
    const matches = (...domains) => domains.some(domain => host === domain || host.endsWith(`.${domain}`));
    if (matches('line.me', 'lin.ee')) return { key: 'line', label: 'LINE', icon: 'LINE', host };
    if (matches('facebook.com', 'fb.com', 'messenger.com', 'm.me')) return { key: 'facebook', label: 'Facebook', icon: 'f', host };
    if (matches('instagram.com')) return { key: 'instagram', label: 'Instagram', icon: 'IG', host };
    if (matches('threads.net', 'threads.com')) return { key: 'threads', label: 'Threads', icon: '@', host };
    if (matches('x.com', 'twitter.com')) return { key: 'x', label: 'X', icon: 'X', host };
    if (matches('youtube.com', 'youtu.be')) return { key: 'youtube', label: 'YouTube', icon: 'YT', host };
    if (matches('tiktok.com')) return { key: 'tiktok', label: 'TikTok', icon: 'T', host };
    if (matches('discord.gg', 'discord.com')) return { key: 'discord', label: 'Discord', icon: 'D', host };
    if (matches('telegram.org', 'telegram.me', 't.me')) return { key: 'telegram', label: 'Telegram', icon: 'TG', host };
    if (matches('linktr.ee', 'linktree.com')) return { key: 'linktree', label: 'Linktree', icon: 'LT', host };
    return { key: 'link', label: host || '\u9023\u7d50', icon: '\u2197', host };
  },

  _normalizeTeamContactLinks(value) {
    const list = Array.isArray(value) ? value : [];
    const seen = new Set();
    const normalized = [];
    list.forEach(item => {
      const rawUrl = typeof item === 'string'
        ? item
        : (item?.url || item?.href || item?.link || '');
      const url = this._normalizeTeamContactUrl?.(rawUrl) || '';
      if (!url || seen.has(url)) return;
      seen.add(url);
      const meta = this._detectTeamContactPlatform?.(url) || { key: 'link', label: '\u9023\u7d50', host: '' };
      const rawLabel = typeof item === 'object' && item ? String(item.label || '').trim() : '';
      normalized.push({
        url,
        platform: meta.key,
        label: rawLabel || meta.label,
        host: meta.host || '',
      });
    });
    return normalized.slice(0, this._teamContactLinksMax || 5);
  },

  _renderTeamContactIcon(link) {
    const meta = this._detectTeamContactPlatform?.(link?.url || '') || { key: 'link', label: '\u9023\u7d50', icon: '\u2197' };
    const iconClass = `event-social-link-icon event-social-link-icon-${escapeHTML(meta.key)}`;
    const imageIcons = {
      instagram: 'img/Instagram-Logo--Streamline-Plump-Gradient.png',
      threads: 'img/Thread-Block-Logo--Streamline-Ultimate.png',
    };
    if (imageIcons[meta.key]) {
      return `<span class="${iconClass}" aria-hidden="true"><img src="${escapeHTML(imageIcons[meta.key])}" alt=""></span>`;
    }
    return `<span class="${iconClass}" aria-hidden="true">${escapeHTML(meta.icon)}</span>`;
  },

  _renderTeamContactLinksHtml(links) {
    const normalized = this._normalizeTeamContactLinks?.(links) || [];
    if (!normalized.length) return '';
    return normalized.map(link => {
      const meta = this._detectTeamContactPlatform?.(link.url) || { key: link.platform || 'link', label: link.label || '\u9023\u7d50' };
      const label = link.label || meta.label || '\u9023\u7d50';
      return `<a class="event-social-link-btn" data-platform="${escapeHTML(meta.key)}" href="${escapeHTML(link.url)}" target="sporthub_social" rel="noopener noreferrer" aria-label="${escapeHTML(label)}" title="${escapeHTML(label)}">${this._renderTeamContactIcon(link)}</a>`;
    }).join('');
  },

  _renderTeamContactLinksFormRows() {
    const nodes = this._getTeamContactLinksNodes();
    if (!nodes.list) return;
    const draft = Array.isArray(this._teamContactLinksDraft) ? this._teamContactLinksDraft : [];
    const rows = draft.length ? draft : [{ url: '' }];
    nodes.list.innerHTML = rows.map((item, index) => {
      const value = typeof item === 'string' ? item : (item?.url || '');
      const normalized = this._normalizeTeamContactUrl?.(value) || '';
      const normalizedLink = normalized ? (this._normalizeTeamContactLinks?.([{ url: normalized }]) || [])[0] : null;
      const preview = normalizedLink
        ? `${this._renderTeamContactIcon(normalizedLink)}<span>${escapeHTML(normalizedLink.label)}</span>`
        : '<span class="ce-social-link-empty">\u5c1a\u672a\u8fa8\u8b58</span>';
      const removeDisabled = rows.length <= 1 ? 'disabled' : '';
      return `
        <div class="ce-social-link-row" data-index="${index}">
          <input type="url" class="ce-social-link-input" value="${escapeHTML(value)}" placeholder="\u8cbc\u4e0a\u793e\u7fa4\u7db2\u5740\uff0c\u4f8b\u5982 https://line.me/...">
          <span class="ce-social-link-preview">${preview}</span>
          <button type="button" class="ce-social-link-remove" ${removeDisabled} onclick="App._removeTeamContactLinkInput(${index})">\u522a\u9664</button>
        </div>`;
    }).join('');
    nodes.list.querySelectorAll('.ce-social-link-input').forEach((input, index) => {
      if (input.dataset.bound === '1') return;
      input.dataset.bound = '1';
      input.addEventListener('input', () => {
        this._teamContactLinksDraft[index] = { url: input.value };
      });
      input.addEventListener('blur', () => {
        this._teamContactLinksDraft[index] = { url: input.value };
        this._renderTeamContactLinksFormRows();
      });
    });
    if (nodes.add) nodes.add.disabled = rows.length >= (this._teamContactLinksMax || 5);
  },

  _updateTeamContactLinksUI() {
    const nodes = this._getTeamContactLinksNodes();
    if (!nodes.toggle || !nodes.options) return;
    const enabled = !!nodes.toggle.checked;
    if (nodes.label) {
      nodes.label.textContent = enabled ? '\u958b\u555f' : '\u95dc\u9589';
      nodes.label.style.color = enabled ? 'var(--accent)' : 'var(--text-muted)';
    }
    nodes.options.style.display = enabled ? '' : 'none';
    if (enabled) {
      if (!Array.isArray(this._teamContactLinksDraft) || this._teamContactLinksDraft.length === 0) {
        this._teamContactLinksDraft = [{ url: '' }];
      }
      this._renderTeamContactLinksFormRows();
    }
  },

  _addTeamContactLinkInput() {
    const max = this._teamContactLinksMax || 5;
    const draft = Array.isArray(this._teamContactLinksDraft) ? this._teamContactLinksDraft : [];
    if (draft.length >= max) {
      this.showToast?.(`\u806f\u7e6b\u9023\u7d50\u6700\u591a ${max} \u500b`);
      return;
    }
    this._teamContactLinksDraft = [...draft, { url: '' }];
    this._updateTeamContactLinksUI();
  },

  _removeTeamContactLinkInput(index) {
    const draft = Array.isArray(this._teamContactLinksDraft) ? this._teamContactLinksDraft : [];
    if (draft.length <= 1) return;
    this._teamContactLinksDraft = draft.filter((_, i) => i !== index);
    this._updateTeamContactLinksUI();
  },

  _getTeamContactLinksFormData(options = {}) {
    const validate = !!options.validate;
    const nodes = this._getTeamContactLinksNodes();
    const enabled = !!nodes.toggle?.checked;
    if (!enabled) return { enabled: false, links: [] };
    const draft = Array.isArray(this._teamContactLinksDraft) ? this._teamContactLinksDraft : [];
    const rawValues = draft
      .map(item => typeof item === 'string' ? item : (item?.url || ''))
      .map(value => String(value || '').trim());
    const nonEmpty = rawValues.filter(Boolean);
    const invalid = nonEmpty.find(value => !this._normalizeTeamContactUrl?.(value));
    if (validate && nonEmpty.length === 0) {
      return { enabled: true, links: [], error: '\u5df2\u958b\u555f\u806f\u7e6b\u6309\u9215\uff0c\u8acb\u81f3\u5c11\u586b\u4e00\u500b\u9023\u7d50' };
    }
    if (validate && invalid) {
      return { enabled: true, links: [], error: '\u806f\u7e6b\u9023\u7d50\u683c\u5f0f\u4e0d\u6b63\u78ba\uff0c\u8acb\u4ee5 https:// \u958b\u982d\u6216\u8f38\u5165\u6709\u6548\u7db2\u5740' };
    }
    const links = this._normalizeTeamContactLinks?.(nonEmpty.map(url => ({ url }))) || [];
    return { enabled: links.length > 0, links };
  },

  _setTeamContactLinksFormData(enabled, links = []) {
    const nodes = this._getTeamContactLinksNodes();
    const normalized = this._normalizeTeamContactLinks?.(links) || [];
    this._teamContactLinksDraft = normalized.length ? normalized.map(link => ({ url: link.url })) : [];
    if (nodes.toggle) nodes.toggle.checked = !!enabled && normalized.length > 0;
    if (!!enabled && normalized.length === 0) this._teamContactLinksDraft = [{ url: '' }];
    this._updateTeamContactLinksUI();
  },

  bindTeamContactLinksToggle() {
    const nodes = this._getTeamContactLinksNodes();
    if (nodes.toggle && nodes.toggle.dataset.bound !== '1') {
      nodes.toggle.dataset.bound = '1';
      nodes.toggle.addEventListener('change', () => this._updateTeamContactLinksUI());
    }
    if (nodes.add && nodes.add.dataset.bound !== '1') {
      nodes.add.dataset.bound = '1';
      nodes.add.addEventListener('click', () => this._addTeamContactLinkInput());
    }
    this._updateTeamContactLinksUI();
  },

});
