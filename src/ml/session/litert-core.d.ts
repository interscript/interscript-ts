/**
 * Ambient declaration for the optional LiteRT-web peer dep.
 *
 * Users must install `@litertjs/core` if they want LiteRT inference.
 * Without it, the ML session throws a clear error at runtime. This
 * declaration keeps the type-checker happy when the dep is absent.
 */
declare module "@litertjs/core"
