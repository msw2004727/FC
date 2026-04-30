const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
const readProjectFile = (relPath) => fs.readFileSync(path.join(ROOT, relPath), 'utf8');
const loadCropperApp = (overrides = {}) => {
  const App = {};
  const sandbox = {
    App,
    window: { innerWidth: 460, innerHeight: 740, ...overrides.window },
    document: overrides.document || {},
    console,
  };
  vm.runInNewContext(readProjectFile('js/modules/image-cropper.js'), sandbox, {
    filename: 'js/modules/image-cropper.js',
  });
  return App;
};

describe('club image variants', () => {
  test('team upload uses the variant cropper instead of a single wide crop', () => {
    const appSource = readProjectFile('app.js');

    expect(appSource).toContain("bindTeamImageVariantUpload?.('ct-team-image', 'ct-team-preview')");
    expect(appSource).not.toContain("bindImageUpload?.('ct-team-image', 'ct-team-preview', 8/3)");
    expect(appSource).not.toContain("bindImageUpload('ct-team-image',    'ct-team-preview',          8/3)");
  });

  test('shared image editor keeps target size guidance outside the image frame', () => {
    const cropperSource = readProjectFile('js/modules/image-cropper.js');
    const cropperCss = readProjectFile('css/image-cropper.css');
    const uploadSource = readProjectFile('js/modules/image-upload.js');

    expect(cropperSource).toContain('image-cropper-frame-meta');
    expect(cropperSource).not.toContain('image-cropper-frame-hint');
    expect(cropperSource).toContain('recommendedSize');
    expect(cropperCss).toContain('max-width: none');
    expect(cropperCss).toContain('max-height: none');
    expect(uploadSource).toContain('_getTeamImageVariantTargets');
    expect(uploadSource).toContain("key: 'cover'");
    expect(uploadSource).toContain("key: 'card'");
    expect(uploadSource).toContain("recommendedSize: '800 x 300'");
    expect(uploadSource).toContain("recommendedSize: '800 x 800'");
  });

  test('shared image editor preserves target frame ratio on compact viewports', () => {
    const App = loadCropperApp();

    const coverSize = App._cropperComputeViewport({ naturalWidth: 800, naturalHeight: 800 }, 8 / 3);
    const cardSize = App._cropperComputeViewport({ naturalWidth: 1600, naturalHeight: 900 }, 1);

    expect(coverSize.width / coverSize.height).toBeCloseTo(8 / 3, 2);
    expect(cardSize.width / cardSize.height).toBeCloseTo(1, 2);
  });

  test('shared image editor can zoom out and render transparent padding without stretching', () => {
    const drawImage = jest.fn();
    const fillRect = jest.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage,
        fillRect,
        set imageSmoothingEnabled(_) {},
        set imageSmoothingQuality(_) {},
        set fillStyle(_) {},
      }),
      toDataURL: () => 'data:image/webp;base64,test',
    };
    const App = loadCropperApp({
      document: { createElement: () => canvas },
    });

    const config = App._normalizeImageCropperOptions({ aspectRatio: 1, outputWidth: 1000, outputHeight: 1000 });
    expect(config.minZoom).toBeLessThan(1);
    const result = App._cropperRenderResult(
      { naturalWidth: 1600, naturalHeight: 900, width: 1600, height: 900 },
      { imgW: 800, imgH: 450, scale: 0.5, tx: 25, ty: 112.5 },
      450,
      450,
      config
    );

    expect(result).toBe('data:image/webp;base64,test');
    expect(fillRect).not.toHaveBeenCalled();
    expect(drawImage).toHaveBeenCalledWith(
      expect.any(Object),
      0,
      0,
      1600,
      900,
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number)
    );
    const args = drawImage.mock.calls[0];
    expect(args[7] / args[8]).toBeCloseTo(16 / 9, 2);
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
