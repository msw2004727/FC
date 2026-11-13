/**
 * 清空 Storage emulator 的 bucket（含子資料夾）。
 *
 * @firebase/rules-unit-testing 的 clearStorage() 只刪預設 bucket 根目錄那一層的檔案，
 * images/ 底下的檔案會留到下一個案例；禁止覆寫之後，殘留檔會讓「新增」案例被當成覆寫而失敗。
 */

async function deleteFolder(ref) {
  const result = await ref.listAll();
  await Promise.all(result.items.map((item) => item.delete()));
  for (const prefix of result.prefixes) {
    await deleteFolder(prefix);
  }
}

async function clearBuckets(testEnv, extraBuckets = []) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await deleteFolder(ctx.storage().ref());
    for (const bucket of extraBuckets) {
      await deleteFolder(ctx.storage(bucket).ref());
    }
  });
}

module.exports = { clearBuckets };
