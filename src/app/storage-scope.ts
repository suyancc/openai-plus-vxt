export function scopedStorageKey(baseKey: string): string {
  return isIncognitoContext() ? `${baseKey}.incognito` : baseKey;
}

export function isIncognitoContext(): boolean {
  return Boolean(browser.extension?.inIncognitoContext);
}
