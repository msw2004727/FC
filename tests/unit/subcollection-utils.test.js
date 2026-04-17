/**
 * Subcollection Migration Utilities — unit tests
 *
 * Tests the utility functions that will be introduced in Phase 0 of the
 * subcollection migration (archive/stateful-imagining-dahl.md).
 *
 * These functions don't exist in the codebase yet — the logic is extracted
 * from the migration plan and tested here BEFORE implementation, ensuring
 * the design is correct.
 *
 * TODO(Phase 0): Once _getEventDocId and filterSubcollectionOnly are
 * implemented in firebase-service.js, replace the inline definitions
 * below with imports from the actual module. Until then, these tests
 * validate the DESIGN, not the implementation.
 *
 * Covers:
 *   B. collectionGroup dedup filter (doc.ref.parent.parent !== null)
 *   C. _getEventDocId / _getEventDocIdAsync logic
 */

// ═══════════════════════════════════════════════════════════════
//  B. CollectionGroup Dedup Filter
// ═══════════════════════════════════════════════════════════════

/**
 * Mock a Firestore DocumentSnapshot's ref chain.
 *
 * Root collection doc: registrations/abc
 *   → doc.ref.parent = CollectionRef('registrations')
 *   → doc.ref.parent.parent = null
 *
 * Subcollection doc: events/xyz/registrations/abc
 *   → doc.ref.parent = CollectionRef('events/xyz/registrations')
 *   → doc.ref.parent.parent = DocumentRef('events/xyz')
 */
function mockDoc(data, docId, parentDocId) {
  const isSubcollection = parentDocId != null;
  return {
    id: docId,
    data: () => ({ ...data }),
    ref: {
      id: docId,
      path: isSubcollection
        ? `events/${parentDocId}/registrations/${docId}`
        : `registrations/${docId}`,
      parent: {
        id: 'registrations',
        path: isSubcollection
          ? `events/${parentDocId}/registrations`
          : 'registrations',
        parent: isSubcollection
          ? { id: parentDocId, path: `events/${parentDocId}` }
          : null,
      },
    },
  };
}

/**
 * The dedup filter function from the migration plan.
 * Filters out root collection documents, keeping only subcollection documents.
 */
function filterSubcollectionOnly(docs) {
  return docs.filter(doc => doc.ref.parent.parent !== null);
}

/**
 * Process a collectionGroup snapshot into cache-ready array (plan Phase 3b pattern).
 */
function processCollectionGroupSnapshot(docs) {
  return filterSubcollectionOnly(docs)
    .map(doc => ({ ...doc.data(), _docId: doc.id }));
}

describe('B. CollectionGroup Dedup Filter', () => {
  const rootDoc1 = mockDoc({ userId: 'u1', eventId: 'e1', status: 'confirmed' }, 'reg1', null);
  const rootDoc2 = mockDoc({ userId: 'u2', eventId: 'e1', status: 'waitlisted' }, 'reg2', null);
  const subDoc1 = mockDoc({ userId: 'u1', eventId: 'e1', status: 'confirmed' }, 'reg1', 'eventDocA');
  const subDoc2 = mockDoc({ userId: 'u2', eventId: 'e1', status: 'waitlisted' }, 'reg2', 'eventDocA');
  const subDoc3 = mockDoc({ userId: 'u3', eventId: 'e2', status: 'confirmed' }, 'reg3', 'eventDocB');

  test('root document has parent.parent === null', () => {
    expect(rootDoc1.ref.parent.parent).toBeNull();
    expect(rootDoc2.ref.parent.parent).toBeNull();
  });

  test('subcollection document has parent.parent !== null', () => {
    expect(subDoc1.ref.parent.parent).not.toBeNull();
    expect(subDoc2.ref.parent.parent).not.toBeNull();
    expect(subDoc3.ref.parent.parent).not.toBeNull();
  });

  test('filter removes root documents, keeps subcollection documents', () => {
    const allDocs = [rootDoc1, rootDoc2, subDoc1, subDoc2, subDoc3];
    const filtered = filterSubcollectionOnly(allDocs);

    expect(filtered).toHaveLength(3);
    expect(filtered.map(d => d.id)).toEqual(['reg1', 'reg2', 'reg3']);
  });

  test('filter with only root documents returns empty', () => {
    const result = filterSubcollectionOnly([rootDoc1, rootDoc2]);
    expect(result).toHaveLength(0);
  });

  test('filter with only subcollection documents returns all', () => {
    const result = filterSubcollectionOnly([subDoc1, subDoc2, subDoc3]);
    expect(result).toHaveLength(3);
  });

  test('filter with empty array returns empty', () => {
    expect(filterSubcollectionOnly([])).toHaveLength(0);
  });

  test('processCollectionGroupSnapshot produces correct cache format', () => {
    // Simulate dual-write scenario: same regId in both root and subcollection
    const mixedDocs = [rootDoc1, subDoc1, rootDoc2, subDoc2];
    const result = processCollectionGroupSnapshot(mixedDocs);

    // Should only have subcollection docs
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ userId: 'u1', eventId: 'e1', status: 'confirmed', _docId: 'reg1' });
    expect(result[1]).toEqual({ userId: 'u2', eventId: 'e1', status: 'waitlisted', _docId: 'reg2' });
  });

  test('during dual-write, filtering prevents count doubling', () => {
    // Key scenario: Phase 1-4 dual-write causes same data in root + subcollection
    const rootDocs = Array.from({ length: 25 }, (_, i) =>
      mockDoc({ userId: `u${i}`, eventId: 'e1', status: 'confirmed' }, `reg${i}`, null)
    );
    const subDocs = Array.from({ length: 25 }, (_, i) =>
      mockDoc({ userId: `u${i}`, eventId: 'e1', status: 'confirmed' }, `reg${i}`, 'eventDocA')
    );

    const allDocs = [...rootDocs, ...subDocs]; // 50 docs total
    const filtered = processCollectionGroupSnapshot(allDocs);

    // Must be 25, NOT 50
    expect(filtered).toHaveLength(25);
  });

  test('subcollection docs from different events are all kept', () => {
    const docs = [
      mockDoc({ eventId: 'e1' }, 'reg1', 'docA'),
      mockDoc({ eventId: 'e2' }, 'reg2', 'docB'),
      mockDoc({ eventId: 'e3' }, 'reg3', 'docC'),
    ];
    const filtered = filterSubcollectionOnly(docs);
    expect(filtered).toHaveLength(3);
  });
});

// ═══════════════════════════════════════════════════════════════
//  C. _getEventDocId / _getEventDocIdAsync Logic
// ═══════════════════════════════════════════════════════════════

/**
 * Extracted from migration plan Phase 0:
 * Synchronous version — looks up _docId from cached events array.
 */
function _getEventDocId(cache, eventId) {
  const ev = cache.find(e => e.id === eventId);
  if (ev && ev._docId) return ev._docId;
  return null;
}

/**
 * Extracted from migration plan Phase 0:
 * Async version — falls back to Firestore query on cache miss.
 *
 * @param {Function} firestoreQuery — injected dependency for testing
 */
async function _getEventDocIdAsync(cache, eventId, firestoreQuery) {
  const cached = _getEventDocId(cache, eventId);
  if (cached) return cached;
  return firestoreQuery(eventId);
}

describe('C. _getEventDocId — Synchronous (cache lookup)', () => {
  const cache = [
    { id: 'ce_111_abc', _docId: 'firestore_AAA', title: 'Event A' },
    { id: 'ce_222_def', _docId: 'firestore_BBB', title: 'Event B' },
    { id: 'ce_333_ghi', _docId: null, title: 'Event C (no docId)' },
    { id: 'ce_444_jkl', title: 'Event D (missing _docId field)' },
  ];

  test('returns _docId when event found in cache', () => {
    expect(_getEventDocId(cache, 'ce_111_abc')).toBe('firestore_AAA');
    expect(_getEventDocId(cache, 'ce_222_def')).toBe('firestore_BBB');
  });

  test('returns null when eventId not in cache', () => {
    expect(_getEventDocId(cache, 'ce_999_xyz')).toBeNull();
  });

  test('returns null when event has null _docId', () => {
    expect(_getEventDocId(cache, 'ce_333_ghi')).toBeNull();
  });

  test('returns null when event has no _docId field', () => {
    expect(_getEventDocId(cache, 'ce_444_jkl')).toBeNull();
  });

  test('returns null for empty cache', () => {
    expect(_getEventDocId([], 'ce_111_abc')).toBeNull();
  });

  test('returns null for undefined/null eventId', () => {
    expect(_getEventDocId(cache, undefined)).toBeNull();
    expect(_getEventDocId(cache, null)).toBeNull();
  });

  test('does not match partial eventId', () => {
    expect(_getEventDocId(cache, 'ce_111')).toBeNull();
    expect(_getEventDocId(cache, 'ce_111_abc_extra')).toBeNull();
  });
});

describe('C. _getEventDocIdAsync — Async (with Firestore fallback)', () => {
  const cache = [
    { id: 'ce_111_abc', _docId: 'firestore_AAA' },
  ];

  test('returns cached value without calling Firestore', async () => {
    const mockQuery = jest.fn();
    const result = await _getEventDocIdAsync(cache, 'ce_111_abc', mockQuery);

    expect(result).toBe('firestore_AAA');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('calls Firestore query on cache miss', async () => {
    const mockQuery = jest.fn().mockResolvedValue('firestore_ZZZ');
    const result = await _getEventDocIdAsync(cache, 'ce_999_xyz', mockQuery);

    expect(result).toBe('firestore_ZZZ');
    expect(mockQuery).toHaveBeenCalledWith('ce_999_xyz');
  });

  test('returns null when both cache and Firestore miss', async () => {
    const mockQuery = jest.fn().mockResolvedValue(null);
    const result = await _getEventDocIdAsync(cache, 'ce_999_xyz', mockQuery);

    expect(result).toBeNull();
    expect(mockQuery).toHaveBeenCalledWith('ce_999_xyz');
  });

  test('propagates Firestore query errors', async () => {
    const mockQuery = jest.fn().mockRejectedValue(new Error('network error'));

    await expect(
      _getEventDocIdAsync(cache, 'ce_999_xyz', mockQuery)
    ).rejects.toThrow('network error');
  });
});

// ═══════════════════════════════════════════════════════════════
//  Integration: Dedup + DocId Lookup Combined
// ═══════════════════════════════════════════════════════════════

describe('Integration: Dedup filter + _getEventDocId used together', () => {
  test('dual-write pattern: docId lookup then subcollection write path construction', () => {
    const cache = [
      { id: 'ce_111_abc', _docId: 'firestore_AAA' },
    ];

    const eventId = 'ce_111_abc';
    const eventDocId = _getEventDocId(cache, eventId);

    expect(eventDocId).toBe('firestore_AAA');

    // Construct subcollection path (this is what Phase 1 dual-write does)
    const subPath = `events/${eventDocId}/registrations`;
    expect(subPath).toBe('events/firestore_AAA/registrations');

    // Verify dedup filter would correctly identify this as subcollection
    const subDoc = mockDoc({ eventId }, 'newReg1', eventDocId);
    expect(subDoc.ref.parent.parent).not.toBeNull();
    expect(subDoc.ref.parent.parent.id).toBe('firestore_AAA');
  });

  test('cache miss scenario: should log error, not silently skip', () => {
    const cache = [];
    const eventDocId = _getEventDocId(cache, 'ce_unknown');

    // Plan rule: null → must log error, not silently skip
    expect(eventDocId).toBeNull();
    // In actual implementation, this triggers:
    // console.error('[dual-write] cannot find eventDocId for eventId:', eventId);
  });
});
