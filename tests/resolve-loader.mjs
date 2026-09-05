/** Resolve extensionless local TypeScript imports for Node's built in runner. */
export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/[.][cm]?js$|[.]ts$/.test(specifier)) {
    try {
      return await nextResolve(`${specifier}.ts`, context)
    } catch {
      // Let Node produce its normal resolution error below.
    }
  }
  return nextResolve(specifier, context)
}
