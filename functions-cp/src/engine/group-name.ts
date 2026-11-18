/** 小組代碼維持穩定，顯示名稱由組別／賽制設定提供。 */
export function groupNameOf(
  groupId: string,
  config: { groupNames?: Record<string, string> } = {},
  separator = ''
): string {
  return config?.groupNames?.[groupId] || `${groupId}${separator}組`;
}
