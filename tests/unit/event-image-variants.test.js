const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const readProjectFile = (relPath) => fs.readFileSync(path.join(ROOT, relPath), 'utf8');

describe('activity image variants', () => {
  test('activity upload uses wide cover and home next crop targets', () => {
    const uploadSource = readProjectFile('js/modules/image-upload.js');
    const createSource = readProjectFile('js/modules/event/event-create.js');
    const lifecycleSource = readProjectFile('js/modules/event/event-manage-lifecycle.js');

    expect(uploadSource).toContain('_getEventImageVariantTargets');
    expect(uploadSource).toContain("key: 'cover'");
    expect(uploadSource).toContain("key: 'homeNext'");
    expect(uploadSource).toContain('aspectRatio: 8 / 3');
    expect(uploadSource).toContain('aspectRatio: 4 / 3');
    expect(createSource).toContain("bindEventImageVariantUpload?.('ce-image', 'ce-upload-preview')");
    expect(lifecycleSource).toContain("bindEventImageVariantUpload?.('ce-image', 'ce-upload-preview')");
  });

  test('activity records upload and render variants with legacy fallback', () => {
    const crudSource = readProjectFile('js/firebase-crud.js');
    const createSource = readProjectFile('js/modules/event/event-create.js');
    const homeNextSource = readProjectFile('js/modules/home-next-activity.js');
    const detailSource = readProjectFile('js/modules/event/event-detail.js');
    const hotSource = readProjectFile('js/modules/event/event-list.js');
    const timelineSource = readProjectFile('js/modules/event/event-list-timeline.js');

    expect(crudSource).toContain('async _uploadEventImageVariants');
    expect(crudSource).toContain('events/${eventId}_${key}');
    expect(crudSource).toContain('payload.imageVariants = variants');
    expect(createSource).toContain('updates.imageVariants = imageVariants');
    expect(createSource).toContain('newEvent.imageVariants = imageVariants');
    expect(homeNextSource).toContain("_getEventImageUrl?.(event, 'homeNext')");
    expect(detailSource).toContain("_getEventImageUrl?.(eventRecord, 'cover')");
    expect(hotSource).toContain("_getEventImageUrl?.(e, 'cover')");
    expect(timelineSource).toContain("_getEventImageUrl?.(e, 'cover')");
  });
});
