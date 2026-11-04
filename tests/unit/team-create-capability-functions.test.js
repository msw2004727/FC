const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../../functions/index.js'), 'utf8');

function section(start, end) {
  const offset = source.indexOf(start);
  const endOffset = source.indexOf(end, offset);
  if (offset < 0 || endOffset < 0) throw new Error('Missing source section: ' + start);
  return source.slice(offset, endOffset);
}

function loadCapabilities(snapshot) {
  const get = jest.fn(async () => snapshot);
  const doc = jest.fn(() => ({ get }));
  const collection = jest.fn(() => ({ doc }));
  const context = vm.createContext({ db: { collection }, normalizeRole: role => role });
  vm.runInContext(
    section('const ROLE_ACTIVITY_CAPABILITY_CODES', 'const ALLOWED_AUDIT_ACTIONS')
      + section('function sanitizeRoleActivityCapabilityList', 'async function getCallerAccessContext')
      + '\nthis.api = { sanitizeRoleActivityCapabilityList, getRoleActivityCapabilitiesFromFirestore };',
    context,
  );
  return { ...context.api, get, doc, collection };
}

describe('T-090b Functions team_create capability contract', () => {
  test('keeps team_create, deduplicates it and drops unknown codes', () => {
    const { sanitizeRoleActivityCapabilityList } = loadCapabilities();
    expect(sanitizeRoleActivityCapabilityList([
      'user.activity.team_create', 'user.activity.basic_create',
      'user.activity.team_create', 'user.team.create', 'team.create',
      ' user.activity.team_create', null,
    ])).toEqual(['user.activity.team_create', 'user.activity.basic_create']);
  });

  test('missing document defaults team_create on without enabling addons_use', async () => {
    const api = loadCapabilities({ exists: false });
    const defaults = await api.getRoleActivityCapabilitiesFromFirestore('user');
    expect(defaults).toContain('user.activity.team_create');
    expect(defaults).not.toContain('user.activity.addons_use');
    defaults.length = 0;
    expect(await api.getRoleActivityCapabilitiesFromFirestore('user'))
      .toContain('user.activity.team_create');
    expect(api.collection).toHaveBeenCalledWith('roleActivityCapabilities');
    expect(api.doc).toHaveBeenCalledWith('user');
  });

  test('existing document with team_create preserves the explicit grant', async () => {
    const api = loadCapabilities({ exists: true, data: () => ({ capabilities: ['user.activity.team_create'] }) });
    expect(await api.getRoleActivityCapabilitiesFromFirestore('user')).toEqual(['user.activity.team_create']);
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  test.each([[], ['user.activity.basic_create'], null, undefined, 'user.activity.team_create', {}].map(value => [value]))(
    'existing capabilities %p never receive a new default', async capabilities => {
      const api = loadCapabilities({ exists: true, data: () => ({ capabilities }) });
      const result = await api.getRoleActivityCapabilitiesFromFirestore('user');
      expect(result).not.toContain('user.activity.team_create');
      expect(result).toEqual(Array.isArray(capabilities) ? capabilities : []);
      expect(api.get).toHaveBeenCalledTimes(1);
    },
  );

  test.each(['coach', 'captain', 'venue_owner', 'admin', 'super_admin'])(
    '%s never receives user capabilities or reads the document', async role => {
      const api = loadCapabilities({ exists: false });
      expect(await api.getRoleActivityCapabilitiesFromFirestore(role)).toEqual([]);
      expect(api.collection).not.toHaveBeenCalled();
    },
  );

  test('read failure propagates instead of enabling defaults', async () => {
    const api = loadCapabilities();
    api.get.mockRejectedValueOnce(new Error('unavailable'));
    await expect(api.getRoleActivityCapabilitiesFromFirestore('user')).rejects.toThrow('unavailable');
  });
});
