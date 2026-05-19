/* ================================================
   SportHub — Identity Resolver
   Single source for current display identity.
   ================================================ */

const IdentityResolver = {
  MAIN_IDENTITY_ID: 'main',
  SECONDARY_IDENTITY_ID: 'secondary',

  _privateMessageSurfaces: new Set(['pm', 'privateMessage', 'private-message']),

  _trim(value) {
    return String(value || '').trim();
  },

  _isValidIdentityId(identityId) {
    return identityId === this.MAIN_IDENTITY_ID || identityId === this.SECONDARY_IDENTITY_ID;
  },

  _canUseSecondaryIdentity(options = {}) {
    return options.allowSecondaryIdentity !== false;
  },

  getSettings() {
    try {
      return FirebaseService?._cache?.currentUserIdentitySettings || null;
    } catch (_) {
      return null;
    }
  },

  normalizeSettings(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const activeId = this._isValidIdentityId(raw.profileActiveIdentityId)
      ? raw.profileActiveIdentityId
      : this.MAIN_IDENTITY_ID;
    const secondaryRaw = raw.identities && typeof raw.identities === 'object'
      ? raw.identities.secondary
      : null;
    const secondary = secondaryRaw && typeof secondaryRaw === 'object' && !Array.isArray(secondaryRaw)
      ? {
        identityId: this.SECONDARY_IDENTITY_ID,
        enabled: secondaryRaw.enabled === true,
        displayName: this._trim(secondaryRaw.displayName).slice(0, 40),
        avatarUrl: this._trim(secondaryRaw.avatarUrl),
        avatarStoragePath: this._trim(secondaryRaw.avatarStoragePath),
        avatarStorageBucket: this._trim(secondaryRaw.avatarStorageBucket),
        displayRoleLabel: this._trim(secondaryRaw.displayRoleLabel).slice(0, 40),
        isPrimary: false,
        editable: secondaryRaw.editable !== false,
        updatedAt: secondaryRaw.updatedAt || null,
      }
      : null;

    return {
      _docId: raw._docId || 'settings',
      profileActiveIdentityId: activeId,
      identities: { secondary },
      updatedAt: raw.updatedAt || null,
      createdAt: raw.createdAt || null,
    };
  },

  isSecondaryEnabled(settings = this.getSettings()) {
    const normalized = this.normalizeSettings(settings);
    const secondary = normalized?.identities?.secondary || null;
    return !!(secondary && secondary.enabled === true && secondary.displayName);
  },

  getActiveIdentityId(settings = this.getSettings(), options = {}) {
    if (!this._canUseSecondaryIdentity(options)) return this.MAIN_IDENTITY_ID;
    const normalized = this.normalizeSettings(settings);
    if (
      normalized?.profileActiveIdentityId === this.SECONDARY_IDENTITY_ID
      && this.isSecondaryEnabled(normalized)
    ) {
      return this.SECONDARY_IDENTITY_ID;
    }
    return this.MAIN_IDENTITY_ID;
  },

  getMainIdentity(user) {
    if (!user) return null;
    const uid = this._trim(user.uid || user.lineUserId || user._docId);
    const displayName = this._trim(user.displayName || user.name || uid || '用戶');
    const pictureUrl = this._trim(user.pictureUrl || user.photoURL);
    return {
      identityId: this.MAIN_IDENTITY_ID,
      uid,
      displayName,
      name: displayName,
      pictureUrl,
      photoURL: pictureUrl,
      avatarCandidates: pictureUrl ? [pictureUrl] : [],
      isPrimary: true,
      source: 'users',
    };
  },

  getSecondaryIdentity(user, settings = this.getSettings(), options = {}) {
    if (!user) return null;
    if (!this._canUseSecondaryIdentity(options)) return null;
    const normalized = this.normalizeSettings(settings);
    const secondary = normalized?.identities?.secondary || null;
    if (!secondary || secondary.enabled !== true || !secondary.displayName) return null;
    const avatarUrl = this._trim(secondary.avatarUrl);
    return {
      identityId: this.SECONDARY_IDENTITY_ID,
      uid: this._trim(user.uid || user.lineUserId || user._docId),
      displayName: secondary.displayName,
      name: secondary.displayName,
      pictureUrl: avatarUrl,
      photoURL: avatarUrl,
      avatarCandidates: avatarUrl ? [avatarUrl] : [],
      displayRoleLabel: secondary.displayRoleLabel || '一般用戶',
      isPrimary: false,
      source: 'users.identityPrivate.settings',
    };
  },

  getEffectiveIdentity(options = {}) {
    const user = options.user || (
      typeof ApiService !== 'undefined' && ApiService?.getCurrentUser
        ? ApiService.getCurrentUser()
        : null
    );
    if (!user) return null;
    const surface = this._trim(options.surface);
    const settings = options.settings || this.getSettings();
    if (this._privateMessageSurfaces.has(surface)) {
      return this.getMainIdentity(user);
    }
    if (this.getActiveIdentityId(settings, options) === this.SECONDARY_IDENTITY_ID) {
      return this.getSecondaryIdentity(user, settings, options) || this.getMainIdentity(user);
    }
    return this.getMainIdentity(user);
  },

  getDisplayUser(options = {}) {
    const user = options.user || (
      typeof ApiService !== 'undefined' && ApiService?.getCurrentUser
        ? ApiService.getCurrentUser()
        : null
    );
    const identity = this.getEffectiveIdentity({ ...options, user });
    if (!user || !identity) return user || null;
    return {
      ...user,
      displayName: identity.displayName,
      name: identity.displayName,
      pictureUrl: identity.pictureUrl,
      photoURL: identity.photoURL,
      activeIdentityId: identity.identityId,
      activeIdentity: identity,
    };
  },

  buildPublicSnapshot(options = {}) {
    const user = options.user || (
      typeof ApiService !== 'undefined' && ApiService?.getCurrentUser
        ? ApiService.getCurrentUser()
        : null
    );
    if (!user) return null;
    const requestedIdentityId = this._canUseSecondaryIdentity(options) && this._isValidIdentityId(options.requestedIdentityId)
      ? options.requestedIdentityId
      : this.MAIN_IDENTITY_ID;
    const settings = options.settings || this.getSettings();
    const identity = requestedIdentityId === this.SECONDARY_IDENTITY_ID
      ? this.getSecondaryIdentity(user, settings, options)
      : this.getMainIdentity(user);
    const resolved = identity || this.getMainIdentity(user);
    if (!resolved) return null;
    return {
      identityId: resolved.identityId === this.SECONDARY_IDENTITY_ID
        ? this.SECONDARY_IDENTITY_ID
        : this.MAIN_IDENTITY_ID,
      displayName: this._trim(resolved.displayName || resolved.name).slice(0, 80),
      avatarUrl: this._trim(resolved.pictureUrl || resolved.photoURL).slice(0, 1200),
    };
  },
};

if (typeof window !== 'undefined') {
  window.IdentityResolver = IdentityResolver;
}
