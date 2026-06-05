export function isPhoneVerificationPath(pathname: string): boolean {
  return pathname.startsWith('/phone-verification') ||
    pathname.startsWith('/contact-verification');
}
