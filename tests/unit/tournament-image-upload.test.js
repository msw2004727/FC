const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

describe('tournament image upload contract', () => {
  test('tournament form binds cover uploads through the 800x300 cropper path', () => {
    const formSource = readProjectFile('js/modules/tournament/tournament-manage-form.js');

    expect(formSource).toContain('_getTournamentCoverAspectRatio()');
    expect(formSource).toContain('return 8 / 3;');
    expect(formSource).toContain('this.bindImageUpload(`${p}-image`, `${p}-upload-preview`, this._getTournamentCoverAspectRatio());');
  });

  test('create and edit tournament entry points use the shared upload binding', () => {
    const createSource = readProjectFile('js/modules/tournament/tournament-manage.js');
    const editSource = readProjectFile('js/modules/tournament/tournament-manage-edit.js');

    expect(createSource).toContain("this._bindTournamentImageUploads('tf');");
    expect(editSource).toContain("this._bindTournamentImageUploads('tf');");
    expect(createSource).not.toContain("this.bindImageUpload('tf-image', 'tf-upload-preview');");
    expect(editSource).not.toContain("this.bindImageUpload('tf-image', 'tf-upload-preview');");
  });
});
