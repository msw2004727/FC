/* ToosterX History API route rollout flags. */
(function(root) {
  'use strict';

  var defaults = {
    parseRead: true,
    cleanHashFallbackPath: true,
    bootIntegration: true,
    writeListPaths: true,
    writeDetailPaths: true,
    popstateTakeover: true,
    liffPathDisable: true,
    usersPathEnabled: false
  };

  var existing = root.HISTORY_ROUTE_FLAGS && typeof root.HISTORY_ROUTE_FLAGS === 'object'
    ? root.HISTORY_ROUTE_FLAGS
    : {};

  root.HISTORY_ROUTE_FLAGS = Object.assign({}, defaults, existing);
})(typeof window !== 'undefined' ? window : globalThis);
