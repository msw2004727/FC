const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const readProjectFile = (relPath) => fs.readFileSync(path.join(ROOT, relPath), 'utf8');

describe('club image variants', () => {
  test('team upload uses the variant cropper instead of a single wide crop', () => {
    const appSource = readProjectFile('app.js');

    expect(appSource).toContain("bindTeamImageVariantUpload?.('ct-team-image', 'ct-team-preview')");
    expect(appSource).not.toContain("bindImageUpload?.('ct-team-image', 'ct-team-preview', 8/3)");
    expect(appSource).not.toContain("bindImageUpload('ct-team-image',    'ct-team-preview',          8/3)");
  });

  test('shared image editor supports frame hints for target size guidance', () => {
    const cropperSource = readProjectFile('js/modules/image-cropper.js');
    const uploadSource = readProjectFile('js/modules/image-upload.js');

    expect(cropperSource).toContain('image-cropper-frame-hint');
    expect(cropperSource).toContain('recommendedSize');
    expect(uploadSource).toContain('_getTeamImageVariantTargets');
    expect(uploadSource).toContain("key: 'cover'");
    expect(uploadSource).toContain("key: 'card'");
    expect(uploadSource).toContain("recommendedSize: '800 x 300'");
    expect(uploadSource).toContain("recommendedSize: '800 x 800'");
  });

  test('team records upload and render cover/card variants with legacy fallback', () => {
    const crudSource = readProjectFile('js/firebase-crud.js');
    const formSource = readProjectFile('js/modules/team/team-form.js');
    const listSource = readProjectFile('js/modules/team/team-list-render.js');
    const detailSource = readProjectFile('js/modules/team/team-detail.js');
    const shareSource = readProjectFile('js/modules/team/team-share-builders.js');

    expect(crudSource).toContain('async _uploadTeamImageVariants');
    expect(crudSource).toContain('teams/${teamId}_${key}');
    expect(crudSource).toContain('payload.imageVariants = variants');
    expect(formSource).toContain('updates.imageVariants = imageVariants');
    expect(formSource).toContain('data.imageVariants = imageVariants');
    expect(listSource).toContain("_getTeamImageUrl?.(t, 'card')");
    expect(detailSource).toContain("_getTeamImageUrl?.(t, 'cover')");
    expect(shareSource).toContain("_getTeamImageUrl?.(team, 'cover')");
  });
});
