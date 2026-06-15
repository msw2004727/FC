const fs = require('fs');
const path = require('path');

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');
}

describe('education age privacy gates', () => {
  test('course enrollment list keeps age visible for staff-only roster cards', () => {
    const source = readProjectFile('js/modules/education/edu-course-enrollment-render.js');

    expect(source).toContain('const age = stu && stu.birthday ? this.calcAge(stu.birthday) : null;');
    expect(source).toContain("const ageText = age != null ? age + '歲' : '';");
    expect(source).toContain("' ' + age + '歲'");
  });

  test('non-staff student group and course roster paths gate age rendering', () => {
    const detailSource = readProjectFile('js/modules/education/edu-detail-render.js');
    const studentListSource = readProjectFile('js/modules/education/edu-student-list.js');
    const attendanceSource = readProjectFile('js/modules/education/edu-course-plan-attendance.js');
    const sessionSource = readProjectFile('js/modules/education/edu-course-session.js');
    const pendingStatusBody = detailSource.match(/_renderPendingStudentStatusRow\(s\) \{([\s\S]*?)\n  \},/)?.[1] || '';

    expect(pendingStatusBody).not.toContain('calcAge');
    expect(detailSource).toContain('const age = isStaff ? this.calcAge(s.birthday) : null;');
    expect(studentListSource).toContain('const age = isStaff ? this.calcAge(s.birthday) : null;');
    expect(attendanceSource).toContain('const isStaff = this.isEduClubStaff?.(teamId) === true;');
    expect(attendanceSource).toContain('const age = isStaff && stu && stu.birthday ? this.calcAge(stu.birthday) : null;');
    expect(sessionSource).toContain('const age = options.isStaff === true && student?.birthday ? this.calcAge(student.birthday) : null;');
    expect(sessionSource).toContain("if (options.isStaff === true) {\n      fields.splice(1, 0, { cls: 'age'");
  });
});
